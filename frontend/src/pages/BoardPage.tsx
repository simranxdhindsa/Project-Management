import { useState, useEffect } from 'react'
import { KanbanBoard } from '../components/board'
import type { Task, TaskStatus, AsanaSection } from '../types'
import api from '../services/api'
import type { YouTrackIssue } from '../services/api'

// Map YouTrack status to local TaskStatus
function mapYouTrackStatus(status: string): TaskStatus {
  const s = status.toLowerCase()
  if (s.includes('done') || s.includes('fixed') || s.includes('complete') || s.includes('verified')) return 'done'
  if (s.includes('progress') || s.includes('doing') || s.includes('dev') || s.includes('active')) return 'in_progress'
  if (s.includes('review') || s.includes('verify') || s.includes('stage') || s.includes('ready for stage')) return 'review'
  return 'todo'
}

// Map YouTrack priority to local priority
function mapYouTrackPriority(priority: string): 'low' | 'medium' | 'high' {
  const p = priority.toLowerCase()
  if (p.includes('critical') || p.includes('major') || p.includes('show-stopper')) return 'high'
  if (p.includes('minor') || p.includes('cosmetic')) return 'low'
  return 'medium'
}

// Convert YouTrack issue to local Task format
function youtrackToTask(issue: YouTrackIssue): Task {
  return {
    id: issue.id,
    title: issue.summary,
    description: issue.description || '',
    status: mapYouTrackStatus(issue.status),
    priority: mapYouTrackPriority(issue.priority),
    youtrack_id: issue.id,
    section_name: issue.status,
    assignee: issue.assignee ? {
      id: issue.assignee.id,
      name: issue.assignee.fullName || issue.assignee.login,
      email: issue.assignee.email || '',
    } : undefined,
    created_at: issue.created ? new Date(issue.created).toISOString() : undefined,
    updated_at: issue.updated ? new Date(issue.updated).toISOString() : undefined,
  }
}

export function BoardPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [sections, setSections] = useState<AsanaSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [youtrackConnected, setYoutrackConnected] = useState(false)

  // Fetch tasks and sections on mount
  useEffect(() => {
    fetchTasksAndSections()
  }, [])

  const fetchTasksAndSections = async () => {
    try {
      setLoading(true)
      setError(null)

      // Check YouTrack status first
      let ytConnected = false
      try {
        const ytStatus = await api.getYouTrackStatus()
        ytConnected = ytStatus.data?.configured === true
        setYoutrackConnected(ytConnected)
      } catch {
        ytConnected = false
      }

      if (ytConnected) {
        // Fetch from YouTrack directly
        const [issuesResponse, statesResponse] = await Promise.all([
          api.getYouTrackIssues(),
          api.getYouTrackStates(),
        ])

        if (issuesResponse.success && issuesResponse.data) {
          const ytIssues = issuesResponse.data as YouTrackIssue[]
          setTasks(ytIssues.map(youtrackToTask))
        }

        if (statesResponse.success && statesResponse.data) {
          const states = statesResponse.data as { name: string }[]
          const mappedSections: AsanaSection[] = states.map((state, i) => ({
            gid: state.name,
            name: state.name,
            position: i,
          }))
          setSections(mappedSections)
        }
      } else {
        // Fallback: fetch from local DB (Asana tasks)
        const [tasksResponse, sectionsResponse] = await Promise.all([
          api.getTasks(),
          api.getProjectSections()
        ])

        if (tasksResponse.success && tasksResponse.data) {
          setTasks(tasksResponse.data as Task[])
        }

        if (sectionsResponse.success && sectionsResponse.data) {
          setSections(sectionsResponse.data as AsanaSection[])
        }
      }
    } catch (err) {
      setError('Failed to load tasks')
      console.error('Error fetching tasks:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleTaskMove = async (taskId: string, newStatus: TaskStatus, sectionGid?: string, sectionName?: string) => {
    const task = tasks.find(t => t.id === taskId)

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: newStatus,
              section_name: sectionName || t.section_name,
            }
          : t
      )
    )

    try {
      if (youtrackConnected && task?.youtrack_id) {
        // Update state in YouTrack directly
        const ytState = sectionName || mapLocalStatusToYouTrack(newStatus)
        await api.updateYouTrackIssueState(task.youtrack_id, ytState)
      } else if (sectionGid && sectionName) {
        await api.updateTaskSection(taskId, sectionGid, sectionName)
      } else {
        await api.updateTaskStatus(taskId, newStatus)
      }

      // Push to Asana if task is linked (legacy)
      if (task?.asana_id) {
        await api.pushTaskToAsana(taskId).catch((err) => {
          console.log('Asana sync skipped:', err)
        })
      }
    } catch (err) {
      // Revert on error
      fetchTasksAndSections()
      console.error('Error updating task:', err)
    }
  }

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
  }

  const handleTaskEdit = (task: Task) => {
    setSelectedTask(task)
  }


  const handleSync = async () => {
    try {
      setSyncing(true)
      if (youtrackConnected) {
        // Just refresh from YouTrack
        await fetchTasksAndSections()
        alert('Synced from YouTrack!')
      } else {
        const response = await api.importFromAsana()
        if (response.success) {
          await fetchTasksAndSections()
          const data = response.data as { tasks_synced: number; tasks_created: number; tasks_updated: number }
          alert(`Sync complete! Created: ${data.tasks_created}, Updated: ${data.tasks_updated}`)
        }
      }
    } catch (err) {
      console.error('Error syncing:', err)
      alert('Failed to sync')
    } finally {
      setSyncing(false)
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
          <button className="btn btn-primary" onClick={fetchTasksAndSections}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Build YouTrack issue URL
  const getYouTrackURL = (task: Task) => {
    if (task.youtrack_id) {
      return `https://simran.youtrack.cloud/issue/${task.youtrack_id}`
    }
    return null
  }

  return (
    <div className="board-page">
      <div className="board-header">
        <div className="board-header-left">
          <h1 className="board-title">Project Board</h1>
          <span className="board-task-count">{tasks.length} tasks</span>
          {youtrackConnected && (
            <span className="board-source-badge" style={{
              background: 'rgba(130, 80, 223, 0.15)',
              color: '#8250df',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 500,
              marginLeft: '8px',
            }}>
              YouTrack
            </span>
          )}
        </div>
        <div className="board-header-right">
          <div className="board-filters">
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleSync}
              disabled={syncing}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={syncing ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              {syncing ? 'Syncing...' : youtrackConnected ? 'Sync YouTrack' : 'Sync Asana'}
            </button>
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
        </div>
      </div>

      <KanbanBoard
        tasks={tasks}
        sections={sections}
        onTaskMove={handleTaskMove}
        onTaskClick={handleTaskClick}
        onTaskEdit={handleTaskEdit}
      />

      {/* Task Detail Modal */}
      {selectedTask && (
        <div className="modal-overlay" onClick={() => setSelectedTask(null)}>
          <div className="modal glass-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedTask.youtrack_id && <span style={{ color: '#8250df', marginRight: '8px', fontSize: '14px' }}>{selectedTask.youtrack_id}</span>}{selectedTask.title}</h2>
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
                    {selectedTask.section_name || selectedTask.status.replace('_', ' ')}
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
              {/* YouTrack link */}
              {getYouTrackURL(selectedTask) && (
                <a
                  href={getYouTrackURL(selectedTask)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm"
                  style={{ color: '#8250df', marginTop: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  View in YouTrack
                </a>
              )}
              {/* Asana link (legacy) */}
              {selectedTask.asana_url && !selectedTask.youtrack_id && (
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

    </div>
  )
}

// Map local status to YouTrack state name
function mapLocalStatusToYouTrack(status: TaskStatus | string): string {
  switch (status) {
    case 'done': return 'Fixed'
    case 'in_progress': return 'In Progress'
    case 'review': return 'To be discussed'
    default: return 'Open'
  }
}

