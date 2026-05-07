import { useState, useEffect, useCallback } from 'react'
import api from '../../services/api'
import type { NotificationItem, ActivityItem } from '../../services/api'
import { NotificationItem as NotifItem } from './NotificationItem'
import { ActivityFeed } from './ActivityFeed'

type Tab = 'notifications' | 'activity'

export interface LocalNotification {
  id: string
  type: 'backward_move' | 'sync_issue'
  issueId: string
  summary: string
  fromState: string
  toState: string
  timestamp: Date
  read: boolean
}

interface RightPanelProps {
  onClose: () => void
  initialTab?: Tab
  localNotifications?: LocalNotification[]
  onMoveToBlocked?: (notif: LocalNotification) => void
  onDismissLocal?: (id: string) => void
}

const ACTIVITY_PAGE_SIZE = 30

export function RightPanel({
  onClose,
  initialTab = 'notifications',
  localNotifications = [],
  onMoveToBlocked,
  onDismissLocal,
}: RightPanelProps) {
  const [tab, setTab] = useState<Tab>(initialTab)

  // — Notification state —
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notifsLoading, setNotifsLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  // — Activity state —
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityOffset, setActivityOffset] = useState(0)
  const [activityHasMore, setActivityHasMore] = useState(true)

  const fetchNotifications = useCallback(async () => {
    setNotifsLoading(true)
    try {
      const res = await api.getNotifications(100)
      if (res.success && res.data) setNotifications(res.data)
    } finally {
      setNotifsLoading(false)
    }
  }, [])

  const fetchActivity = useCallback(async (offset: number, append = false) => {
    setActivityLoading(true)
    try {
      const res = await api.getActivity(ACTIVITY_PAGE_SIZE, offset)
      if (res.success && res.data) {
        const items = res.data
        setActivityItems(prev => append ? [...prev, ...items] : items)
        setActivityHasMore(items.length === ACTIVITY_PAGE_SIZE)
        setActivityOffset(offset + items.length)
      }
    } finally {
      setActivityLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  useEffect(() => {
    if (tab === 'activity' && activityItems.length === 0) {
      fetchActivity(0)
    }
  }, [tab, activityItems.length, fetchActivity])

  const handleMarkAsRead = async (id: string) => {
    await api.markNotificationAsRead(id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  const handleMarkAllAsRead = async () => {
    await api.markAllNotificationsAsRead()
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  const handleClearAll = async () => {
    await api.clearAllNotifications()
    setNotifications([])
  }

  const handleDeleteNotif = async (id: string) => {
    await api.deleteNotification(id)
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  const displayed = filter === 'unread'
    ? notifications.filter(n => !n.read)
    : notifications

  const serverUnreadCount = notifications.filter(n => !n.read).length
  const localUnreadCount = localNotifications.filter(n => !n.read).length
  const totalUnread = serverUnreadCount + localUnreadCount

  const hasAnyNotifs = notifications.length > 0 || localNotifications.length > 0

  return (
    <div className="right-panel glass-card">
      {/* Header */}
      <div className="right-panel-header">
        <div className="right-panel-tabs">
          <button
            className={`rp-tab ${tab === 'notifications' ? 'active' : ''}`}
            onClick={() => setTab('notifications')}
          >
            Notifications
            {totalUnread > 0 && (
              <span className="rp-tab-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
            )}
          </button>
          <button
            className={`rp-tab ${tab === 'activity' ? 'active' : ''}`}
            onClick={() => setTab('activity')}
          >
            Activity
          </button>
        </div>
        <button className="rp-close-btn" onClick={onClose} aria-label="Close panel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Notifications tab */}
      {tab === 'notifications' && (
        <>
          <div className="rp-notif-toolbar">
            <div className="rp-filter-toggle">
              <button
                className={`rp-filter-btn ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                className={`rp-filter-btn ${filter === 'unread' ? 'active' : ''}`}
                onClick={() => setFilter('unread')}
              >
                Unread {totalUnread > 0 && `(${totalUnread})`}
              </button>
            </div>
            <div className="rp-notif-actions">
              {totalUnread > 0 && (
                <button className="btn btn-ghost btn-xs" onClick={handleMarkAllAsRead}>
                  Mark all read
                </button>
              )}
              {hasAnyNotifs && (
                <button className="btn btn-ghost btn-xs rp-clear-btn" onClick={handleClearAll}>
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="right-panel-content">
            {notifsLoading ? (
              <div className="rp-loading">
                <div className="loading-spinner" />
              </div>
            ) : (localNotifications.length === 0 && displayed.length === 0) ? (
              <div className="notification-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <p>{filter === 'unread' ? 'No unread notifications' : 'No notifications'}</p>
              </div>
            ) : (
              <div className="notification-list">
                {/* Local YouTrack backward-move alerts */}
                {localNotifications.map(notif => (
                  <div
                    key={`local-${notif.id}`}
                    className={`notification-item ${notif.read ? 'read' : 'unread'} type-warning`}
                  >
                    <div className="notification-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </div>
                    <div className="notification-content">
                      <p className="notification-message">
                        <strong>{notif.issueId}</strong> moved backward: {notif.fromState} → {notif.toState}
                      </p>
                      <p className="notification-summary-text">{notif.summary}</p>
                      <div className="rp-local-actions">
                        {onMoveToBlocked && (
                          <button
                            className="btn btn-sm rp-blocked-btn"
                            onClick={() => onMoveToBlocked(notif)}
                          >
                            Move to Blocked
                          </button>
                        )}
                        {onDismissLocal && (
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => onDismissLocal(notif.id)}
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                      <span className="notification-time">
                        {notif.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {!notif.read && <div className="unread-indicator" />}
                  </div>
                ))}

                {/* Server notifications */}
                {displayed.map(n => (
                  <NotifItem
                    key={n.id}
                    notification={n}
                    onMarkAsRead={handleMarkAsRead}
                    onDelete={handleDeleteNotif}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Activity tab */}
      {tab === 'activity' && (
        <div className="right-panel-content">
          <ActivityFeed
            items={activityItems}
            loading={activityLoading}
            onLoadMore={() => fetchActivity(activityOffset, true)}
            hasMore={activityHasMore}
          />
        </div>
      )}
    </div>
  )
}
