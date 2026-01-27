import { Task } from '../../types'

interface TaskCardProps {
  task: Task
  isDragging?: boolean
  onClick?: () => void
  onEdit?: () => void
}

const getPriorityClass = (priority: string): string => {
  switch (priority) {
    case 'high':
      return 'priority-high'
    case 'medium':
      return 'priority-medium'
    case 'low':
      return 'priority-low'
    default:
      return 'priority-medium'
  }
}

const formatDate = (dateString?: string): string => {
  if (!dateString) return ''
  const date = new Date(dateString)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Today'
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow'
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const isOverdue = (dateString?: string): boolean => {
  if (!dateString) return false
  const date = new Date(dateString)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

export function TaskCard({ task, isDragging, onClick, onEdit }: TaskCardProps) {
  const overdue = isOverdue(task.due_date)

  return (
    <div
      className={`task-card ${isDragging ? 'task-card-dragging' : ''} ${getPriorityClass(task.priority)}`}
      onClick={onClick}
    >
      <div className="task-card-header">
        <span className={`task-priority-badge ${getPriorityClass(task.priority)}`}>
          {task.priority}
        </span>
        {task.asana_id && (
          <span className="task-asana-badge" title="Synced with Asana">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.77,10.5c-1.99,0-3.62,1.61-3.62,3.6s1.62,3.6,3.62,3.6,3.62-1.61,3.62-3.6-1.62-3.6-3.62-3.6Z"/>
              <path d="M5.23,10.5c-1.99,0-3.62,1.61-3.62,3.6s1.62,3.6,3.62,3.6,3.62-1.61,3.62-3.6-1.62-3.6-3.62-3.6Z"/>
              <path d="M12,3.3c-1.99,0-3.62,1.61-3.62,3.6s1.62,3.6,3.62,3.6,3.62-1.61,3.62-3.6-1.62-3.6-3.62-3.6Z"/>
            </svg>
          </span>
        )}
      </div>

      <h4 className="task-card-title">{task.title}</h4>

      {task.description && (
        <p className="task-card-description">
          {task.description.length > 80
            ? `${task.description.substring(0, 80)}...`
            : task.description}
        </p>
      )}

      <div className="task-card-footer">
        <div className="task-card-meta">
          {task.due_date && (
            <span className={`task-due-date ${overdue ? 'overdue' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {formatDate(task.due_date)}
            </span>
          )}
        </div>

        {task.assignee && (
          <div className="task-assignee" title={task.assignee.name}>
            {task.assignee.picture ? (
              <img
                src={task.assignee.picture}
                alt={task.assignee.name}
                className="task-assignee-avatar"
              />
            ) : (
              <div className="task-assignee-placeholder">
                {task.assignee.name?.charAt(0).toUpperCase() || '?'}
              </div>
            )}
          </div>
        )}
      </div>

      {onEdit && (
        <button
          className="task-card-edit-btn"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          title="Edit task"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      )}
    </div>
  )
}
