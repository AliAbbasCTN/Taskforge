import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CommentsService } from './comments.service';

/**
 * UNIT tests for WHO may do WHAT to a comment - the rules the route-level
 * guards cannot express because they depend on which comment it is.
 */
describe('CommentsService', () => {
  let service: CommentsService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    task: { findFirst: jest.Mock };
    comment: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const boardId = 'board-1';
  const taskId = 'task-1';
  const commentId = 'comment-1';
  const author = 'user-author';
  const other = 'user-other';

  beforeEach(() => {
    prisma = {
      task: {
        findFirst: jest.fn().mockResolvedValue({
          id: taskId,
          title: 'Discuss me',
          assigneeId: null,
          column: { board: { projectId: 'project-1' } },
        }),
      },
      comment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: commentId, authorId: author }),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    notifications = { notify: jest.fn() };
    service = new CommentsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('scoping', () => {
    it('404s for a task that is not on this board, on every operation', async () => {
      prisma.task.findFirst.mockResolvedValue(null);

      await expect(service.list(boardId, taskId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.create(boardId, taskId, author, 'hi'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });

    it('404s for a comment that is not on this task/board', async () => {
      prisma.comment.findFirst.mockResolvedValue(null);

      await expect(
        service.update(boardId, taskId, commentId, author, 'x'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.remove(boardId, taskId, commentId, author, true),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.comment.findFirst).toHaveBeenCalledWith({
        where: { id: commentId, taskId, task: { column: { boardId } } },
      });
    });
  });

  describe('create', () => {
    it('records the requester as the author', async () => {
      prisma.comment.create.mockResolvedValue({ id: 'new' });

      await service.create(boardId, taskId, author, 'Looks good');

      expect(prisma.comment.create.mock.calls[0][0].data).toEqual({
        taskId,
        authorId: author,
        body: 'Looks good',
      });
    });
  });

  describe('notifying the assignee', () => {
    it('tells the task assignee when someone comments', async () => {
      prisma.task.findFirst.mockResolvedValue({
        id: taskId,
        title: 'Discuss me',
        assigneeId: 'user-assignee',
        column: { board: { projectId: 'project-1' } },
      });
      prisma.comment.create.mockResolvedValue({ id: 'new' });

      await service.create(boardId, taskId, author, 'Looks good');

      expect(notifications.notify).toHaveBeenCalledWith({
        recipientId: 'user-assignee',
        actorId: author,
        type: NotificationType.COMMENT_ADDED,
        projectId: 'project-1',
        boardId,
        taskId,
        subject: 'Discuss me',
      });
    });

    it('notifies no one when the task has no assignee', async () => {
      prisma.comment.create.mockResolvedValue({ id: 'new' });

      await service.create(boardId, taskId, author, 'Anyone?');

      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('lets the author edit and stamps editedAt', async () => {
      prisma.comment.update.mockResolvedValue({ id: commentId });

      await service.update(boardId, taskId, commentId, author, 'Fixed typo');

      const { data } = prisma.comment.update.mock.calls[0][0];
      expect(data.body).toBe('Fixed typo');
      expect(data.editedAt).toBeInstanceOf(Date);
    });

    it('forbids anyone else from editing - even a moderator is not offered the option', async () => {
      await expect(
        service.update(boardId, taskId, commentId, other, 'Hijack'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.comment.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lets the author delete their own comment', async () => {
      await service.remove(boardId, taskId, commentId, author, false);

      expect(prisma.comment.delete).toHaveBeenCalledWith({
        where: { id: commentId },
      });
    });

    it('lets a moderator delete a comment written by someone else', async () => {
      await service.remove(boardId, taskId, commentId, other, true);

      expect(prisma.comment.delete).toHaveBeenCalled();
    });

    it('forbids a non-author, non-moderator', async () => {
      await expect(
        service.remove(boardId, taskId, commentId, other, false),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.comment.delete).not.toHaveBeenCalled();
    });
  });
});
