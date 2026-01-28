import { NotificationItem } from './NotificationItem'
import type { Notification } from '../../services/api'

interface NotificationPanelProps {
  notifications: Notification[]
  loading: boolean
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
  onClose: () => void
}

export function NotificationPanel({
  notifications,
  loading,
  onMarkAsRead,
  onMarkAllAsRead,
  onClose,
}: NotificationPanelProps) {
  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className="notification-panel glass-card">
      <div className="notification-panel-header">
        <h3>Notifications</h3>
        {unreadCount > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onMarkAllAsRead}
          >
            Mark all as read
          </button>
        )}
      </div>

      <div className="notification-panel-content">
        {loading ? (
          <div className="notification-loading">
            <div className="loading-spinner" />
            <p>Loading notifications...</p>
          </div>
        ) : notifications.length > 0 ? (
          <div className="notification-list">
            {notifications.map(notification => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={onMarkAsRead}
              />
            ))}
          </div>
        ) : (
          <div className="notification-empty">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p>No notifications</p>
          </div>
        )}
      </div>

      <div className="notification-panel-footer">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
