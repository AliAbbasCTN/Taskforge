import { Prisma } from '@prisma/client';
import { startOfTodayUtc } from '../tasks/task-query';
import {
  SearchTasksQueryDto,
  TaskSearchSortField,
} from './dto/search-tasks-query.dto';

/**
 * WHAT: Builds the SQL for task search.
 *
 * WHY raw SQL here (Prisma cannot do this): Prisma's query builder has no
 * `@@` text-search match, `ts_rank_cd` ranking, or `ts_headline` highlighting
 * for the `tsvector` column. This is the one place TaskForge drops to SQL, and
 * it is built to stay injection-proof:
 *
 *  - Every value that came from a request (`q`, ids, the priority, dates, page
 *    numbers) is passed as a BOUND PARAMETER - `${value}` inside Prisma's `sql`
 *    tag does not paste the value into the text, it sends it to PostgreSQL
 *    separately, as data. The SQL text is therefore a constant.
 *  - The only things chosen by the client that affect the SQL's *shape* - the
 *    sort field and direction - are looked up in a `switch` of fixed
 *    fragments. A client string is never turned into SQL text.
 *  - `websearch_to_tsquery` is PostgreSQL's parser for text typed by end
 *    users: it never raises a syntax error, whatever is typed.
 *
 * ID parameters are cast (`::uuid`): `$queryRaw` sends strings as plain text
 * and PostgreSQL will not compare a `uuid` column to text without the cast.
 */

/** Marks the start/end of a matched word in `titleHighlight` and `snippet`. */
export const HIGHLIGHT_START = '⟦';
export const HIGHLIGHT_END = '⟧';

// Options for `ts_headline`, passed as parameters. The markers are plain
// characters, NOT HTML: the frontend turns them into <mark> itself, so user
// text is never rendered as markup.
export const TITLE_HEADLINE_OPTIONS = `StartSel="${HIGHLIGHT_START}", StopSel="${HIGHLIGHT_END}"`;
export const SNIPPET_HEADLINE_OPTIONS = `StartSel="${HIGHLIGHT_START}", StopSel="${HIGHLIGHT_END}", MaxWords=30, MinWords=12`;

/** The user's text, parsed once into a tsquery named `q.query`. */
export function withSearchQuery(term: string): Prisma.Sql {
  return Prisma.sql`WITH q AS (SELECT websearch_to_tsquery('english', ${term}) AS query)`;
}

/** Tasks joined up to their board (the project is found through the board). */
const FROM_TASKS = Prisma.sql`FROM tasks t
  JOIN board_columns c ON c.id = t.column_id
  JOIN boards b ON b.id = c.board_id
  CROSS JOIN q`;

/**
 * The WHERE conditions, ANDed together. The first two are always present:
 * scoping to the project the guards verified, and the text match itself.
 *
 * "Overdue" is deliberately the same rule as the board/list filters: due
 * before the start of today (UTC).
 */
export function buildSearchConditions(
  projectId: string,
  query: SearchTasksQueryDto,
  now: Date = new Date(),
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`b.project_id = ${projectId}::uuid`,
    Prisma.sql`t.search_vector @@ q.query`,
  ];

  if (query.boardId) {
    conditions.push(Prisma.sql`b.id = ${query.boardId}::uuid`);
  }
  if (query.columnId) {
    conditions.push(Prisma.sql`c.id = ${query.columnId}::uuid`);
  }
  if (query.priority) {
    conditions.push(Prisma.sql`t.priority = ${query.priority}::"TaskPriority"`);
  }
  if (query.assigneeId) {
    conditions.push(Prisma.sql`t.assignee_id = ${query.assigneeId}::uuid`);
  }
  if (query.labelId) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM task_labels tl
      WHERE tl.task_id = t.id AND tl.label_id = ${query.labelId}::uuid
    )`);
  }
  if (query.overdue) {
    // A timestamp string cast to `timestamp` (no time zone) keeps the UTC
    // wall-clock value, matching how `due_date` is stored.
    conditions.push(
      Prisma.sql`t.due_date < ${startOfTodayUtc(now).toISOString()}::timestamp`,
    );
  }
  return conditions;
}

/**
 * The ORDER BY for a sort choice - always TOTAL (ending in `t.id`), so a row
 * can't land on two pages or none while paging. Relevance ranks the best text
 * matches first; `ts_rank_cd` rewards matches that are close together, and
 * title matches outrank description matches because of the A/B weights.
 */
export function buildSearchOrderBy(
  sortBy: TaskSearchSortField,
  order: 'asc' | 'desc',
): Prisma.Sql {
  const direction = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  switch (sortBy) {
    case 'dueDate':
      // Undated tasks last in either direction, as in the list view.
      return Prisma.sql`t.due_date ${direction} NULLS LAST, t.id ASC`;
    case 'priority':
      // Enum columns sort by declared order: LOW < MEDIUM < HIGH < URGENT.
      return Prisma.sql`t.priority ${direction}, t.id ASC`;
    case 'title':
      return Prisma.sql`t.title ${direction}, t.id ASC`;
    case 'createdAt':
      return Prisma.sql`t.created_at ${direction}, t.id ASC`;
    case 'relevance':
    default:
      return Prisma.sql`ts_rank_cd(t.search_vector, q.query) DESC, t.created_at DESC, t.id ASC`;
  }
}

/** How many tasks match, ignoring paging. */
export function buildCountQuery(
  term: string,
  conditions: Prisma.Sql[],
): Prisma.Sql {
  return Prisma.sql`${withSearchQuery(term)}
    SELECT count(*)::int AS total
    ${FROM_TASKS}
    WHERE ${Prisma.join(conditions, ' AND ')}`;
}

/**
 * One page of matches: ids in display order, each with its relevance score and
 * highlighted title/description fragments.
 *
 * Two steps in one statement: `matches` numbers every matching task in display
 * order (`row_number`), and the outer SELECT keeps only the requested page
 * and ONLY THEN computes `ts_headline`, which is expensive - so it runs for
 * (at most) pageSize rows, not for every match.
 */
export function buildPageQuery(
  term: string,
  conditions: Prisma.Sql[],
  orderBy: Prisma.Sql,
  page: number,
  pageSize: number,
): Prisma.Sql {
  const offset = (page - 1) * pageSize;
  return Prisma.sql`${withSearchQuery(term)},
    matches AS (
      SELECT t.id,
             ts_rank_cd(t.search_vector, q.query) AS score,
             row_number() OVER (ORDER BY ${orderBy}) AS ord
      ${FROM_TASKS}
      WHERE ${Prisma.join(conditions, ' AND ')}
    )
    SELECT m.id,
           m.score,
           ts_headline('english', t.title, q.query, ${TITLE_HEADLINE_OPTIONS}) AS "titleHighlight",
           CASE WHEN t.description IS NULL THEN NULL
                ELSE ts_headline('english', t.description, q.query, ${SNIPPET_HEADLINE_OPTIONS})
           END AS snippet
    FROM matches m
    JOIN tasks t ON t.id = m.id
    CROSS JOIN q
    WHERE m.ord > ${offset} AND m.ord <= ${offset + pageSize}
    ORDER BY m.ord`;
}
