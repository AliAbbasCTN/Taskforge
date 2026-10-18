import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JsonObject, SnapshotKind } from './activity.types';

/**
 * WHAT: Reads a small "before" picture of a thing just before a request changes
 * or deletes it.
 *
 * WHY: after `DELETE .../tasks/:id` the title is gone from the database; after
 * a move the old column is overwritten. The log entry needs both ("deleted task
 * ‘Fix login’", "moved from To Do to Done"), so the interceptor asks for a
 * snapshot first. Every loader selects only a few columns and returns `null` if
 * the thing doesn't exist - a lookup problem must never fail the real request.
 *
 * Scoping: ids come from the URL, which the route guards already validated, but
 * loaders still filter by the PARENT id (board, project, organization) so a
 * mismatched id yields `null` instead of another tenant's data.
 */
@Injectable()
export class ActivitySnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    kind: SnapshotKind,
    params: Record<string, string | undefined>,
    body: JsonObject,
  ): Promise<JsonObject | null> {
    switch (kind) {
      case 'task':
        return this.task(params);
      case 'task-move':
        return this.taskMove(params, body);
      case 'project':
        return this.project(params);
      case 'board':
        return this.board(params);
      case 'org-member':
        return this.orgMember(params);
      case 'project-member':
        return this.projectMember(params);
      case 'attachment':
        return this.attachment(params);
    }
  }

  private async task(params: Record<string, string | undefined>) {
    if (!params.taskId || !params.boardId) {
      return null;
    }
    const task = await this.prisma.task.findFirst({
      where: { id: params.taskId, column: { boardId: params.boardId } },
      select: {
        title: true,
        assigneeId: true,
        columnId: true,
        assignee: { select: { name: true } },
        column: { select: { name: true } },
      },
    });
    return task
      ? {
          title: task.title,
          assigneeId: task.assigneeId,
          assigneeName: task.assignee?.name ?? null,
          columnId: task.columnId,
          columnName: task.column.name,
        }
      : null;
  }

  private async taskMove(
    params: Record<string, string | undefined>,
    body: JsonObject,
  ) {
    const task = await this.task(params);
    if (!task || typeof body.columnId !== 'string' || !params.boardId) {
      return task;
    }
    const target = await this.prisma.boardColumn.findFirst({
      where: { id: body.columnId, boardId: params.boardId },
      select: { name: true },
    });
    return { ...task, toColumnName: target?.name ?? null };
  }

  private async project(params: Record<string, string | undefined>) {
    if (!params.projectId || !params.id) {
      return null;
    }
    return this.prisma.project.findFirst({
      where: { id: params.projectId, organizationId: params.id },
      select: { name: true },
    });
  }

  private async board(params: Record<string, string | undefined>) {
    if (!params.boardId || !params.projectId) {
      return null;
    }
    return this.prisma.board.findFirst({
      where: { id: params.boardId, projectId: params.projectId },
      select: { name: true },
    });
  }

  private async orgMember(params: Record<string, string | undefined>) {
    if (!params.userId || !params.id) {
      return null;
    }
    const membership = await this.prisma.membership.findFirst({
      where: { userId: params.userId, organizationId: params.id },
      select: { role: true, user: { select: { name: true } } },
    });
    return membership
      ? { role: membership.role, name: membership.user.name }
      : null;
  }

  private async projectMember(params: Record<string, string | undefined>) {
    if (!params.userId || !params.projectId) {
      return null;
    }
    const membership = await this.prisma.projectMembership.findFirst({
      where: { userId: params.userId, projectId: params.projectId },
      select: { role: true, user: { select: { name: true } } },
    });
    return membership
      ? { role: membership.role, name: membership.user.name }
      : null;
  }

  private async attachment(params: Record<string, string | undefined>) {
    if (!params.attachmentId || !params.taskId) {
      return null;
    }
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: params.attachmentId, taskId: params.taskId },
      select: { fileName: true, task: { select: { title: true } } },
    });
    return attachment
      ? { fileName: attachment.fileName, taskTitle: attachment.task.title }
      : null;
  }
}
