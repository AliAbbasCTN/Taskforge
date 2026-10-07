import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { LabelsService } from './labels.service';

describe('LabelsService', () => {
  let service: LabelsService;
  let prisma: {
    label: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const projectId = 'project-1';
  const duplicate = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  beforeEach(() => {
    prisma = {
      label: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new LabelsService(prisma as unknown as PrismaService);
  });

  it('translates a duplicate name on create into 409', async () => {
    prisma.label.create.mockRejectedValue(duplicate());

    await expect(
      service.create(projectId, { name: 'Bug', color: '#ff0000' }),
    ).rejects.toThrow(ConflictException);
  });

  it('lets unexpected database errors through untouched', async () => {
    const boom = new Error('connection lost');
    prisma.label.create.mockRejectedValue(boom);

    await expect(
      service.create(projectId, { name: 'Bug', color: '#ff0000' }),
    ).rejects.toBe(boom);
  });

  it('requires at least one field to update', async () => {
    await expect(service.update(projectId, 'l1', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('scopes lookups to the project: a label from another project is a 404', async () => {
    prisma.label.findFirst.mockResolvedValue(null);

    await expect(
      service.update(projectId, 'foreign', { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.label.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', projectId },
    });
    expect(prisma.label.update).not.toHaveBeenCalled();

    await expect(service.remove(projectId, 'foreign')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.label.delete).not.toHaveBeenCalled();
  });

  it('translates a duplicate name on rename into 409', async () => {
    prisma.label.findFirst.mockResolvedValue({ id: 'l1' });
    prisma.label.update.mockRejectedValue(duplicate());

    await expect(
      service.update(projectId, 'l1', { name: 'Taken' }),
    ).rejects.toThrow(ConflictException);
  });
});
