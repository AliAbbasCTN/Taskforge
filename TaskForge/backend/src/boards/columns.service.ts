import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  PositionedRow,
  positionChanges,
  reorder,
} from '../common/utils/ordering';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

/**
 * WHAT: Business logic for a board's columns, including keeping their
 * `position` values dense (0,1,2...) as columns are added, moved and removed.
 *
 * WHY every method works inside `$transaction`: changing one column's
 * position means changing its neighbours' too. Without a transaction, a
 * failure half-way (or two requests interleaving) could leave two columns
 * with the same position or a gap. The transaction makes the whole
 * reorder all-or-nothing.
 *
 * WHY columns are looked up by BOTH id and board: the controller's
 * `:columnId` is untrusted. A column from a different board must be
 * indistinguishable from a column that doesn't exist, so every lookup is
 * scoped to the board `BoardGuard` already verified (the same IDOR defence
 * the guards apply at higher levels, applied here by scoping the query).
 */
@Injectable()
export class ColumnsService {
  constructor(private readonly prisma: PrismaService) {}

  create(boardId: string, dto: CreateColumnDto) {
    return this.prisma.$transaction(async (tx) => {
      const siblings = await this.siblings(tx, boardId);

      const column = await tx.boardColumn.create({
        data: { boardId, name: dto.name, position: siblings.length },
      });

      if (dto.position !== undefined) {
        const newOrder = reorder(
          [...siblings.map((s) => s.id), column.id],
          column.id,
          dto.position,
        );
        await this.persist(
          tx,
          positionChanges(
            [...siblings, { id: column.id, position: column.position }],
            newOrder,
          ),
        );
      }

      return tx.boardColumn.findUniqueOrThrow({ where: { id: column.id } });
    });
  }

  async update(boardId: string, columnId: string, dto: UpdateColumnDto) {
    if (dto.name === undefined && dto.position === undefined) {
      throw new BadRequestException(
        'Provide at least one field to update (name or position)',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const siblings = await this.siblings(tx, boardId);
      if (!siblings.some((s) => s.id === columnId)) {
        throw new NotFoundException('Column not found');
      }

      if (dto.name !== undefined) {
        await tx.boardColumn.update({
          where: { id: columnId },
          data: { name: dto.name },
        });
      }

      if (dto.position !== undefined) {
        const newOrder = reorder(
          siblings.map((s) => s.id),
          columnId,
          dto.position,
        );
        await this.persist(tx, positionChanges(siblings, newOrder));
      }

      return tx.boardColumn.findUniqueOrThrow({ where: { id: columnId } });
    });
  }

  /**
   * A column that still holds tasks cannot be deleted: silently deleting
   * (or silently relocating) someone's work as a side effect of tidying up
   * the board would be a nasty surprise. The caller must move or delete the
   * tasks first, which makes the destructive step deliberate.
   */
  async remove(boardId: string, columnId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const siblings = await this.siblings(tx, boardId);
      if (!siblings.some((s) => s.id === columnId)) {
        throw new NotFoundException('Column not found');
      }

      const taskCount = await tx.task.count({ where: { columnId } });
      if (taskCount > 0) {
        throw new ConflictException(
          'This column still has tasks. Move or delete them first',
        );
      }

      await tx.boardColumn.delete({ where: { id: columnId } });

      const remaining = siblings.filter((s) => s.id !== columnId);
      await this.persist(
        tx,
        positionChanges(
          remaining,
          remaining.map((s) => s.id),
        ),
      );
    });
  }

  private siblings(
    tx: Prisma.TransactionClient,
    boardId: string,
  ): Promise<PositionedRow[]> {
    return tx.boardColumn.findMany({
      where: { boardId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, position: true },
    });
  }

  private async persist(
    tx: Prisma.TransactionClient,
    changes: PositionedRow[],
  ): Promise<void> {
    for (const change of changes) {
      await tx.boardColumn.update({
        where: { id: change.id },
        data: { position: change.position },
      });
    }
  }
}
