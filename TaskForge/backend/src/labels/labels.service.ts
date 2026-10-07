import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';

/**
 * WHAT: Business logic for a project's labels.
 *
 * Labels belong to ONE project. Every lookup is scoped by `projectId` (the
 * project `ProjectGuard` already verified), so a label ID from another
 * project is indistinguishable from one that doesn't exist (404) - the same
 * scoping pattern as columns and tasks.
 */
@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService) {}

  list(projectId: string) {
    return this.prisma.label.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    });
  }

  async create(projectId: string, dto: CreateLabelDto) {
    try {
      return await this.prisma.label.create({
        data: { projectId, name: dto.name, color: dto.color },
      });
    } catch (error) {
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  async update(projectId: string, labelId: string, dto: UpdateLabelDto) {
    if (dto.name === undefined && dto.color === undefined) {
      throw new BadRequestException(
        'Provide at least one field to update (name or color)',
      );
    }
    await this.getScoped(projectId, labelId);

    try {
      return await this.prisma.label.update({
        where: { id: labelId },
        data: { name: dto.name, color: dto.color },
      });
    } catch (error) {
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  /**
   * Deleting a label removes it from every task that had it (the TaskLabel
   * rows cascade) but never touches the tasks themselves.
   */
  async remove(projectId: string, labelId: string): Promise<void> {
    await this.getScoped(projectId, labelId);
    await this.prisma.label.delete({ where: { id: labelId } });
  }

  private async getScoped(projectId: string, labelId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, projectId },
    });
    if (!label) {
      throw new NotFoundException('Label not found');
    }
    return label;
  }

  /** P2002 = unique constraint violated: this project already has that name. */
  private rethrowDuplicate(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('A label with that name already exists');
    }
  }
}
