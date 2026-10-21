import {
  SearchTasksQueryDto,
  TaskSearchSortField,
} from './dto/search-tasks-query.dto';
import {
  buildCountQuery,
  buildPageQuery,
  buildSearchConditions,
  buildSearchOrderBy,
} from './task-search.sql';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

const dto = (overrides: Partial<SearchTasksQueryDto> = {}) =>
  ({
    q: 'login',
    page: 1,
    pageSize: 20,
    sortBy: 'relevance',
    sortOrder: 'desc',
    ...overrides,
  }) as SearchTasksQueryDto;

const build = (overrides: Partial<SearchTasksQueryDto> = {}) => {
  const query = dto(overrides);
  const conditions = buildSearchConditions(PROJECT, query, new Date('2026-10-17T15:30:00Z'));
  return {
    count: buildCountQuery(query.q, conditions),
    page: buildPageQuery(
      query.q,
      conditions,
      buildSearchOrderBy(query.sortBy, query.sortOrder),
      query.page,
      query.pageSize,
    ),
  };
};

describe('task search SQL', () => {
  describe('injection safety', () => {
    const hostile = [
      "'; DROP TABLE tasks; --",
      '" OR 1=1 --',
      "login') UNION SELECT password_hash FROM users --",
    ];

    it.each(hostile)('never puts the search text %j into the SQL text', (q) => {
      const { count, page } = build({ q });
      for (const sql of [count, page]) {
        expect(sql.text).not.toContain('DROP TABLE');
        expect(sql.text).not.toContain('UNION');
        expect(sql.text).not.toContain('OR 1=1');
        expect(sql.values).toContain(q);
      }
    });

    it('sends every id and filter as a parameter, not as text', () => {
      const { page } = build({
        boardId: ID,
        columnId: ID,
        assigneeId: ID,
        labelId: ID,
        priority: 'HIGH',
        overdue: true,
      });
      expect(page.text).not.toContain(ID);
      expect(page.text).not.toContain('HIGH');
      expect(page.values).toContain(PROJECT);
      expect(page.values).toContain('HIGH');
      expect(page.values.filter((v) => v === ID)).toHaveLength(4);
    });
  });

  describe('conditions', () => {
    it('always scopes to the project and requires a text match', () => {
      const conditions = buildSearchConditions(PROJECT, dto());
      expect(conditions).toHaveLength(2);
      expect(conditions[0].text).toContain('b.project_id =');
      expect(conditions[0].text).toContain('::uuid');
      expect(conditions[1].text).toBe('t.search_vector @@ q.query');
    });

    it('adds one condition per filter', () => {
      const all = buildSearchConditions(
        PROJECT,
        dto({ boardId: ID, columnId: ID, priority: 'URGENT', assigneeId: ID, labelId: ID, overdue: true }),
      );
      expect(all).toHaveLength(8);
      const text = all.map((c) => c.text).join(' | ');
      expect(text).toContain('b.id =');
      expect(text).toContain('c.id =');
      expect(text).toContain('::"TaskPriority"');
      expect(text).toContain('t.assignee_id =');
      expect(text).toContain('task_labels');
      expect(text).toContain('t.due_date <');
    });

    it('treats "overdue" as before the start of today (UTC), cast to timestamp', () => {
      const conditions = buildSearchConditions(
        PROJECT,
        dto({ overdue: true }),
        new Date('2026-10-17T15:30:00Z'),
      );
      const overdue = conditions[conditions.length - 1];
      expect(overdue.text).toContain('t.due_date <');
      expect(overdue.text).toContain('::timestamp');
      expect(overdue.values).toEqual(['2026-10-17T00:00:00.000Z']);
    });
  });

  describe('ordering', () => {
    const order = (sortBy: TaskSearchSortField, dir: 'asc' | 'desc' = 'desc') =>
      buildSearchOrderBy(sortBy, dir).text;

    it('ranks by relevance by default, newest first on ties', () => {
      expect(order('relevance')).toContain('ts_rank_cd(t.search_vector, q.query) DESC');
      expect(order('relevance', 'asc')).toContain('DESC'); // sortOrder is ignored
    });

    it('honours the direction for column sorts and always ends with the id tie-breaker', () => {
      expect(order('createdAt', 'asc')).toBe('t.created_at ASC, t.id ASC');
      expect(order('title', 'desc')).toBe('t.title DESC, t.id ASC');
      expect(order('priority', 'desc')).toBe('t.priority DESC, t.id ASC');
      expect(order('dueDate', 'asc')).toBe('t.due_date ASC NULLS LAST, t.id ASC');
      expect(order('dueDate', 'desc')).toBe('t.due_date DESC NULLS LAST, t.id ASC');
    });
  });

  describe('paging', () => {
    it('keeps only the requested window of numbered matches', () => {
      const { page } = build({ page: 3, pageSize: 20 });
      expect(page.text).toContain('m.ord >');
      expect(page.text).toContain('m.ord <=');
      expect(page.values).toContain(40);
      expect(page.values).toContain(60);
    });

    it('computes the expensive highlights only for the outer (paged) rows', () => {
      const { page, count } = build();
      expect(page.text.indexOf('matches AS')).toBeLessThan(page.text.indexOf('ts_headline'));
      expect(page.text).not.toContain('LIMIT');
      expect(count.text).not.toContain('ts_headline');
      expect(count.text).toContain('count(*)::int AS total');
    });
  });
});
