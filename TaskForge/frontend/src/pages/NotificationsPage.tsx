import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorBox, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import {
  useNotificationActions,
  useNotificationList,
  useUnreadCount,
} from '../hooks/useNotifications';
import { notificationPath } from '../utils/notifications';

const PAGE_SIZE = 15;

/**
 * WHAT: The notification inbox. New notifications appear here without a
 * reload: the socket's `notification:created` event (handled in
 * `useRealtimeConnection`) invalidates these queries, and they refetch.
 *
 * The list is the SOURCE OF TRUTH, not the socket: a notification that arrived
 * while you were offline is here when you next open the page.
 */
export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notifications = useNotificationList({
    page,
    pageSize: PAGE_SIZE,
    unreadOnly,
  });
  const unread = useUnreadCount();
  const { markRead, markAllRead } = useNotificationActions();

  function showUnreadOnly(value: boolean) {
    setUnreadOnly(value);
    setPage(1);
  }

  return (
    <>
      <header className="page-header">
        <h1>Notifications</h1>
        <p>Assignments, comments on your tasks, and projects you have been added to.</p>
      </header>

      <div className="section-bar">
        <div className="segmented" role="group" aria-label="Filter notifications">
          <button
            type="button"
            aria-pressed={!unreadOnly}
            className={!unreadOnly ? 'segment is-active' : 'segment'}
            onClick={() => showUnreadOnly(false)}
          >
            All
          </button>
          <button
            type="button"
            aria-pressed={unreadOnly}
            className={unreadOnly ? 'segment is-active' : 'segment'}
            onClick={() => showUnreadOnly(true)}
          >
            Unread
          </button>
        </div>
        <button
          type="button"
          className="btn"
          disabled={!unread.data?.count || markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
        >
          Mark all as read
        </button>
      </div>

      {notifications.isError && (
        <ErrorBox
          error={notifications.error}
          onRetry={() => void notifications.refetch()}
        />
      )}
      {!notifications.data && !notifications.isError && (
        <Loading label="Loading notifications" />
      )}
      {notifications.data?.total === 0 && (
        <EmptyState
          title={unreadOnly ? "You're all caught up." : 'No notifications yet.'}
        >
          {unreadOnly
            ? undefined
            : 'You will be told here when someone assigns you a task or comments on one of yours.'}
        </EmptyState>
      )}

      {notifications.data && notifications.data.total > 0 && (
        <>
          <ul className="rows">
            {notifications.data.items.map((notification) => {
              const isUnread = notification.readAt === null;
              return (
                <li key={notification.id}>
                  <Link
                    to={notificationPath(notification)}
                    className={isUnread ? 'row notification is-unread' : 'row notification'}
                    onClick={() => {
                      if (isUnread) {
                        markRead.mutate(notification.id);
                      }
                    }}
                  >
                    <span
                      className="unread-dot"
                      role="img"
                      aria-label={isUnread ? 'Unread' : 'Read'}
                    />
                    <span className="row-main">
                      <span className="row-title">{notification.message}</span>
                      <span className="row-sub">
                        {notification.project.name},{' '}
                        {new Date(notification.createdAt).toLocaleString()}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pagination
            page={notifications.data.page}
            totalPages={notifications.data.totalPages}
            total={notifications.data.total}
            itemLabel="notification"
            onPageChange={setPage}
          />
        </>
      )}
    </>
  );
}
