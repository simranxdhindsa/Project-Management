import { useState, useEffect } from 'react'
import api from '../services/api'
import type { AsanaProject } from '../services/api'
import { Link2, Unlink, RefreshCw, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'

interface AsanaStatus {
  connected: boolean
  workspace_id?: string
  workspace_name?: string
  last_sync_at?: string
}

interface SyncResult {
  tasks_synced: number
  tasks_created: number
  tasks_updated: number
  errors?: string[]
}

export function IntegrationsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Asana state
  const [asanaStatus, setAsanaStatus] = useState<AsanaStatus | null>(null)
  const [asanaProjects, setAsanaProjects] = useState<AsanaProject[]>([])
  const [connectingAsana, setConnectingAsana] = useState(false)
  const [syncingAsana, setSyncingAsana] = useState(false)
  const [asanaPAT, setAsanaPAT] = useState('')
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [showPATInput, setShowPATInput] = useState(false)

  useEffect(() => {
    fetchAsanaStatus()
  }, [])

  const fetchAsanaStatus = async () => {
    try {
      setLoading(true)
      const response = await api.getAsanaStatus()
      if (response.data) {
        setAsanaStatus(response.data)
        if (response.data.connected) {
          fetchAsanaProjects()
        }
      }
    } catch (err) {
      console.error('Failed to fetch Asana status:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchAsanaProjects = async () => {
    try {
      const response = await api.getAsanaProjects()
      if (response.data) {
        setAsanaProjects(response.data)
      }
    } catch (err) {
      console.error('Failed to fetch Asana projects:', err)
    }
  }

  const handleConnectAsana = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!asanaPAT.trim()) return

    try {
      setConnectingAsana(true)
      setError(null)
      const response = await api.connectAsana(asanaPAT.trim())
      if (response.success) {
        setSuccess('Asana connected successfully!')
        setAsanaPAT('')
        setShowPATInput(false)
        fetchAsanaStatus()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Asana')
    } finally {
      setConnectingAsana(false)
    }
  }

  const handleDisconnectAsana = async () => {
    if (!confirm('Are you sure you want to disconnect Asana?')) return

    try {
      setError(null)
      await api.disconnectAsana()
      setSuccess('Asana disconnected successfully')
      setAsanaStatus({ connected: false })
      setAsanaProjects([])
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Asana')
    }
  }

  const handleSyncProject = async () => {
    if (!selectedProject) {
      setError('Please select a project to sync')
      return
    }

    try {
      setSyncingAsana(true)
      setError(null)
      const response = await api.syncProjectWithAsana(selectedProject)
      if (response.success && response.data) {
        const result = response.data as SyncResult
        setSuccess(`Sync complete! ${result.tasks_synced} tasks synced, ${result.tasks_created} created, ${result.tasks_updated} updated`)
        if (result.errors && result.errors.length > 0) {
          console.warn('Sync errors:', result.errors)
        }
        setTimeout(() => setSuccess(null), 5000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync with Asana')
    } finally {
      setSyncingAsana(false)
    }
  }

  if (loading) {
    return (
      <div className="integrations-page">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading integrations...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="integrations-page">
      <div className="page-header">
        <h1 className="page-title">Integrations</h1>
        <p className="page-subtitle">
          Connect your project management tools to sync tasks and updates
        </p>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={20} />
          {error}
          <button className="alert-close" onClick={() => setError(null)}>
            &times;
          </button>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <CheckCircle size={20} />
          {success}
        </div>
      )}

      {/* Asana Integration Card */}
      <div className="integration-card glass-card">
        <div className="integration-header">
          <div className="integration-logo">
            <svg viewBox="0 0 32 32" width="40" height="40">
              <circle cx="16" cy="16" r="14" fill="#F06A6A"/>
              <circle cx="16" cy="11" r="4" fill="white"/>
              <circle cx="9" cy="21" r="4" fill="white"/>
              <circle cx="23" cy="21" r="4" fill="white"/>
            </svg>
          </div>
          <div className="integration-info">
            <h2>Asana</h2>
            <p>Two-way sync with Asana projects and tasks</p>
          </div>
          <div className="integration-status">
            {asanaStatus?.connected ? (
              <span className="status-badge status-connected">
                <CheckCircle size={14} /> Connected
              </span>
            ) : (
              <span className="status-badge status-disconnected">
                Not Connected
              </span>
            )}
          </div>
        </div>

        <div className="integration-body">
          {asanaStatus?.connected ? (
            <>
              <div className="integration-details">
                <div className="detail-item">
                  <span className="detail-label">Workspace</span>
                  <span className="detail-value">{asanaStatus.workspace_name || 'N/A'}</span>
                </div>
                {asanaStatus.last_sync_at && (
                  <div className="detail-item">
                    <span className="detail-label">Last Synced</span>
                    <span className="detail-value">
                      {new Date(asanaStatus.last_sync_at).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Project Selection and Sync */}
              <div className="sync-section">
                <h3>Sync with Asana Project</h3>
                <div className="sync-controls">
                  <select
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className="project-select"
                  >
                    <option value="">Select a project...</option>
                    {asanaProjects.map((project) => (
                      <option key={project.gid} value={project.gid}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    onClick={handleSyncProject}
                    disabled={syncingAsana || !selectedProject}
                  >
                    {syncingAsana ? (
                      <>
                        <RefreshCw size={16} className="spin" /> Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw size={16} /> Sync Now
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="integration-actions">
                <button
                  className="btn btn-ghost btn-danger"
                  onClick={handleDisconnectAsana}
                >
                  <Unlink size={16} /> Disconnect
                </button>
                <a
                  href="https://app.asana.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                >
                  <ExternalLink size={16} /> Open Asana
                </a>
              </div>
            </>
          ) : (
            <>
              {showPATInput ? (
                <form onSubmit={handleConnectAsana} className="connect-form">
                  <p className="form-help">
                    Enter your Asana Personal Access Token (PAT) to connect.
                    You can create one at{' '}
                    <a
                      href="https://app.asana.com/0/my-apps"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Asana Developer Console
                    </a>
                  </p>
                  <div className="form-group">
                    <input
                      type="password"
                      value={asanaPAT}
                      onChange={(e) => setAsanaPAT(e.target.value)}
                      placeholder="Enter your Asana PAT"
                      className="pat-input"
                    />
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setShowPATInput(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={connectingAsana || !asanaPAT.trim()}
                    >
                      {connectingAsana ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="connect-prompt">
                  <p>Connect your Asana account to sync projects and tasks automatically.</p>
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowPATInput(true)}
                  >
                    <Link2 size={16} /> Connect Asana
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="integration-card glass-card">
        <div className="integration-header">
          <h2>How to Get Your Asana PAT</h2>
        </div>
        <div className="integration-body">
          <ol className="instructions-list">
            <li>Go to <a href="https://app.asana.com/0/my-apps" target="_blank" rel="noopener noreferrer">Asana Developer Console</a></li>
            <li>Click on "Create new token"</li>
            <li>Give it a name (e.g., "Project Management")</li>
            <li>Click "Create token"</li>
            <li>Copy the token and paste it above</li>
          </ol>
          <div className="warning-box">
            <AlertCircle size={16} />
            <p>Keep your PAT secure. Never share it with anyone.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
