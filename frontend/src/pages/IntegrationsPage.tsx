import { useState, useEffect } from 'react'
import api from '../services/api'
import type { AsanaProject, AsanaSettings } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { Link2, Unlink, RefreshCw, CheckCircle, AlertCircle, ExternalLink, Settings, Save, MessageSquare } from 'lucide-react'

interface SyncResult {
  tasks_synced: number
  tasks_created: number
  tasks_updated: number
  errors?: string[]
}

interface SlackStatus {
  connected: boolean
  team_id?: string
  team_name?: string
  channel_id?: string
  channel_name?: string
}

interface SlackChannel {
  id: string
  name: string
  is_private: boolean
  is_member: boolean
}

export function IntegrationsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Asana state
  const [asanaSettings, setAsanaSettings] = useState<AsanaSettings | null>(null)
  const [asanaProjects, setAsanaProjects] = useState<AsanaProject[]>([])
  const [syncingAsana, setSyncingAsana] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)

  // Form state for admin settings
  const [asanaPAT, setAsanaPAT] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [showPATInput, setShowPATInput] = useState(false)

  // Slack state
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null)
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([])
  const [slackBotToken, setSlackBotToken] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('')
  const [connectingSlack, setConnectingSlack] = useState(false)
  const [loadingChannels, setLoadingChannels] = useState(false)

  useEffect(() => {
    fetchAsanaSettings()
    fetchSlackStatus()
  }, [])

  const fetchAsanaSettings = async () => {
    try {
      setLoading(true)

      if (isAdmin) {
        // Admin can get full settings
        const response = await api.getAsanaSettings()
        if (response.success && response.data) {
          setAsanaSettings(response.data)
          setSelectedProjectId(response.data.project_id || '')
          if (response.data.configured) {
            fetchAsanaProjects()
          }
        }
      } else {
        // Non-admin can only check if configured
        const response = await api.getAsanaConfigStatus()
        if (response.success && response.data) {
          setAsanaSettings({
            configured: response.data.configured,
            pat: '',
            project_id: '',
            workspace_id: ''
          })
        }
      }
    } catch (err) {
      console.error('Failed to fetch Asana settings:', err)
      setAsanaSettings({ configured: false, pat: '', project_id: '', workspace_id: '' })
    } finally {
      setLoading(false)
    }
  }

  const fetchAsanaProjects = async () => {
    try {
      const response = await api.getAsanaProjectsForSettings()
      if (response.success && response.data) {
        setAsanaProjects(response.data as AsanaProject[])
      }
    } catch (err) {
      console.error('Failed to fetch Asana projects:', err)
    }
  }

  const handleTestConnection = async () => {
    try {
      setTestingConnection(true)
      setError(null)
      const response = await api.testAsanaConnection()
      if (response.success && response.data) {
        setSuccess(`Connected as ${response.data.user}!`)
        if (response.data.projects) {
          setAsanaProjects(response.data.projects)
        }
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed')
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setSavingSettings(true)
      setError(null)

      const settings: { pat?: string; project_id?: string } = {}

      if (asanaPAT.trim()) {
        settings.pat = asanaPAT.trim()
      }

      if (selectedProjectId) {
        settings.project_id = selectedProjectId
      }

      const response = await api.updateAsanaSettings(settings)
      if (response.success) {
        setSuccess('Asana settings saved successfully!')
        setAsanaPAT('')
        setShowPATInput(false)
        fetchAsanaSettings()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleQuickSync = async () => {
    try {
      setSyncingAsana(true)
      setError(null)
      const response = await api.importFromAsana()
      if (response.success && response.data) {
        const result = response.data as SyncResult
        setSuccess(`Sync complete! Created: ${result.tasks_created}, Updated: ${result.tasks_updated}`)
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

  // Slack functions
  const fetchSlackStatus = async () => {
    try {
      const response = await api.getSlackStatus()
      if (response.success && response.data) {
        setSlackStatus(response.data)
        if (response.data.connected) {
          fetchSlackChannels()
        }
      }
    } catch (err) {
      console.error('Failed to fetch Slack status:', err)
      setSlackStatus({ connected: false })
    }
  }

  const fetchSlackChannels = async () => {
    try {
      setLoadingChannels(true)
      const response = await api.getSlackChannels()
      if (response.success && response.data) {
        setSlackChannels(response.data)
      }
    } catch (err) {
      console.error('Failed to fetch Slack channels:', err)
    } finally {
      setLoadingChannels(false)
    }
  }

  const handleConnectSlack = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setConnectingSlack(true)
      setError(null)
      const response = await api.connectSlack(slackBotToken, selectedChannel)
      if (response.success) {
        setSuccess('Slack connected successfully!')
        setSlackBotToken('')
        fetchSlackStatus()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Slack')
    } finally {
      setConnectingSlack(false)
    }
  }

  const handleDisconnectSlack = async () => {
    if (!confirm('Are you sure you want to disconnect Slack?')) return
    try {
      setError(null)
      const response = await api.disconnectSlack()
      if (response.success) {
        setSuccess('Slack disconnected successfully')
        setSlackStatus({ connected: false })
        setSlackChannels([])
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Slack')
    }
  }

  const handleSetChannel = async () => {
    if (!selectedChannel) return
    try {
      setError(null)
      const channel = slackChannels.find(c => c.id === selectedChannel)
      if (!channel) return

      const response = await api.setSlackChannel(selectedChannel, channel.name)
      if (response.success) {
        setSuccess(`Channel set to #${channel.name}`)
        fetchSlackStatus()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set channel')
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
            {asanaSettings?.configured ? (
              <span className="status-badge status-connected">
                <CheckCircle size={14} /> Configured
              </span>
            ) : (
              <span className="status-badge status-disconnected">
                Not Configured
              </span>
            )}
          </div>
        </div>

        <div className="integration-body">
          {asanaSettings?.configured ? (
            <>
              <div className="integration-details">
                <div className="detail-item">
                  <span className="detail-label">API Token</span>
                  <span className="detail-value">{asanaSettings.pat || '****'}</span>
                </div>
                {asanaSettings.project_id && (
                  <div className="detail-item">
                    <span className="detail-label">Default Project</span>
                    <span className="detail-value">
                      {asanaProjects.find(p => p.gid === asanaSettings.project_id)?.name || asanaSettings.project_id}
                    </span>
                  </div>
                )}
              </div>

              {/* Quick Sync Button - Available to all users */}
              <div className="sync-section">
                <h3>Quick Sync</h3>
                <p className="sync-description">
                  Import tasks from Asana to your board. Changes made here will sync back to Asana.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={handleQuickSync}
                  disabled={syncingAsana}
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

              {/* Admin Settings */}
              {isAdmin && (
                <div className="admin-settings-section">
                  <h3>
                    <Settings size={18} /> Admin Settings
                  </h3>

                  {/* Update PAT */}
                  {showPATInput ? (
                    <form onSubmit={handleSaveSettings} className="settings-form">
                      <div className="form-group">
                        <label>Update Asana Personal Access Token</label>
                        <input
                          type="password"
                          value={asanaPAT}
                          onChange={(e) => setAsanaPAT(e.target.value)}
                          placeholder="Enter new PAT"
                          className="form-input"
                        />
                      </div>
                      <div className="form-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => { setShowPATInput(false); setAsanaPAT(''); }}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn btn-primary"
                          disabled={savingSettings || !asanaPAT.trim()}
                        >
                          {savingSettings ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      className="btn btn-ghost"
                      onClick={() => setShowPATInput(true)}
                    >
                      Update API Token
                    </button>
                  )}

                  {/* Project Selection */}
                  <div className="form-group">
                    <label>Default Asana Project</label>
                    <div className="project-select-group">
                      <select
                        value={selectedProjectId}
                        onChange={(e) => setSelectedProjectId(e.target.value)}
                        className="form-input"
                      >
                        <option value="">Select a project...</option>
                        {asanaProjects.map((project) => (
                          <option key={project.gid} value={project.gid}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSaveSettings}
                        disabled={savingSettings || !selectedProjectId}
                      >
                        <Save size={14} /> Save
                      </button>
                    </div>
                  </div>

                  {/* Test Connection */}
                  <button
                    className="btn btn-ghost"
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                  >
                    {testingConnection ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              )}

              <div className="integration-actions">
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
              {isAdmin ? (
                <form onSubmit={handleSaveSettings} className="connect-form">
                  <p className="form-help">
                    Enter your Asana Personal Access Token (PAT) to enable Asana integration for your organization.
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
                    <label>Asana Personal Access Token</label>
                    <input
                      type="password"
                      value={asanaPAT}
                      onChange={(e) => setAsanaPAT(e.target.value)}
                      placeholder="Enter your Asana PAT"
                      className="form-input"
                    />
                  </div>
                  <div className="form-actions">
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={savingSettings || !asanaPAT.trim()}
                    >
                      {savingSettings ? (
                        <>Saving...</>
                      ) : (
                        <>
                          <Link2 size={16} /> Configure Asana
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="connect-prompt">
                  <AlertCircle size={24} />
                  <p>Asana is not configured. Please contact your administrator to set up the Asana integration.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Slack Integration Card */}
      <div className="integration-card glass-card">
        <div className="integration-header">
          <div className="integration-logo" style={{ backgroundColor: '#4A154B' }}>
            <MessageSquare size={24} color="white" />
          </div>
          <div className="integration-info">
            <h2>Slack</h2>
            <p>Read channel messages for AI analysis and daily task tracking</p>
          </div>
          <div className="integration-status">
            {slackStatus?.connected ? (
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
          {slackStatus?.connected ? (
            <>
              <div className="integration-details">
                <div className="detail-item">
                  <span className="detail-label">Workspace</span>
                  <span className="detail-value">{slackStatus.team_name || 'Connected'}</span>
                </div>
                {slackStatus.channel_name && (
                  <div className="detail-item">
                    <span className="detail-label">Monitoring Channel</span>
                    <span className="detail-value">#{slackStatus.channel_name}</span>
                  </div>
                )}
              </div>

              {/* Channel Selection */}
              <div className="form-group">
                <label>Select Channel to Monitor</label>
                <div className="project-select-group">
                  <select
                    value={selectedChannel || slackStatus.channel_id || ''}
                    onChange={(e) => setSelectedChannel(e.target.value)}
                    className="form-input"
                    disabled={loadingChannels}
                  >
                    <option value="">Select a channel...</option>
                    {slackChannels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        #{channel.name} {channel.is_private ? '(Private)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSetChannel}
                    disabled={!selectedChannel || loadingChannels}
                  >
                    <Save size={14} /> Set Channel
                  </button>
                </div>
                {loadingChannels && <p className="form-help">Loading channels...</p>}
              </div>

              <div className="integration-actions">
                <button
                  className="btn btn-ghost"
                  onClick={handleDisconnectSlack}
                >
                  <Unlink size={16} /> Disconnect Slack
                </button>
                <a
                  href="https://slack.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                >
                  <ExternalLink size={16} /> Open Slack
                </a>
              </div>
            </>
          ) : (
            <form onSubmit={handleConnectSlack} className="connect-form">
              <p className="form-help">
                Enter your Slack Bot Token to connect. The bot needs the following scopes:
                <code>channels:history</code>, <code>channels:read</code>, <code>users:read</code>
              </p>
              <div className="form-group">
                <label>Slack Bot Token (xoxb-...)</label>
                <input
                  type="password"
                  value={slackBotToken}
                  onChange={(e) => setSlackBotToken(e.target.value)}
                  placeholder="xoxb-your-bot-token"
                  className="form-input"
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={connectingSlack || !slackBotToken.trim()}
                >
                  {connectingSlack ? (
                    <>Connecting...</>
                  ) : (
                    <>
                      <Link2 size={16} /> Connect Slack
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Instructions */}
      {isAdmin && !asanaSettings?.configured && (
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
              <p>The PAT is stored securely in the database. Only admins can view or update it.</p>
            </div>
          </div>
        </div>
      )}

      {/* Slack Instructions */}
      {!slackStatus?.connected && (
        <div className="integration-card glass-card">
          <div className="integration-header">
            <h2>How to Get Your Slack Bot Token</h2>
          </div>
          <div className="integration-body">
            <ol className="instructions-list">
              <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">Slack API Apps</a></li>
              <li>Click "Create New App" → "From scratch"</li>
              <li>Name it (e.g., "Project Management") and select your workspace</li>
              <li>Go to "OAuth & Permissions" in the left sidebar</li>
              <li>Under "Bot Token Scopes", add these scopes:
                <ul>
                  <li><code>channels:history</code> - Read channel messages</li>
                  <li><code>channels:read</code> - View channel list</li>
                  <li><code>users:read</code> - View user info</li>
                  <li><code>channels:join</code> - Join channels (optional)</li>
                </ul>
              </li>
              <li>Scroll up and click "Install to Workspace"</li>
              <li>Copy the "Bot User OAuth Token" (starts with xoxb-)</li>
              <li>Paste it above to connect</li>
            </ol>
            <div className="warning-box">
              <AlertCircle size={16} />
              <p>After connecting, you'll need to invite the bot to your channel with: <code>/invite @BotName</code></p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
