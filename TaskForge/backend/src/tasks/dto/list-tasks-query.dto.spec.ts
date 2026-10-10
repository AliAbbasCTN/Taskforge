// Loaded by Nest at startup, but not by a bare Jest test.
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { createAppValidationPipe } from '../../common/pipes/app-validation.pipe';
import { ListTasksQueryDto } from './list-tasks-query.dto';

/**
 * These run query strings through the SAME pipe the real server uses
 * (`createAppValidationPipe`), so they test what clients actually experience.
 * Every value is a string, exactly as it arrives in a URL.
 */
describe('ListTasksQueryDto through the application validation pipe', () => {
  const pipe = createAppValidationPipe();
  const parse = (query: Record<string, string>) =>
    pipe.transform(query, {
      type: 'query',
      metatype: ListTasksQueryDto,
    }) as Promise<ListTasksQueryDto>;

  it('converts page and pageSize from text to numbers', async () => {
    const result = await parse({ page: '3', pageSize: '2' });

    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(2);
  });

  it('applies the defaults when nothing is supplied', async () => {
    const result = await parse({});

    expect(result).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
    );
  });

  it('parses overdue=false as false (not the truthy string)', async () => {
    expect((await parse({ overdue: 'false' })).overdue).toBe(false);
    expect((await parse({ overdue: 'true' })).overdue).toBe(true);
  });

  
  it.each<Record<string, string>>([
    { pageSize: '101' },
    { pageSize: '0' },
    { page: '0' },
    { page: 'abc' },
    { sortBy: 'passwordHash' },
    { priority: 'SOON' },
    { overdue: 'maybe' },
    { assigneeId: 'not-a-uuid' },
    { unknown: '1' },
  ])('rejects %o', async (query) => {
    await expect(parse(query)).rejects.toThrow(BadRequestException);
  });

});
