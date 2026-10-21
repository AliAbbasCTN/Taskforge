import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPaginated } from '../common/pagination/pagination';
import { TASK_INCLUDE, flattenLabels } from '../tasks/task-include';
import { SearchTasksQueryDto } from './dto/search-tasks-query.dto';
import {
  buildCountQuery,
  buildPageQuery,
  buildSearchConditions,
  buildSearchOrderBy,
} from './task-search.sql';

/** What the page query returns per match. */
interface PageRow {
  id: string;
  score: number;
  titleHighlight: string;
  snippet: string | null;
}

/**
 * Search results also say where each task lives, so a result can link to its
 * board and show its column.
 */
const SEARCH_INCLUDE = {
  ...TASK_INCLUDE,
  column: { select: { id: true, name: true, boardId: true } },
} satisfies Prisma.TaskInclude;

/**
 * WHAT: Full-text search over a project's tasks.
 *
 * WHERE: Injected into `SearchController`. The guards have already proven the
 * requester may see this project; the SQL is scoped to it (`b.project_id`),
 * so results can never include another project's - or another organization's -
 * tasks.
 *
 * HOW (two phases, because each tool does what it is good at):
 *  1. RAW SQL finds the matching task ids for the requested page, in order,
 *     with scores and highlighted fragments. Only SQL can use the full-text
 *     index and rank.
 *  2. PRISMA then loads those tasks WITH their assignee, labels and column in
 *     one query (`id IN (...)`), reusing the same shapes as every other task
 *     endpoint. The rows are put back into search order in memory.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async searchTasks(projectId: string, query: SearchTasksQueryDto) {
    const conditions = buildSearchConditions(projectId, query);
    const orderBy = buildSearchOrderBy(query.sortBy, query.sortOrder);

    const [countRows, pageRows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ total: number }[]>(
        buildCountQuery(query.q, conditions),
      ),
      this.prisma.$queryRaw<PageRow[]>(
        buildPageQuery(query.q, conditions, orderBy, query.page, query.pageSize),
      ),
    ]);

    const total = countRows[0]?.total ?? 0;
    if (pageRows.length === 0) {
      return toPaginated([], total, query.page, query.pageSize);
    }

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: pageRows.map((row) => row.id) } },
      include: SEARCH_INCLUDE,
    });
    const byId = new Map(tasks.map((task) => [task.id, task]));

    const items = pageRows.flatMap((row) => {
      const task = byId.get(row.id);
      // A task deleted between the two queries simply drops out of the page.
      return task
        ? [
            {
              ...flattenLabels(task),
              score: row.score,
              titleHighlight: row.titleHighlight,
              snippet: row.snippet,
            },
          ]
        : [];
    });

    return toPaginated(items, total, query.page, query.pageSize);
  }
}
