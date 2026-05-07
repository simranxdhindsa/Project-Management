import { useState, useEffect, useCallback } from 'react'
import api from '@/services/api'
import type { NotificationItem } from '@/services/api'

type Filter = 'all' | 'unread' | 'task' | 'slack' | 'system'

const PAGE_SIZE = 100

function getIcon(type: string) {
  switch (type) {
    case 'task_assigned':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      )
    case 'task_completed':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      )
    case 'task_updated':
    case 'task_status_changed':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      )
    case 'task_overdue':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )
    case 'mentioned':
    case 'slack_analysis':
    case 'slack_followup':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    case 'discrepancy':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      )
  }
}

function getTypeClass(type: string) {
  if (type === 'task_assigned') return 'type-assigned'
  if (type === 'task_completed') return 'type-completed'
  if (type === 'task_updated' || type === 'task_status_changed') return 'type-changed'
  if (type === 'task_overdue') return 'type-overdue'
  if (type === 'discrepancy') return 'type-warning'
  if (type === 'slack_analysis' || type === 'mentioned' || type === 'slack_followup') return 'type-ai'
  return ''
}

function matchesFilter(notif: NotificationItem, filter: Filter) {
  if (filter === 'all') return true
  if (filter === 'unread') return !notif.read
  if (filter === 'task') return notif.type.startsWith('task_')
  if (filter === 'slack') return notif.type.includes('slack') || notif.type === 'mentioned'
  if (filter === 'system') return notif.type === 'discrepancy' || notif.type === 'task_overdue'
  return true
}

function formatTime(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getDateLabel(dateStr: string) {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function groupByDate(items: NotificationItem[]) {
  const groups: { label: string; items: NotificationItem[] }[] = []
  let currentLabel = ''
  for (const item of items) {
    const label = getDateLabel(item.created_at)
    if (label !== currentLabel) {
      currentLabel = label
      groups.push({ label, items: [] })
    }
    groups[groups.length - 1].items.push(item)
  }
  return groups
}

export function ActivityPage() {
  const [all, setAll] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getNotifications(PAGE_SIZE)
      if (res.success && res.data) setAll(res.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = all.filter(n => matchesFilter(n, filter))
  const groups = groupByDate(filtered)
  const unreadCount = all.filter(n => !n.read).length

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsAsRead()
    setAll(prev => prev.map(n => ({ ...n, read: true })))
  }

  const handleDelete = async (id: string) => {
    await api.deleteNotification(id)
    setAll(prev => prev.filter(n => n.id !== id))
  }

  const handleMarkRead = async (id: string) => {
    await api.markNotificationAsRead(id)
    setAll(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  return (
    <div className="activity-page">
      <div className="activity-page-header">
        <div>
          <h2 className="activity-page-title">Activity</h2>
          <p className="activity-page-subtitle">All notifications and events — last 30 days</p>
        </div>
        <div className="rp-notif-actions">
          {unreadCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={handleMarkAllRead}>
              Mark all read
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="rp-notif-toolbar activity-filter-bar">
        <div className="rp-filter-toggle">
          {(['all', 'unread', 'task', 'slack', 'system'] as Filter[]).map(f => (
            <button
              key={f}
              className={`rp-filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? `All (${all.length})` :
               f === 'unread' ? `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` :
               f === 'task' ? 'Tasks' :
               f === 'slack' ? 'Slack' : 'System'}
            </button>
          ))}
        </div>
      </div>

      <div className="activity-page-body glass-card">
        {loading ? (() => {
          const sk = (w: number | string, h: number, r = 6) => (
            <div className="skeleton" style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }} />
          )
          // Realistic counts per date group: Today 8, Yesterday 6, Earlier 11
          const groups = [8, 6, 11]
          const titleW = ['55%','72%','48%','65%','80%','43%','68%','58%','75%','50%','62%','71%','45%']
          const bodyW  = ['80%','65%','90%','70%','55%','85%','75%','60%','88%','68%','78%','52%','82%']
          return (
            <div className="notification-list">
              {groups.map((count, gi) => (
                <div key={gi}>
                  {/* Date label skeleton */}
                  <div className="activity-date-label" style={{ display: 'flex', alignItems: 'center' }}>
                    {sk(80 + gi * 15, 11, 4)}
                  </div>
                  {Array.from({ length: count }).map((_, ri) => (
                    <div key={ri} className="notification-item read" style={{ cursor: 'default' }}>
                      {/* Icon circle */}
                      <div className="notification-icon">{sk(32, 32, '50%')}</div>
                      {/* Content: title + body + time */}
                      <div className="notification-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {sk(titleW[(gi * 4 + ri) % titleW.length], 13, 4)}
                        {sk(bodyW[(gi * 3 + ri) % bodyW.length],   11, 4)}
                        {sk(55, 10, 4)}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        })()
        : filtered.length === 0 ? (
          <div className="notification-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p>No activity{filter !== 'all' ? ` for "${filter}"` : ''}</p>
          </div>
        ) : (
          <div className="notification-list">
            {groups.map(group => (
              <div key={group.label}>
                <div className="activity-date-label">{group.label}</div>
                {group.items.map(notif => (
                  <div
                    key={notif.id}
                    className={`notification-item ${notif.read ? 'read' : 'unread'} ${getTypeClass(notif.type)}`}
                    onClick={() => !notif.read && handleMarkRead(notif.id)}
                  >
                    <div className="notification-icon">{getIcon(notif.type)}</div>
                    <div className="notification-content">
                      <p className="notification-message"><strong>{notif.title}</strong></p>
                      <p className="activity-notif-body">{notif.message}</p>
                      <span className="notification-time">{formatTime(notif.created_at)}</span>
                    </div>
                    {!notif.read && <div className="unread-indicator" />}
                    <button
                      className="notif-delete-btn"
                      onClick={e => { e.stopPropagation(); handleDelete(notif.id) }}
                      aria-label="Dismiss"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
