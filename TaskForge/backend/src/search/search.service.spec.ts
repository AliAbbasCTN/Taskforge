import { PrismaService } from '../database/prisma.service';
import { SearchTasksQueryDto } from './dto/search-tasks-query.dto';
import { SearchService } from './search.service';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const query = (overrides: Partial<SearchTasksQueryDto> = {}) =>
  ({
    q: 'login',
    page: 1,
    pageSize: 20,
    sortBy: 'relevance',
    sortOrder: 'desc',
    ...overrides,
  }) as SearchTasksQueryDto;

const task = (id: string) => ({
  id,
  title: `Task ${id}`,
  assignee: null,
  labels: [{ taskId: id, labelId: 'l1', label: { id: 'l1', name: 'bug' } }],
  column: { id: 'c1', name: 'To Do', boardId: 'b1' },
});

describe('SearchService', () => {
  let service: SearchService;
  let prisma: {
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    task: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockImplementation((sql) => Promise.resolve(sql)),
      // Resolves the already-"started" queries to scripted rows.
      $transaction: jest.fn(),
      task: { findMany: jest.fn() },
    };
    service = new SearchService(prisma as unknown as PrismaService);
  });

  const script = (total: number, rows: unknown[]) =>
    prisma.$transaction.mockResolvedValue([[{ total }], rows]);

  it('returns matches in SEARCH order (not database order) with score and highlights', async () => {
    script(2, [
      { id: 'b', score: 0.9, titleHighlight: '⟦Login⟧ bug', snippet: null },
      {
        id: 'a',
        score: 0.4,
        titleHighlight: 'Fix ⟦login⟧',
        snippet: 'about ⟦login⟧',
      },
    ]);
    // Prisma returns them in arbitrary order.
    prisma.task.findMany.mockResolvedValue([task('a'), task('b')]);

    const result = await service.searchTasks(PROJECT, query());

    expect(result.items.map((item) => item.id)).toEqual(['b', 'a']);
    expect(result.items[0]).toMatchObject({
      score: 0.9,
      titleHighlight: '⟦Login⟧ bug',
      snippet: null,
      column: { id: 'c1', name: 'To Do', boardId: 'b1' },
    });
    // The join-table shape is flattened like every other task endpoint.
    expect(result.items[0].labels).toEqual([{ id: 'l1', name: 'bug' }]);
    expect(result).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });

  it("loads the page's tasks in ONE query by id (no N+1)", async () => {
    script(2, [
      { id: 'a', score: 1, titleHighlight: 'a', snippet: null },
      { id: 'b', score: 1, titleHighlight: 'b', snippet: null },
    ]);
    prisma.task.findMany.mockResolvedValue([task('a'), task('b')]);

    await service.searchTasks(PROJECT, query());

    expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.task.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['a', 'b'] },
    });
  });

  it('skips the second query when nothing matches', async () => {
    script(0, []);

    const result = await service.searchTasks(PROJECT, query());

    expect(result).toMatchObject({ items: [], total: 0, totalPages: 1 });
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('still reports the total when the requested page is past the end', async () => {
    script(5, []);

    const result = await service.searchTasks(PROJECT, query({ page: 9 }));

    expect(result).toMatchObject({
      items: [],
      total: 5,
      page: 9,
      totalPages: 1,
    });
  });

  it('drops a task that was deleted between the two queries instead of failing', async () => {
    script(2, [
      { id: 'a', score: 1, titleHighlight: 'a', snippet: null },
      { id: 'gone', score: 1, titleHighlight: 'gone', snippet: null },
    ]);
    prisma.task.findMany.mockResolvedValue([task('a')]);

    const result = await service.searchTasks(PROJECT, query());

    expect(result.items.map((item) => item.id)).toEqual(['a']);
  });
});
