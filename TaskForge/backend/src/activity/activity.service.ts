import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPaginated, toSkipTake } from '../common/pagination/pagination';
import { formatActivityMessage } from './activity-message';
import { ActivityDraft } from './activity.types';
import { ListActivityQueryDto } from './dto/list-activity-query.dto';

const MAX_TARGET_NAME_LENGTH = 255;

/** Strips `undefined` values (JSON has none) and returns null for "nothing". */
function toJson(
  metadata: Record<string, unknown> | undefined,
): Prisma.InputJsonObject | undefined {
  if (!metadata) {
    return undefined;
  }
  const clean = JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonObject;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * WHAT: Writes and reads the activity log. There is deliberately NO update or
 * delete method: the log is append-only (and the database enforces it too).
 *
 * WRITE: `record` stores the entries one request produced. It copies the
 * actor's CURRENT NAME into each entry (`actorName`), so the history stays
 * attributable even after that account is renamed or deleted.
 *
 * READ: `listForProject` (the feed any project member sees) and
 * `listForOrganization` (the admin-only audit trail). Both always filter by
 * `organizationId` - a tenant boundary the route guards already enforce, kept in
 * the query as well so a mistake in one layer can't leak across tenants - and
 * both order newest-first with the id as tie-breaker so paging is stable.
 * No joins are needed: names are snapshots stored on the row.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(actorId: string, drafts: ActivityDraft[]): Promise<void> {
    if (drafts.length === 0) {
      return;
    }
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });
    // One request can yield several entries (a PATCH that renames AND reassigns
    // a task). A single INSERT would stamp them all with the same instant, and
    // the feed's tie-breaker (the random id) would then shuffle them. Spacing
    // them 1 ms apart, in the order they were described, keeps the story in
    // order: the assignment reads as happening after the update.
    const base = Date.now();
    await this.prisma.activityLog.createMany({
      data: drafts.map((draft, index) => ({
        createdAt: new Date(base + index),
        organizationId: draft.organizationId,
        projectId: draft.projectId ?? null,
        taskId: draft.taskId ?? null,
        actorId,
        actorName: actor?.name ?? null,
        action: draft.action,
        targetType: draft.targetType,
        targetId: draft.targetId ?? null,
        targetName: draft.targetName
          ? draft.targetName.slice(0, MAX_TARGET_NAME_LENGTH)
          : null,
        metadata: toJson(draft.metadata),
      })),
    });
  }

  listForProject(
    organizationId: string,
    projectId: string,
    query: ListActivityQueryDto,
  ) {
    return this.list(
      { organizationId, projectId, ...this.filters(query) },
      query,
    );
  }

  listForOrganization(organizationId: string, query: ListActivityQueryDto) {
    return this.list(
      {
        organizationId,
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...this.filters(query),
      },
      query,
    );
  }

  private filters(query: ListActivityQueryDto): Prisma.ActivityLogWhereInput {
    return {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.taskId ? { taskId: query.taskId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
  }

  private async list(
    where: Prisma.ActivityLogWhereInput,
    query: ListActivityQueryDto,
  ) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.activityLog.count({ where }),
      this.prisma.activityLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query.page, query.pageSize),
      }),
    ]);

    return toPaginated(
      rows.map((row) => ({
        id: row.id,
        action: row.action,
        message: formatActivityMessage(row),
        targetType: row.targetType,
        targetId: row.targetId,
        targetName: row.targetName,
        projectId: row.projectId,
        taskId: row.taskId,
        metadata: row.metadata,
        actorId: row.actorId,
        actorName: row.actorName,
        createdAt: row.createdAt,
      })),
      total,
      query.page,
      query.pageSize,
    );
  }
}
