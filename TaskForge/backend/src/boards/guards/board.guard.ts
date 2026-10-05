import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { isUuid } from '../../common/utils/is-uuid';

/**
 * WHAT: Verifies that the `:boardId` in the route belongs to the project
 * `ProjectGuard` already resolved, and attaches the board to the request.
 *
 * WHY this is needed even though the requester has already proven they may
 * see the project: without it, a real `boardId` from ANOTHER project - one
 * the requester cannot see, in this or any other organization - could be
 * substituted into a URL under a project they legitimately belong to. This
 * is the same IDOR pattern `TeamGuard` and `ProjectGuard` close at their
 * levels; every extra level of nesting needs its own ownership check.
 * Checking `board.projectId === request.project.id` is enough to cover the
 * whole chain, because `ProjectGuard` already tied that project to the
 * organization and the requester.
 *
 * WHY 404: a board that doesn't exist and a board that belongs elsewhere
 * must be indistinguishable.
 *
 * WHERE: controller-level `@UseGuards(..., ProjectGuard, BoardGuard)` on
 * every route nested under `/boards/:boardId`.
 */
@Injectable()
export class BoardGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const boardId: string | undefined = request.params?.boardId;
    const project = request.project;

    // Malformed IDs are "not found", not a database error - see `isUuid`.
    if (!isUuid(boardId) || !project) {
      throw new NotFoundException('Board not found');
    }

    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
    });

    if (!board || board.projectId !== project.id) {
      throw new NotFoundException('Board not found');
    }

    request.board = board;
    return true;
  }
}
