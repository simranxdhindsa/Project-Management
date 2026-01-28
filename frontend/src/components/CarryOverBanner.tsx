import { useState, useEffect } from 'react'
import type { Task } from '../types'
import api from '../services/api'

interface CarryOverBannerProps {
  onTaskClick?: (task: Task) => void
  onDismiss?: () => void
}

export function CarryOverBanner({ onTaskClick, onDismiss }: CarryOverBannerProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    fetchYesterdayPending()
  }, [])

  const fetchYesterdayPending = async () => {
    try {
      setLoading(true)
      const response = await api.getYesterdayPending()
      if (response.success && response.data) {
        setTasks(response.data as Task[])
      }
    } catch (err) {
      console.error('Error fetching yesterday pending tasks:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
    // Store dismissal for today
    localStorage.setItem('carryOverDismissed', new Date().toDateString())
  }

  // Check if already dismissed today
  useEffect(() => {
    const dismissedDate = localStorage.getItem('carryOverDismissed')
    if (dismissedDate === new Date().toDateString()) {
      setDismissed(true)
    }
  }, [])

  if (dismissed || loading || tasks.length === 0) {
    return null
  }

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high':
        return '🔴'
      case 'medium':
        return '🟡'
      case 'low':
        return '🟢'
      default:
        return '⚪'
    }
  }

  return (
    <div className="carry-over-banner glass-card">
      <div className="carry-over-header" onClick={() => setExpanded(!expanded)}>
        <div className="carry-over-header-left">
          <div className="carry-over-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="carry-over-title-section">
            <h3 className="carry-over-title">Yesterday's Pending Tasks</h3>
            <p className="carry-over-subtitle">
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} carried over from yesterday
            </p>
          </div>
        </div>
        <div className="carry-over-header-right">
          <button
            className="carry-over-toggle"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <button
            className="carry-over-dismiss"
            onClick={(e) => {
              e.stopPropagation()
              handleDismiss()
            }}
            aria-label="Dismiss"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="carry-over-content">
          <div className="carry-over-tasks">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="carry-over-task"
                onClick={() => onTaskClick?.(task)}
              >
                <span className="task-priority-icon">{getPriorityIcon(task.priority)}</span>
                <div className="carry-over-task-info">
                  <span className="carry-over-task-title">{task.title}</span>
                  <span className={`carry-over-task-status status-${task.status}`}>
                    {task.status.replace('_', ' ')}
                  </span>
                </div>
                {task.assignee && (
                  <div className="carry-over-task-assignee">
                    {task.assignee.picture ? (
                      <img
                        src={task.assignee.picture}
                        alt={task.assignee.name}
                        className="assignee-avatar-xs"
                      />
                    ) : (
                      <div className="assignee-placeholder-xs">
                        {task.assignee.name?.charAt(0).toUpperCase() || '?'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="carry-over-actions">
            <button className="btn btn-ghost btn-sm" onClick={handleDismiss}>
              Dismiss for Today
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => {
              // Navigate to board with pending tasks highlighted
              window.location.href = '/board?filter=pending'
            }}>
              View All Pending
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
