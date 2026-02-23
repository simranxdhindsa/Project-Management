import { useState, useEffect } from 'react'
import api from '../services/api'
import type { ReminderItem, CreateReminderRequest, NotificationItem } from '../services/api'
import { useNotifications } from '../services/useNotifications'
import { Bell, Plus, Trash2, Clock, CheckCircle, AlertTriangle, Calendar, X, RefreshCw } from 'lucide-react'

export function RemindersPage() {
  const [reminders, setReminders] = useState<ReminderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // Create form state
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0])
  const [targetTime, setTargetTime] = useState('')
  const [recurring, setRecurring] = useState('none')
  const [relatedIssueId, setRelatedIssueId] = useState('')
  const [creating, setCreating] = useState(false)

  // Notifications
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification } = useNotifications()

  const fetchReminders = async () => {
    try {
      setLoading(true)
      const response = await api.getReminders()
      if (response.success && response.data) {
        setReminders(response.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reminders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReminders()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !targetDate) return

    try {
      setCreating(true)
      setError(null)

      const req: CreateReminderRequest = {
        title: title.trim(),
        message: message.trim() || undefined,
        target_date: targetDate,
        target_time: targetTime || undefined,
        recurring: recurring as any,
        related_issue_id: relatedIssueId.trim() || undefined,
      }

      const response = await api.createReminder(req)
      if (response.success) {
        setSuccess('Reminder created!')
        setTimeout(() => setSuccess(null), 3000)
        setTitle('')
        setMessage('')
        setTargetTime('')
        setRecurring('none')
        setRelatedIssueId('')
        setShowCreate(false)
        fetchReminders()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create reminder')
    } finally {
      setCreating(false)
    }
  }

  const handleDismiss = async (id: string) => {
    try {
      await api.dismissReminder(id)
      setReminders(prev => prev.filter(r => r.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss reminder')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteReminder(id)
      setReminders(prev => prev.filter(r => r.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete reminder')
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent': return <CheckCircle size={14} color="var(--color-success)" />
      case 'pending': return <Clock size={14} color="var(--color-warning)" />
      default: return <Bell size={14} />
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'task_followup': return 'Follow-up'
      case 'blocked_issue': return 'Blocker'
      case 'update_check': return 'Update Check'
      case 'daily_digest': return 'Daily Digest'
      default: return 'Custom'
    }
  }

  const pendingReminders = reminders.filter(r => r.status === 'pending')
  const sentReminders = reminders.filter(r => r.status === 'sent')

  return (
    <div className="reminders-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Bell size={28} style={{ color: 'var(--color-primary)' }} />
            Reminders & Notifications
          </h1>
          <p className="page-subtitle">
            Manage your reminders, follow-ups, and automated PM alerts
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={fetchReminders}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus size={16} /> New Reminder
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertTriangle size={20} /> {error}
          <button className="alert-close" onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <CheckCircle size={20} /> {success}
        </div>
      )}

      {/* Create Reminder Form */}
      {showCreate && (
        <div className="glass-card" style={{ marginBottom: '1.5rem', padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={18} /> Create Reminder
          </h3>
          <form onSubmit={handleCreate} className="reminder-create-form">
            <div className="reminder-form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Follow up on blocked issue PM-42"
                  className="form-input"
                  required
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Message (optional)</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Additional details..."
                  className="form-input"
                  rows={2}
                />
              </div>
              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="form-input"
                  required
                />
              </div>
              <div className="form-group">
                <label>Time</label>
                <input
                  type="time"
                  value={targetTime}
                  onChange={(e) => setTargetTime(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Recurring</label>
                <select
                  value={recurring}
                  onChange={(e) => setRecurring(e.target.value)}
                  className="form-input"
                >
                  <option value="none">One-time</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div className="form-group">
                <label>Issue ID (optional)</label>
                <input
                  type="text"
                  value={relatedIssueId}
                  onChange={(e) => setRelatedIssueId(e.target.value)}
                  placeholder="e.g., PM-42"
                  className="form-input"
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creating || !title.trim()}>
                {creating ? 'Creating...' : 'Create Reminder'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Two-column layout: Reminders + Recent Notifications */}
      <div className="reminders-grid">
        {/* Pending Reminders */}
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={18} color="var(--color-warning)" />
            Upcoming Reminders
            {pendingReminders.length > 0 && (
              <span className="badge" style={{ background: 'var(--color-warning)', color: '#000', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '10px' }}>
                {pendingReminders.length}
              </span>
            )}
          </h3>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Loading...</div>
          ) : pendingReminders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              No pending reminders. Click "New Reminder" to create one.
            </div>
          ) : (
            <div className="reminder-list">
              {pendingReminders.map(rem => (
                <div key={rem.id} className="reminder-item">
                  <div className="reminder-item-left">
                    {getStatusIcon(rem.status)}
                    <div>
                      <p className="reminder-title">{rem.title}</p>
                      {rem.message && <p className="reminder-message">{rem.message}</p>}
                      <div className="reminder-meta">
                        <span><Calendar size={12} /> {rem.target_date}</span>
                        {rem.target_time && <span><Clock size={12} /> {rem.target_time}</span>}
                        <span className="reminder-type-badge">{getTypeLabel(rem.type)}</span>
                        {rem.recurring !== 'none' && (
                          <span className="reminder-recurring-badge">
                            <RefreshCw size={10} /> {rem.recurring}
                          </span>
                        )}
                        {rem.related_issue_id && (
                          <span style={{ color: 'var(--color-primary)' }}>{rem.related_issue_id}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="reminder-item-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDismiss(rem.id)} title="Dismiss">
                      <X size={14} />
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(rem.id)} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sentReminders.length > 0 && (
            <>
              <h4 style={{ marginTop: '1.5rem', marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Recently Sent
              </h4>
              <div className="reminder-list">
                {sentReminders.slice(0, 5).map(rem => (
                  <div key={rem.id} className="reminder-item reminder-item-sent">
                    <div className="reminder-item-left">
                      {getStatusIcon(rem.status)}
                      <div>
                        <p className="reminder-title">{rem.title}</p>
                        <div className="reminder-meta">
                          <span><Calendar size={12} /> {rem.target_date}</span>
                          <span className="reminder-type-badge">{getTypeLabel(rem.type)}</span>
                        </div>
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(rem.id)} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Recent Notifications */}
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Bell size={18} color="var(--color-primary)" />
              Recent Notifications
              {unreadCount > 0 && (
                <span className="badge" style={{ background: 'var(--color-primary)', color: '#fff', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '10px' }}>
                  {unreadCount} new
                </span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={markAllAsRead}>
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              No notifications yet. The scheduler will send alerts for blocked issues, missing updates, and due reminders.
            </div>
          ) : (
            <div className="reminder-list">
              {notifications.slice(0, 20).map((notif: NotificationItem) => (
                <div
                  key={notif.id}
                  className={`reminder-item ${!notif.read ? 'reminder-item-unread' : ''}`}
                  onClick={() => !notif.read && markAsRead(notif.id)}
                  style={{ cursor: !notif.read ? 'pointer' : 'default' }}
                >
                  <div className="reminder-item-left">
                    {notif.type === 'task_overdue' ? (
                      <AlertTriangle size={14} color="var(--color-danger)" />
                    ) : notif.type === 'task_completed' ? (
                      <CheckCircle size={14} color="var(--color-success)" />
                    ) : (
                      <Bell size={14} color="var(--color-warning)" />
                    )}
                    <div>
                      <p className="reminder-title">{notif.title}</p>
                      <p className="reminder-message">{notif.message}</p>
                      <div className="reminder-meta">
                        <span>{new Date(notif.created_at).toLocaleString()}</span>
                        <span className="reminder-type-badge">{notif.type.replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); deleteNotification(notif.id) }} title="Dismiss">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
