import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SAFE_USER_SELECT } from '../users/users.service';

/** Comments always come back with their author, minus credentials. */
const WITH_AUTHOR = {
  author: { select: SAFE_USER_SELECT },
} satisfies Prisma.CommentInclude;

/**
 * WHAT: Business logic for comments on a task.
 *
 * WHERE: Injected into `CommentsController`. Guards have established that the
 * requester can see the project and the board belongs to it (and, on writes,
 * that they hold `project:tasks:write` on a non-archived project). This
 * service adds the rules that depend on WHICH comment it is:
 *
 *   - anyone who can write may COMMENT;
 *   - only the AUTHOR may EDIT a comment (nobody - not even a lead - can put
 *     words in someone else's mouth);
 *   - the author may DELETE their comment, and so may a moderator (a project
 *     lead or org admin/manager), who needs to be able to remove something
 *     inappropriate. The controller works out `canModerate`, using the same
 *     permission logic as the guards (`canActOnProject`).
 *
 * Every lookup is scoped by task AND board, so a comment or task from
 * anywhere else is a 404, never reachable through the wrong URL.
 *
 * A 403 (not 404) for "not your comment" is deliberate: the requester can
 * already SEE the comment, so refusing the action reveals nothing.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(boardId: string, taskId: string) {
    await this.getTaskOnBoard(boardId, taskId);
    return this.prisma.comment.findMany({
      where: { taskId },
      include: WITH_AUTHOR,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    boardId: string,
    taskId: string,
    authorId: string,
    body: string,
  ) {
    const task = await this.getTaskOnBoard(boardId, taskId);
    const comment = await this.prisma.comment.create({
      data: { taskId, authorId, body },
      include: WITH_AUTHOR,
    });

    // The person responsible for the task wants to know it's being discussed
    // (unless they wrote the comment - `notify` skips that case itself).
    if (task.assigneeId) {
      await this.notifications.notify({
        recipientId: task.assigneeId,
        actorId: authorId,
        type: NotificationType.COMMENT_ADDED,
        projectId: task.column.board.projectId,
        boardId,
        taskId,
        subject: task.title,
      });
    }
    return comment;
  }

  async update(
    boardId: string,
    taskId: string,
    commentId: string,
    requesterId: string,
    body: string,
  ) {
    const comment = await this.getScoped(boardId, taskId, commentId);
    if (comment.authorId !== requesterId) {
      throw new ForbiddenException('You can only edit your own comments');
    }
    return this.prisma.comment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
      include: WITH_AUTHOR,
    });
  }

  async remove(
    boardId: string,
    taskId: string,
    commentId: string,
    requesterId: string,
    canModerate: boolean,
  ): Promise<void> {
    const comment = await this.getScoped(boardId, taskId, commentId);
    if (comment.authorId !== requesterId && !canModerate) {
      throw new ForbiddenException(
        'You can only delete your own comments, unless you manage this project',
      );
    }
    await this.prisma.comment.delete({ where: { id: commentId } });
  }

  /** The task, scoped to the board, with what a notification needs. */
  private async getTaskOnBoard(boardId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, column: { boardId } },
      select: {
        id: true,
        title: true,
        assigneeId: true,
        column: { select: { board: { select: { projectId: true } } } },
      },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  private async getScoped(boardId: string, taskId: string, commentId: string) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, taskId, task: { column: { boardId } } },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }
}
