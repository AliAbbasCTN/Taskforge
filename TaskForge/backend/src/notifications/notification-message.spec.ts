import { NotificationType } from '@prisma/client';
import { buildNotificationMessage, truncate } from './notification-message';

describe('buildNotificationMessage', () => {
  it('words each notification type', () => {
    expect(
      buildNotificationMessage(
        NotificationType.TASK_ASSIGNED,
        'Ada',
        'Fix login',
      ),
    ).toBe('Ada assigned you "Fix login"');
    expect(
      buildNotificationMessage(
        NotificationType.COMMENT_ADDED,
        'Ada',
        'Fix login',
      ),
    ).toBe('Ada commented on "Fix login"');
    expect(
      buildNotificationMessage(
        NotificationType.ADDED_TO_PROJECT,
        'Ada',
        'Apollo',
      ),
    ).toBe('Ada added you to the project "Apollo"');
  });

  it('says "Someone" when the actor is unknown', () => {
    expect(
      buildNotificationMessage(NotificationType.TASK_ASSIGNED, null, 'X'),
    ).toBe('Someone assigned you "X"');
  });

  it('keeps even a worst-case message inside the 300-character column', () => {
    const message = buildNotificationMessage(
      NotificationType.ADDED_TO_PROJECT,
      'N'.repeat(100),
      'S'.repeat(200),
    );

    expect(message.length).toBeLessThanOrEqual(300);
    expect(message).toContain('…');
  });
});

describe('truncate', () => {
  it('leaves short text alone and cuts long text with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });
});
