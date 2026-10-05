import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BoardGuard } from './board.guard';

describe('BoardGuard', () => {
  let guard: BoardGuard;
  let prisma: { board: { findUnique: jest.Mock } };

  const projectId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const boardId = 'bbbbbbbb-0000-4000-8000-000000000001';

  const contextFor = (request: object): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    prisma = { board: { findUnique: jest.fn() } };
    guard = new BoardGuard(prisma as unknown as PrismaService);
  });

  it('lets a board through that belongs to the resolved project, and attaches it', async () => {
    prisma.board.findUnique.mockResolvedValue({ id: boardId, projectId });
    const request: { board?: { id: string } } & Record<string, unknown> = {
      params: { boardId },
      project: { id: projectId },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.board?.id).toBe(boardId);
  });

  it('returns 404 for a board that belongs to a DIFFERENT project', async () => {
    prisma.board.findUnique.mockResolvedValue({
      id: boardId,
      projectId: 'some-other-project',
    });

    await expect(
      guard.canActivate(
        contextFor({ params: { boardId }, project: { id: projectId } }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns 404 for a board that does not exist', async () => {
    prisma.board.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        contextFor({ params: { boardId }, project: { id: projectId } }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('treats a malformed board ID as not found WITHOUT querying the database', async () => {
    await expect(
      guard.canActivate(
        contextFor({
          params: { boardId: 'not-a-uuid' },
          project: { id: projectId },
        }),
      ),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.board.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when ProjectGuard did not run first', async () => {
    await expect(
      guard.canActivate(contextFor({ params: { boardId } })),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.board.findUnique).not.toHaveBeenCalled();
  });
});
