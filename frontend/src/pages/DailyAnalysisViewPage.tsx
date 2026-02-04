import { useState, useEffect } from 'react'
import { Calendar, CheckCircle, Clock, XCircle, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../services/api'

interface TasksByAssignee {
  assignee: string
  completed: string[]
  pending: string[]
  blocked: string[]
  skipped: string[]
}

export function DailyAnalysisViewPage() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [tasksByAssignee, setTasksByAssignee] = useState<TasksByAssignee[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch today's tasks
  useEffect(() => {
    const fetchTodaysTasks = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await api.getTodaysTasks(selectedDate)
        if (response.success && response.data) {
          setTasksByAssignee(response.data as TasksByAssignee[])
        } else {
          setTasksByAssignee([])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks')
        setTasksByAssignee([])
      } finally {
        setLoading(false)
      }
    }

    fetchTodaysTasks()
  }, [selectedDate])

  // Date navigation
  const navigateDate = (days: number) => {
    const date = new Date(selectedDate + 'T00:00:00')
    date.setDate(date.getDate() + days)
    setSelectedDate(date.toISOString().split('T')[0])
  }

  const setToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0])
  }

  const isToday = selectedDate === new Date().toISOString().split('T')[0]

  // Calculate summary stats
  const totalCompleted = tasksByAssignee.reduce((sum, a) => sum + a.completed.length, 0)
  const totalPending = tasksByAssignee.reduce((sum, a) => sum + a.pending.length, 0)
  const totalBlocked = tasksByAssignee.reduce((sum, a) => sum + a.blocked.length, 0)
  const totalSkipped = tasksByAssignee.reduce((sum, a) => sum + a.skipped.length, 0)
  const totalTasks = totalCompleted + totalPending + totalBlocked + totalSkipped

  return (
    <div className="daily-analysis-view-page">
      {/* Header with Date Navigation */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <CheckCircle size={28} style={{ color: 'var(--color-success)' }} />
            Daily Task Analysis
          </h1>
          <p className="page-subtitle">
            View task completion status from AI analysis
          </p>
        </div>
        <div className="date-navigation">
          <button className="btn btn-ghost btn-sm" onClick={() => navigateDate(-1)}>
            <ChevronLeft size={16} />
          </button>
          <div className="date-display">
            <Calendar size={16} />
            <span>
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigateDate(1)}>
            <ChevronRight size={16} />
          </button>
          {!isToday && (
            <button className="btn btn-primary btn-sm" onClick={setToday}>
              Today
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertTriangle size={20} />
          {error}
          <button className="alert-close" onClick={() => setError(null)}>
            &times;
          </button>
        </div>
      )}

      {loading && (
        <div className="daily-loading">
          <div className="loading-spinner" />
          <p>Loading analysis...</p>
        </div>
      )}

      {!loading && tasksByAssignee.length === 0 && (
        <div className="daily-empty-state glass-card">
          <Calendar size={48} />
          <h3>No Analysis Available</h3>
          <p>
            No task analysis found for this date. Go to the AI Analysis page to analyze
            tasks for this day.
          </p>
        </div>
      )}

      {!loading && tasksByAssignee.length > 0 && (
        <>
          {/* Summary Cards */}
          <div className="ai-summary-grid">
            <div className="ai-summary-card glass-card">
              <div className="ai-summary-icon" style={{ backgroundColor: 'var(--color-primary-light)' }}>
                <CheckCircle size={24} color="var(--color-primary)" />
              </div>
              <div className="ai-summary-content">
                <span className="ai-summary-value">{totalTasks}</span>
                <span className="ai-summary-label">Total Tasks</span>
              </div>
            </div>

            <div className="ai-summary-card glass-card">
              <div className="ai-summary-icon" style={{ backgroundColor: 'var(--color-success-light)' }}>
                <CheckCircle size={24} color="var(--color-success)" />
              </div>
              <div className="ai-summary-content">
                <span className="ai-summary-value">{totalCompleted}</span>
                <span className="ai-summary-label">Completed</span>
              </div>
            </div>

            <div className="ai-summary-card glass-card">
              <div className="ai-summary-icon" style={{ backgroundColor: 'var(--color-warning-light)' }}>
                <Clock size={24} color="var(--color-warning)" />
              </div>
              <div className="ai-summary-content">
                <span className="ai-summary-value">{totalPending}</span>
                <span className="ai-summary-label">Pending</span>
              </div>
            </div>

            <div className="ai-summary-card glass-card">
              <div className="ai-summary-icon" style={{ backgroundColor: 'var(--color-danger-light)' }}>
                <XCircle size={24} color="var(--color-danger)" />
              </div>
              <div className="ai-summary-content">
                <span className="ai-summary-value">{totalBlocked}</span>
                <span className="ai-summary-label">Blocked</span>
              </div>
            </div>
          </div>

          {/* Task Columns by Status */}
          <div className="analysis-columns">
            {/* Completed Column */}
            <div className="analysis-column glass-card">
              <div className="analysis-column-header" style={{ borderColor: 'var(--color-success)' }}>
                <CheckCircle size={20} color="var(--color-success)" />
                <h3>Completed</h3>
                <span className="column-count">{totalCompleted}</span>
              </div>
              <div className="analysis-column-body">
                {tasksByAssignee.map((assignee, idx) => (
                  assignee.completed.length > 0 && (
                    <div key={`completed-${idx}`} className="assignee-group">
                      <div className="assignee-header">
                        <span className="assignee-name">@{assignee.assignee}</span>
                        <span className="task-count">{assignee.completed.length}</span>
                      </div>
                      <ul className="task-list">
                        {assignee.completed.map((task, taskIdx) => (
                          <li key={taskIdx} className="task-item task-completed">
                            <CheckCircle size={14} />
                            {task}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                ))}
                {totalCompleted === 0 && (
                  <p className="empty-column-text">No completed tasks</p>
                )}
              </div>
            </div>

            {/* Pending Column */}
            <div className="analysis-column glass-card">
              <div className="analysis-column-header" style={{ borderColor: 'var(--color-warning)' }}>
                <Clock size={20} color="var(--color-warning)" />
                <h3>Pending</h3>
                <span className="column-count">{totalPending}</span>
              </div>
              <div className="analysis-column-body">
                {tasksByAssignee.map((assignee, idx) => (
                  assignee.pending.length > 0 && (
                    <div key={`pending-${idx}`} className="assignee-group">
                      <div className="assignee-header">
                        <span className="assignee-name">@{assignee.assignee}</span>
                        <span className="task-count">{assignee.pending.length}</span>
                      </div>
                      <ul className="task-list">
                        {assignee.pending.map((task, taskIdx) => (
                          <li key={taskIdx} className="task-item task-pending">
                            <Clock size={14} />
                            {task}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                ))}
                {totalPending === 0 && (
                  <p className="empty-column-text">No pending tasks</p>
                )}
              </div>
            </div>

            {/* Blocked Column */}
            <div className="analysis-column glass-card">
              <div className="analysis-column-header" style={{ borderColor: 'var(--color-danger)' }}>
                <XCircle size={20} color="var(--color-danger)" />
                <h3>Blocked</h3>
                <span className="column-count">{totalBlocked}</span>
              </div>
              <div className="analysis-column-body">
                {tasksByAssignee.map((assignee, idx) => (
                  assignee.blocked.length > 0 && (
                    <div key={`blocked-${idx}`} className="assignee-group">
                      <div className="assignee-header">
                        <span className="assignee-name">@{assignee.assignee}</span>
                        <span className="task-count">{assignee.blocked.length}</span>
                      </div>
                      <ul className="task-list">
                        {assignee.blocked.map((task, taskIdx) => (
                          <li key={taskIdx} className="task-item task-blocked">
                            <XCircle size={14} />
                            {task}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                ))}
                {totalBlocked === 0 && (
                  <p className="empty-column-text">No blocked tasks</p>
                )}
              </div>
            </div>

            {/* Skipped Column */}
            {totalSkipped > 0 && (
              <div className="analysis-column glass-card">
                <div className="analysis-column-header" style={{ borderColor: 'var(--color-secondary)' }}>
                  <AlertTriangle size={20} color="var(--color-secondary)" />
                  <h3>Not Mentioned</h3>
                  <span className="column-count">{totalSkipped}</span>
                </div>
                <div className="analysis-column-body">
                  {tasksByAssignee.map((assignee, idx) => (
                    assignee.skipped.length > 0 && (
                      <div key={`skipped-${idx}`} className="assignee-group">
                        <div className="assignee-header">
                          <span className="assignee-name">@{assignee.assignee}</span>
                          <span className="task-count">{assignee.skipped.length}</span>
                        </div>
                        <ul className="task-list">
                          {assignee.skipped.map((task, taskIdx) => (
                            <li key={taskIdx} className="task-item task-skipped">
                              <AlertTriangle size={14} />
                              {task}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
