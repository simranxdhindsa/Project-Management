import { useState, useEffect } from 'react'
import { KanbanBoard } from '../components/board'
import type { Task, TaskStatus, CreateTaskRequest } from '../types'
import api from '../services/api'

export function BoardPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  // Fetch tasks on mount
  useEffect(() => {
    fetchTasks()
  }, [])

  const fetchTasks = async () => {
    try {
      setLoading(true)
      const response = await api.getTasks()
      if (response.success && response.data) {
        setTasks(response.data as Task[])
      }
    } catch (err) {
      setError('Failed to load tasks')
      console.error('Error fetching tasks:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleTaskMove = async (taskId: string, newStatus: TaskStatus) => {
    // Optimistic update
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, status: newStatus } : task
      )
    )

    try {
      // Update on server
      await api.updateTaskStatus(taskId, newStatus)

      // Sync with Asana (if connected)
      await api.syncTaskToAsana(taskId, newStatus).catch(() => {
        // Silently ignore Asana sync errors
      })
    } catch (err) {
      // Revert on error
      fetchTasks()
      console.error('Error updating task status:', err)
    }
  }

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
  }

  const handleTaskEdit = (task: Task) => {
    setSelectedTask(task)
    // Open edit modal
  }

  const handleCreateTask = async (taskData: CreateTaskRequest) => {
    try {
      const response = await api.createTask(taskData)
      if (response.success && response.data) {
        setTasks((prev) => [...prev, response.data as Task])
        setShowCreateModal(false)
      }
    } catch (err) {
      console.error('Error creating task:', err)
    }
  }

  if (loading) {
    return (
      <div className="board-page">
        <div className="loading-screen">
          <div className="loading-spinner"></div>
          <p>Loading tasks...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="board-page">
        <div className="error-state">
          <h3>Error Loading Tasks</h3>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={fetchTasks}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="board-page">
      <div className="board-header">
        <div className="board-header-left">
          <h1 className="board-title">Project Board</h1>
          <span className="board-task-count">{tasks.length} tasks</span>
        </div>
        <div className="board-header-right">
          <div className="board-filters">
            <button className="btn btn-ghost btn-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filter
            </button>
            <button className="btn btn-ghost btn-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              Sort
            </button>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Task
          </button>
        </div>
      </div>

      <KanbanBoard
        tasks={tasks}
        onTaskMove={handleTaskMove}
        onTaskClick={handleTaskClick}
        onTaskEdit={handleTaskEdit}
      />

      {/* Task Detail Modal */}
      {selectedTask && (
        <div className="modal-overlay" onClick={() => setSelectedTask(null)}>
          <div className="modal glass-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedTask.title}</h2>
              <button
                className="modal-close"
                onClick={() => setSelectedTask(null)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="task-detail-grid">
                <div className="task-detail-item">
                  <label>Status</label>
                  <span className={`status-badge status-${selectedTask.status}`}>
                    {selectedTask.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="task-detail-item">
                  <label>Priority</label>
                  <span className={`priority-badge priority-${selectedTask.priority}`}>
                    {selectedTask.priority}
                  </span>
                </div>
                {selectedTask.due_date && (
                  <div className="task-detail-item">
                    <label>Due Date</label>
                    <span>{new Date(selectedTask.due_date).toLocaleDateString()}</span>
                  </div>
                )}
                {selectedTask.assignee && (
                  <div className="task-detail-item">
                    <label>Assignee</label>
                    <div className="assignee-info">
                      {selectedTask.assignee.picture && (
                        <img src={selectedTask.assignee.picture} alt="" className="assignee-avatar" />
                      )}
                      <span>{selectedTask.assignee.name}</span>
                    </div>
                  </div>
                )}
              </div>
              {selectedTask.description && (
                <div className="task-description">
                  <label>Description</label>
                  <p>{selectedTask.description}</p>
                </div>
              )}
              {selectedTask.asana_url && (
                <a
                  href={selectedTask.asana_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm asana-link"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.77,10.5c-1.99,0-3.62,1.61-3.62,3.6s1.62,3.6,3.62,3.6,3.62-1.61,3.62-3.6-1.62-3.6-3.62-3.6Z"/>
                    <path d="M5.23,10.5c-1.99,0-3.62,1.61-3.62,3.6s1.62,3.6,3.62,3.6,3.62-1.61,3.62-3.6-1.62-3.6-3.62-3.6Z"/>
                    <path d="M12,3.3c-1.99,0-3.62,1.61-3.62,3.6s1.62,3.6,3.62,3.6,3.62-1.61,3.62-3.6-1.62-3.6-3.62-3.6Z"/>
                  </svg>
                  View in Asana
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateTask}
        />
      )}
    </div>
  )
}

// Create Task Modal Component
interface CreateTaskModalProps {
  onClose: () => void
  onCreate: (task: CreateTaskRequest) => void
}

function CreateTaskModal({ onClose, onCreate }: CreateTaskModalProps) {
  const [formData, setFormData] = useState<CreateTaskRequest>({
    title: '',
    description: '',
    status: 'todo',
    priority: 'medium',
    project_id: 'default', // TODO: Get from context
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.title.trim()) {
      onCreate(formData)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create New Task</h2>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label htmlFor="title">Title</label>
            <input
              type="text"
              id="title"
              className="form-input"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter task title"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              className="form-input"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Enter task description (optional)"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="status">Status</label>
              <select
                id="status"
                className="form-input"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                className="form-input"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="due_date">Due Date</label>
            <input
              type="date"
              id="due_date"
              className="form-input"
              value={formData.due_date || ''}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
