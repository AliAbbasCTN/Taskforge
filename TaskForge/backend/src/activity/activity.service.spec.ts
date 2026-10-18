import { PrismaService } from '../database/prisma.service';
import { ActivityService } from './activity.service';
import { ListActivityQueryDto } from './dto/list-activity-query.dto';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';

const query = (o: Partial<ListActivityQueryDto> = {}) =>
  ({ page: 1, pageSize: 20, ...o }) as ListActivityQueryDto;

describe('ActivityService', () => {
  let service: ActivityService;
  let prisma: {
    user: { findUnique: jest.Mock };
    activityLog: {
      createMany: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Lena Lead' }) },
      activityLog: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockReturnValue('COUNT'),
        findMany: jest.fn().mockReturnValue('ROWS'),
      },
      $transaction: jest.fn(),
    };
    service = new ActivityService(prisma as unknown as PrismaService);
  });

  describe('record', () => {
    it('does nothing at all for an empty list', async () => {
      await service.record(ACTOR, []);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.activityLog.createMany).not.toHaveBeenCalled();
    });

    it("stores every entry in ONE insert, with the actor's name copied in", async () => {
      await service.record(ACTOR, [
        {
          organizationId: ORG,
          projectId: PROJECT,
          action: 'task.created',
          targetType: 'task',
          targetName: 'A',
        },
        {
          organizationId: ORG,
          action: 'project.created',
          targetType: 'project',
        },
      ]);

      expect(prisma.activityLog.createMany).toHaveBeenCalledTimes(1);
      const { data } = prisma.activityLog.createMany.mock.calls[0][0];
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        organizationId: ORG,
        projectId: PROJECT,
        actorId: ACTOR,
        actorName: 'Lena Lead',
        action: 'task.created',
        targetName: 'A',
      });
      expect(data[1]).toMatchObject({
        projectId: null,
        taskId: null,
        targetId: null,
        targetName: null,
      });
    });

    it('stamps entries from one request 1 ms apart, in order, so the feed keeps their sequence', async () => {
      await service.record(ACTOR, [
        { organizationId: ORG, action: 'task.updated', targetType: 'task' },
        { organizationId: ORG, action: 'task.assigned', targetType: 'task' },
        { organizationId: ORG, action: 'task.moved', targetType: 'task' },
      ]);
      const { data } = prisma.activityLog.createMany.mock.calls[0][0];
      const times = data.map((d: { createdAt: Date }) => d.createdAt.getTime());
      expect(times[1] - times[0]).toBe(1);
      expect(times[2] - times[1]).toBe(1);
    });

    it('drops undefined metadata values and stores nothing for empty metadata', async () => {
      await service.record(ACTOR, [
        {
          organizationId: ORG,
          action: 'task.created',
          targetType: 'task',
          metadata: { priority: 'HIGH', assigneeName: undefined },
        },
        {
          organizationId: ORG,
          action: 'task.deleted',
          targetType: 'task',
          metadata: { only: undefined },
        },
      ]);
      const { data } = prisma.activityLog.createMany.mock.calls[0][0];
      expect(data[0].metadata).toEqual({ priority: 'HIGH' });
      expect(data[1].metadata).toBeUndefined();
    });

    it('truncates an over-long target name to fit the column', async () => {
      await service.record(ACTOR, [
        {
          organizationId: ORG,
          action: 'task.created',
          targetType: 'task',
          targetName: 'x'.repeat(400),
        },
      ]);
      const { data } = prisma.activityLog.createMany.mock.calls[0][0];
      expect(data[0].targetName).toHaveLength(255);
    });

    it('still records (with no actor name) if the actor row cannot be found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await service.record(ACTOR, [
        { organizationId: ORG, action: 'task.created', targetType: 'task' },
      ]);
      expect(
        prisma.activityLog.createMany.mock.calls[0][0].data[0].actorName,
      ).toBeNull();
    });
  });

  describe('reading', () => {
    beforeEach(() => {
      prisma.$transaction.mockResolvedValue([
        1,
        [
          {
            id: 'a1',
            action: 'task.moved',
            targetType: 'task',
            targetId: 't1',
            targetName: 'Fix login',
            projectId: PROJECT,
            taskId: 't1',
            metadata: { from: 'To Do', to: 'Done' },
            actorId: ACTOR,
            actorName: 'Lena Lead',
            createdAt: new Date('2026-10-18T10:00:00Z'),
          },
        ],
      ]);
    });

    it('a project feed is always scoped to its organization AND project', async () => {
      await service.listForProject(ORG, PROJECT, query());
      expect(prisma.activityLog.count.mock.calls[0][0].where).toEqual({
        organizationId: ORG,
        projectId: PROJECT,
      });
    });

    it('the audit trail is scoped to the organization and may filter by project', async () => {
      await service.listForOrganization(ORG, query());
      expect(prisma.activityLog.count.mock.calls[0][0].where).toEqual({
        organizationId: ORG,
      });

      await service.listForOrganization(ORG, query({ projectId: PROJECT }));
      expect(prisma.activityLog.count.mock.calls[1][0].where).toEqual({
        organizationId: ORG,
        projectId: PROJECT,
      });
    });

    it('a project feed ignores a projectId filter from the query string', async () => {
      await service.listForProject(
        ORG,
        PROJECT,
        query({ projectId: 'other-project' }),
      );
      expect(prisma.activityLog.count.mock.calls[0][0].where.projectId).toBe(
        PROJECT,
      );
    });

    it('applies action, actor, task and date-range filters', async () => {
      await service.listForOrganization(
        ORG,
        query({
          action: 'task.moved',
          actorId: ACTOR,
          taskId: 't1',
          from: '2026-10-01T00:00:00Z',
          to: '2026-10-31T00:00:00Z',
        }),
      );
      expect(prisma.activityLog.count.mock.calls[0][0].where).toEqual({
        organizationId: ORG,
        action: 'task.moved',
        actorId: ACTOR,
        taskId: 't1',
        createdAt: {
          gte: new Date('2026-10-01T00:00:00Z'),
          lte: new Date('2026-10-31T00:00:00Z'),
        },
      });
    });

    it('orders newest first with the id as tie-breaker, and pages', async () => {
      await service.listForOrganization(ORG, query({ page: 3, pageSize: 10 }));
      expect(prisma.activityLog.findMany.mock.calls[0][0]).toMatchObject({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 20,
        take: 10,
      });
    });

    it('returns a sentence, the snapshot names and no internal columns', async () => {
      const result = await service.listForProject(ORG, PROJECT, query());

      expect(result.items[0]).toEqual({
        id: 'a1',
        action: 'task.moved',
        message: 'moved task “Fix login” from To Do to Done',
        targetType: 'task',
        targetId: 't1',
        targetName: 'Fix login',
        projectId: PROJECT,
        taskId: 't1',
        metadata: { from: 'To Do', to: 'Done' },
        actorId: ACTOR,
        actorName: 'Lena Lead',
        createdAt: new Date('2026-10-18T10:00:00Z'),
      });
      expect(result).toMatchObject({
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });
  });
});
