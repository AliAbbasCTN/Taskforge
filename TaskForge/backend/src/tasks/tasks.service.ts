import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  PositionedRow,
  positionChanges,
  reorder,
} from '../common/utils/ordering';
import { SAFE_USER_SELECT } from '../users/users.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';

/** Tasks are always returned with their assignee, selected through
 * `SAFE_USER_SELECT` so credentials are never even read from the database. */
const WITH_ASSIGNEE = {
  assignee: { select: SAFE_USER_SELECT },
} satisfies Prisma.TaskInclude;

/**
 * WHAT: Business logic for tasks - create, edit, assign, move, delete - and
 * for keeping the `position` order of each column dense.
 *
 * WHERE: Injected into `TasksController`. Guards have already confirmed the
 * requester may see the project, the board belongs to it, and the requester
 * holds `project:tasks:write` on a project that is not archived. This service
 * enforces what guards can't express: that referenced columns and assignees
 * really belong to THIS board and THIS project.
 *
 * WHY tasks are looked up by id AND board (`findScoped`): the `:taskId` in
 * the URL is untrusted. A task from another board - in this project or any
 * other organization - must be indistinguishable from a task that doesn't
 * exist (404). Scoping the query itself guarantees that, with no way to
 * forget a separate check.
 *
 * WHY there is no `status` field: a task's status IS its column. Storing
 * both would let them disagree ("column Done, status In Progress"). Moving
 * the task to another column is how status changes.
 */
@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, boardId: string, dto: CreateTaskDto) {
    if (dto.assigneeId) {
      await this.assertAssignable(projectId, dto.assigneeId);
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assertColumnOnBoard(tx, boardId, dto.columnId);
      const siblings = await this.siblings(tx, dto.columnId);

      const task = await tx.task.create({
        data: {
          columnId: dto.columnId,
          title: dto.title,
          description: dto.description ? dto.description : null,
          priority: dto.priority,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          assigneeId: dto.assigneeId ?? null,
          position: siblings.length,
        },
      });

      if (dto.position !== undefined) {
        const newOrder = reorder(
          [...siblings.map((s) => s.id), task.id],
          task.id,
          dto.position,
        );
        await this.persist(
          tx,
          positionChanges(
            [...siblings, { id: task.id, position: task.position }],
            newOrder,
          ),
        );
      }

      return tx.task.findUniqueOrThrow({
        where: { id: task.id },
        include: WITH_ASSIGNEE,
      });
    });
  }

  findOne(boardId: string, taskId: string) {
    return this.findScoped(this.prisma, boardId, taskId);
  }

  async update(
    projectId: string,
    boardId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ) {
    const data: Prisma.TaskUncheckedUpdateInput = {};
    if (dto.title !== undefined) {
      data.title = dto.title;
    }
    if (dto.description !== undefined) {
      // null and "" both mean "no description"; we store NULL, never "".
      data.description = dto.description ? dto.description : null;
    }
    if (dto.priority !== undefined) {
      data.priority = dto.priority;
    }
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate === null ? null : new Date(dto.dueDate);
    }
    if (dto.assigneeId !== undefined) {
      if (dto.assigneeId !== null) {
        await this.assertAssignable(projectId, dto.assigneeId);
      }
      data.assigneeId = dto.assigneeId;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Provide at least one field to update (title, description, priority, dueDate or assigneeId)',
      );
    }

    await this.findScoped(this.prisma, boardId, taskId);
    return this.prisma.task.update({
      where: { id: taskId },
      data,
      include: WITH_ASSIGNEE,
    });
  }

  /**
   * Moves a task to `dto.columnId` at `dto.position` (default: the bottom).
   *
   * Two orderings change at once, so it is ONE transaction:
   *   - same column: re-order that column;
   *   - different column: close the gap in the source column, then insert
   *     into the target column. If any step failed half-way, tasks could
   *     end up with duplicate positions or vanish from both orderings.
   */
  move(boardId: string, taskId: string, dto: MoveTaskDto) {
    return this.prisma.$transaction(async (tx) => {
      const task = await this.findScoped(tx, boardId, taskId);
      await this.assertColumnOnBoard(tx, boardId, dto.columnId);

      if (task.columnId === dto.columnId) {
        const rows = await this.siblings(tx, dto.columnId);
        const newOrder = reorder(
          rows.map((r) => r.id),
          taskId,
          dto.position,
        );
        await this.persist(tx, positionChanges(rows, newOrder));
      } else {
        // 1. Close the gap the task leaves behind in its old column.
        const source = await this.siblings(tx, task.columnId);
        const remaining = source.filter((r) => r.id !== taskId);
        await this.persist(
          tx,
          positionChanges(
            remaining,
            remaining.map((r) => r.id),
          ),
        );

        // 2. Drop it at the bottom of the new column, then slide it to the
        //    requested position.
        const target = await this.siblings(tx, dto.columnId);
        await tx.task.update({
          where: { id: taskId },
          data: { columnId: dto.columnId, position: target.length },
        });
        const newOrder = reorder(
          [...target.map((r) => r.id), taskId],
          taskId,
          dto.position,
        );
        await this.persist(
          tx,
          positionChanges(
            [...target, { id: taskId, position: target.length }],
            newOrder,
          ),
        );
      }

      return tx.task.findUniqueOrThrow({
        where: { id: taskId },
        include: WITH_ASSIGNEE,
      });
    });
  }

  async remove(boardId: string, taskId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const task = await this.findScoped(tx, boardId, taskId);
      await tx.task.delete({ where: { id: taskId } });

      // Close the gap the deleted task left in its column.
      const rows = await this.siblings(tx, task.columnId);
      await this.persist(
        tx,
        positionChanges(
          rows,
          rows.map((r) => r.id),
        ),
      );
    });
  }

  /**
   * An assignee must be a member of THIS project. Being in the organization
   * is not enough: projects are private, so assigning work to someone who
   * cannot even see the project would hand them a task they can't open.
   */
  private async assertAssignable(
    projectId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { id: true },
    });
    if (!membership) {
      throw new UnprocessableEntityException(
        'The assignee must be a member of this project',
      );
    }
  }

  private async assertColumnOnBoard(
    tx: Prisma.TransactionClient,
    boardId: string,
    columnId: string,
  ): Promise<void> {
    const column = await tx.boardColumn.findFirst({
      where: { id: columnId, boardId },
      select: { id: true },
    });
    if (!column) {
      throw new UnprocessableEntityException(
        'That column does not belong to this board',
      );
    }
  }

  private async findScoped(
    client: Prisma.TransactionClient,
    boardId: string,
    taskId: string,
  ) {
    const task = await client.task.findFirst({
      where: { id: taskId, column: { boardId } },
      include: WITH_ASSIGNEE,
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  private siblings(
    tx: Prisma.TransactionClient,
    columnId: string,
  ): Promise<PositionedRow[]> {
    return tx.task.findMany({
      where: { columnId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, position: true },
    });
  }

  private async persist(
    tx: Prisma.TransactionClient,
    changes: PositionedRow[],
  ): Promise<void> {
    for (const change of changes) {
      await tx.task.update({
        where: { id: change.id },
        data: { position: change.position },
      });
    }
  }
}
