import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TaskFilterDto } from '../tasks/dto/task-filter.dto';
import { TASK_INCLUDE, flattenLabels } from '../tasks/task-include';
import { buildTaskFilterWhere } from '../tasks/task-query';

/** Every new board starts with a usable workflow; columns can be renamed,
 * added and (when empty) deleted afterwards. */
const DEFAULT_COLUMN_NAMES = ['To Do', 'In Progress', 'Done'];

/**
 * WHAT: Business logic for boards. A board is a container; its columns are
 * handled by `ColumnsService` and its tasks by `TasksService`.
 *
 * WHERE: Injected into `BoardsController`. By the time any method runs,
 * guards have confirmed the requester may see the project, that the board
 * belongs to it, and that the requester holds the needed permission.
 */
@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a board together with its default columns. This is a single
   * nested `create`, which Prisma executes atomically: the board and its
   * three columns either all exist or none do, so a board can never be left
   * without its starting workflow.
   */
  create(projectId: string, name: string) {
    return this.prisma.board.create({
      data: {
        projectId,
        name,
        columns: {
          create: DEFAULT_COLUMN_NAMES.map((columnName, position) => ({
            name: columnName,
            position,
          })),
        },
      },
      include: { columns: { orderBy: { position: 'asc' } } },
    });
  }

  findAll(projectId: string) {
    return this.prisma.board.findMany({
      where: { projectId },
      include: { _count: { select: { columns: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * The "board view": the board with its columns in order, each column with
   * its tasks in order, each task with its assignee and labels - in ONE
   * query. Loading tasks per column, or assignees/labels per task, in a loop
   * would be the N+1 problem.
   *
   * Optional filters narrow which TASKS appear inside the columns; every
   * column is still returned (an empty "Done" lane is information too).
   *
   * Not paginated: a board holds tens of tasks, and a kanban view must show
   * whole columns to make sense. The paginated, sortable list lives at
   * `GET .../tasks`.
   */
  async findOne(boardId: string, filter: TaskFilterDto = {}) {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      include: {
        columns: {
          orderBy: { position: 'asc' },
          include: {
            tasks: {
              where: buildTaskFilterWhere(filter),
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
              include: TASK_INCLUDE,
            },
          },
        },
      },
    });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    return {
      ...board,
      columns: board.columns.map((column) => ({
        ...column,
        tasks: column.tasks.map((task) => flattenLabels(task)),
      })),
    };
  }

  update(boardId: string, name: string) {
    return this.prisma.board.update({
      where: { id: boardId },
      data: { name },
    });
  }

  /** Permanent. Cascades to the board's columns and their tasks. */
  async remove(boardId: string): Promise<void> {
    await this.prisma.board.delete({ where: { id: boardId } });
  }
}
