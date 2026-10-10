import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PositionedRow,
  positionChanges,
  reorder,
} from '../common/utils/ordering';
import { toPaginated, toSkipTake } from '../common/pagination/pagination';
import { TASK_INCLUDE, TASK_LIST_INCLUDE, flattenLabels } from './task-include';
import { buildTaskFilterWhere, buildTaskOrderBy } from './task-query';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** `actorId` is who is making the request - used only to word and
   * suppress notifications (you are never told about your own actions). */
  async create(
    projectId: string,
    boardId: string,
    dto: CreateTaskDto,
    actorId: string,
  ) {
    if (dto.assigneeId) {
      await this.assertAssignable(projectId, dto.assigneeId);
    }

    const created = await this.prisma.$transaction(async (tx) => {
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

      return flattenLabels(
        await tx.task.findUniqueOrThrow({
          where: { id: task.id },
          include: TASK_INCLUDE,
        }),
      );
    });

    // After the transaction has committed - never announce what might still
    // be rolled back.
    if (dto.assigneeId) {
      await this.notifications.notify({
        recipientId: dto.assigneeId,
        actorId,
        type: NotificationType.TASK_ASSIGNED,
        projectId,
        boardId,
        taskId: created.id,
        subject: created.title,
      });
    }
    return created;
  }

  async findOne(boardId: string, taskId: string) {
    return flattenLabels(await this.findScoped(this.prisma, boardId, taskId));
  }

  /**
   * The paginated, filterable, sortable task list for one board.
   *
   * Ownership is part of the query itself (`column: { boardId }`), so a
   * client can only ever list tasks of the board the guards already verified.
   * The total and the page are fetched in ONE transaction so they describe
   * the same moment - otherwise a task created between the two queries would
   * make "page 2 of 3" disagree with the rows shown.
   */
  async list(boardId: string, query: ListTasksQueryDto) {
    const where: Prisma.TaskWhereInput = {
      column: { boardId, ...(query.columnId ? { id: query.columnId } : {}) },
      ...buildTaskFilterWhere(query),
    };

    const [total, tasks] = await this.prisma.$transaction([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        orderBy: buildTaskOrderBy(query.sortBy, query.sortOrder),
        ...toSkipTake(query.page, query.pageSize),
        include: TASK_LIST_INCLUDE,
      }),
    ]);

    return toPaginated(
      tasks.map((task) => flattenLabels(task)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async update(
    projectId: string,
    boardId: string,
    taskId: string,
    dto: UpdateTaskDto,
    actorId: string,
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

    const existing = await this.findScoped(this.prisma, boardId, taskId);
    const updated = flattenLabels(
      await this.prisma.task.update({
        where: { id: taskId },
        data,
        include: TASK_INCLUDE,
      }),
    );

    // Only a CHANGE to a new assignee is news: re-saving the same assignee,
    // or clearing it, tells no one anything.
    if (dto.assigneeId && dto.assigneeId !== existing.assigneeId) {
      await this.notifications.notify({
        recipientId: dto.assigneeId,
        actorId,
        type: NotificationType.TASK_ASSIGNED,
        projectId,
        boardId,
        taskId,
        subject: updated.title,
      });
    }
    return updated;
  }

  /**
   * Replaces the task's labels with exactly `labelIds`.
   *
   * Every label must belong to THIS task's project (the schema can't express
   * that, so it is checked here): otherwise someone could attach another
   * project's label - and so learn it exists, and its name - by guessing its
   * ID. The delete-then-insert pair is one transaction so the task is never
   * observed half-relabelled.
   */
  async setLabels(
    projectId: string,
    boardId: string,
    taskId: string,
    labelIds: string[],
  ) {
    const unique = [...new Set(labelIds)];
    await this.findScoped(this.prisma, boardId, taskId);

    if (unique.length > 0) {
      const found = await this.prisma.label.count({
        where: { id: { in: unique }, projectId },
      });
      if (found !== unique.length) {
        throw new UnprocessableEntityException(
          'One or more labels do not belong to this project',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.taskLabel.deleteMany({ where: { taskId } }),
      this.prisma.taskLabel.createMany({
        data: unique.map((labelId) => ({ taskId, labelId })),
      }),
    ]);

    return flattenLabels(await this.findScoped(this.prisma, boardId, taskId));
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

      return flattenLabels(
        await tx.task.findUniqueOrThrow({
          where: { id: taskId },
          include: TASK_INCLUDE,
        }),
      );
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
      include: TASK_INCLUDE,
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
