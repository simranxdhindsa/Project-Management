import { useState, useEffect } from 'react'
import api from '../services/api'
import type { AsanaProject, AsanaSettings, WorkflowConfig, PriorityTag, ColumnState, HotfixRules, ReportConfig } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { Link2, Unlink, RefreshCw, CheckCircle, AlertCircle, ExternalLink, Settings, Save, MessageSquare, Download, Clock, User, Sliders, Plus, Trash2, RotateCcw } from 'lucide-react'

interface SlackMessage {
  id: string
  channel_id: string
  user_id: string
  user_name: string
  text: string
  timestamp: string
}

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
  const [slackMessages, setSlackMessages] = useState<SlackMessage[]>([])
  const [fetchingMessages, setFetchingMessages] = useState(false)
  const [msgDateFrom, setMsgDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  })
  const [msgDateTo, setMsgDateTo] = useState(() => new Date().toISOString().split('T')[0])

  // Workflow config state
  const [workflowConfig, setWorkflowConfig] = useState<WorkflowConfig | null>(null)
  const [wcSection, setWcSection] = useState<'priorities' | 'columns' | 'hotfix' | 'report'>('priorities')
  const [wcSaving, setWcSaving] = useState(false)
  const [wcSuccess, setWcSuccess] = useState<string | null>(null)
  const [wcError, setWcError] = useState<string | null>(null)
  // Editable copies
  const [editTags, setEditTags] = useState<PriorityTag[]>([])
  const [editColumns, setEditColumns] = useState<ColumnState[]>([])
  const [editHotfix, setEditHotfix] = useState<HotfixRules>({ from_states: [], to_states: [] })
  const [editReport, setEditReport] = useState<ReportConfig>({ done_role: 'dev_done', blocked_states: [], open_states: [], priority_filters: [], sections: [] })

  useEffect(() => {
    fetchAsanaSettings()
    fetchSlackStatus()
    fetchWorkflowConfig()
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

  const handleFetchMessages = async () => {
    try {
      setFetchingMessages(true)
      setError(null)
      const response = await api.getSlackMessages({ from: msgDateFrom, to: msgDateTo })
      if (response.success && response.data) {
        setSlackMessages(response.data.messages || [])
        setSuccess(`Fetched ${response.data.count || 0} messages`)
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages')
    } finally {
      setFetchingMessages(false)
    }
  }

  const fetchWorkflowConfig = async () => {
    try {
      const res = await api.getWorkflowConfig()
      if (res.success && res.data) {
        setWorkflowConfig(res.data)
        setEditTags(res.data.priority_tags ?? [])
        setEditColumns(res.data.column_hierarchy ?? [])
        setEditHotfix(res.data.hotfix_rules ?? { from_states: [], to_states: [] })
        setEditReport(res.data.report_config ?? { done_role: 'dev_done', blocked_states: [], open_states: [], priority_filters: [], sections: [] })
      }
    } catch (err) {
      console.error('Failed to load workflow config:', err)
    }
  }

  const handleSavePriorities = async () => {
    try {
      setWcSaving(true); setWcError(null)
      const res = await api.updatePriorityTags(editTags)
      if (res.success && res.data) {
        setWorkflowConfig(res.data)
        setWcSuccess('Priority tags saved!')
        setTimeout(() => setWcSuccess(null), 3000)
      }
    } catch (e) { setWcError(e instanceof Error ? e.message : 'Save failed') }
    finally { setWcSaving(false) }
  }

  const handleSaveColumns = async () => {
    const withRanks = editColumns.map((c, i) => ({ ...c, rank: i }))
    try {
      setWcSaving(true); setWcError(null)
      const res = await api.updateColumnHierarchy(withRanks)
      if (res.success && res.data) {
        setWorkflowConfig(res.data)
        setEditColumns(res.data.column_hierarchy)
        setWcSuccess('Column hierarchy saved!')
        setTimeout(() => setWcSuccess(null), 3000)
      }
    } catch (e) { setWcError(e instanceof Error ? e.message : 'Save failed') }
    finally { setWcSaving(false) }
  }

  const handleSaveHotfix = async () => {
    try {
      setWcSaving(true); setWcError(null)
      const res = await api.updateHotfixRules(editHotfix)
      if (res.success && res.data) {
        setWorkflowConfig(res.data)
        setWcSuccess('Hotfix rules saved!')
        setTimeout(() => setWcSuccess(null), 3000)
      }
    } catch (e) { setWcError(e instanceof Error ? e.message : 'Save failed') }
    finally { setWcSaving(false) }
  }

  const handleSaveReport = async () => {
    try {
      setWcSaving(true); setWcError(null)
      const res = await api.updateReportConfig(editReport)
      if (res.success && res.data) {
        setWorkflowConfig(res.data)
        setWcSuccess('Report config saved!')
        setTimeout(() => setWcSuccess(null), 3000)
      }
    } catch (e) { setWcError(e instanceof Error ? e.message : 'Save failed') }
    finally { setWcSaving(false) }
  }

  const handleResetWorkflow = async () => {
    if (!confirm('Reset your workflow config to system defaults?')) return
    try {
      setWcSaving(true); setWcError(null)
      await api.resetWorkflowConfig()
      await fetchWorkflowConfig()
      setWcSuccess('Reset to defaults!')
      setTimeout(() => setWcSuccess(null), 3000)
    } catch (e) { setWcError(e instanceof Error ? e.message : 'Reset failed') }
    finally { setWcSaving(false) }
  }

  const addPriorityTag = () => {
    setEditTags(prev => [...prev, {
      label: '', color: '#6366f1', display_order: prev.length, sla_hours: 24, prefixes: [], yt_mappings: []
    }])
  }

  const updateTag = (i: number, field: keyof PriorityTag, value: string | number | string[]) => {
    setEditTags(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t))
  }

  const removeTag = (i: number) => {
    setEditTags(prev => prev.filter((_, idx) => idx !== i))
  }

  const updateColumn = (i: number, field: keyof ColumnState, value: string | number | boolean | string[]) => {
    setEditColumns(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  const moveColumn = (i: number, dir: -1 | 1) => {
    setEditColumns(prev => {
      const arr = [...prev]
      const j = i + dir
      if (j < 0 || j >= arr.length) return arr;
      [arr[i], arr[j]] = [arr[j], arr[i]]
      return arr
    })
  }

  const COLUMN_ROLES = ['backlog', 'active', 'blocked', 'findings', 'dev_done', 'verified', 'deployed', 'closed']
  const REPORT_SECTIONS = ['done', 'hotfixes', 'open', 'blocked', 'overdue']

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

              {/* Fetch Messages Section */}
              {slackStatus?.channel_name && (
                <div className="slack-fetch-section">
                  <h3><Download size={18} /> Fetch Messages</h3>
                  <p className="form-help">
                    Manually pull messages from #{slackStatus.channel_name} for a date range
                  </p>
                  <div className="slack-date-range">
                    <div className="form-group">
                      <label>From</label>
                      <input
                        type="date"
                        value={msgDateFrom}
                        onChange={(e) => setMsgDateFrom(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <label>To</label>
                      <input
                        type="date"
                        value={msgDateTo}
                        onChange={(e) => setMsgDateTo(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleFetchMessages}
                      disabled={fetchingMessages}
                    >
                      {fetchingMessages ? (
                        <><RefreshCw size={16} className="spin" /> Fetching...</>
                      ) : (
                        <><Download size={16} /> Fetch</>
                      )}
                    </button>
                  </div>

                  {slackMessages.length > 0 && (
                    <div className="slack-messages-list">
                      <div className="slack-messages-header">
                        <span className="slack-msg-count">{slackMessages.length} messages</span>
                      </div>
                      <div className="slack-messages-scroll">
                        {slackMessages.map((msg) => (
                          <div key={msg.id} className="slack-msg-item">
                            <div className="slack-msg-meta">
                              <span className="slack-msg-user"><User size={12} /> {msg.user_name}</span>
                              <span className="slack-msg-time"><Clock size={12} /> {new Date(msg.timestamp).toLocaleString()}</span>
                            </div>
                            <div className="slack-msg-text">{msg.text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

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

      {/* Workflow Config Card */}
      <div className="integration-card glass-card">
        <div className="integration-header">
          <div className="integration-logo">
            <Sliders size={40} className="wc-header-icon" />
          </div>
          <div className="integration-info">
            <h2>Workflow Configuration</h2>
            <p>Customize priority tags, column hierarchy, hotfix detection, and report defaults</p>
          </div>
          <div className="integration-status">
            {workflowConfig ? (
              <span className="status-badge status-connected"><CheckCircle size={14} /> Configured</span>
            ) : (
              <span className="status-badge status-disconnected">Loading...</span>
            )}
          </div>
        </div>

        {workflowConfig && (
          <div className="integration-body">
            {wcError && (
              <div className="alert alert-error">
                <AlertCircle size={16} /> {wcError}
                <button className="alert-close" onClick={() => setWcError(null)}>&times;</button>
              </div>
            )}
            {wcSuccess && (
              <div className="alert alert-success">
                <CheckCircle size={16} /> {wcSuccess}
              </div>
            )}

            {/* Sub-tabs */}
            <div className="wc-tabs">
              {(['priorities', 'columns', 'hotfix', 'report'] as const).map(tab => (
                <button
                  key={tab}
                  className={`wc-tab${wcSection === tab ? ' wc-tab-active' : ''}`}
                  onClick={() => setWcSection(tab)}
                >
                  {tab === 'priorities' ? 'Priority Tags' :
                   tab === 'columns' ? 'Column Hierarchy' :
                   tab === 'hotfix' ? 'Hotfix Rules' : 'Report Defaults'}
                </button>
              ))}
            </div>

            {/* Priority Tags */}
            {wcSection === 'priorities' && (
              <div className="wc-section">
                <p className="form-help">Define tags like P0, B1, A0 with custom SLA thresholds and colors.</p>
                <div className="wc-tag-list">
                  {editTags.map((tag, i) => (
                    <div key={i} className="wc-tag-row">
                      <div className="wc-color-wrap">
                        <input
                          type="color"
                          value={tag.color}
                          onChange={e => updateTag(i, 'color', e.target.value)}
                          className="wc-color-input"
                          title="Tag color"
                        />
                      </div>
                      <input
                        type="text"
                        value={tag.label}
                        onChange={e => updateTag(i, 'label', e.target.value)}
                        placeholder="Label (P0, B1...)"
                        className="wc-text-input wc-label-input"
                      />
                      <div className="wc-sla-wrap">
                        <input
                          type="number"
                          value={tag.sla_hours}
                          onChange={e => updateTag(i, 'sla_hours', parseFloat(e.target.value) || 0)}
                          className="wc-text-input wc-sla-input"
                          title="SLA hours"
                          min={0}
                          step={0.5}
                        />
                        <span className="wc-unit">h SLA</span>
                      </div>
                      <input
                        type="text"
                        value={(tag.prefixes ?? []).join(', ')}
                        onChange={e => updateTag(i, 'prefixes', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                        placeholder="Prefixes (P0, B0)"
                        className="wc-text-input wc-prefix-input"
                        title="Summary prefixes (comma-separated)"
                      />
                      <input
                        type="text"
                        value={(tag.yt_mappings ?? []).join(', ')}
                        onChange={e => updateTag(i, 'yt_mappings', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                        placeholder="YT mappings (Critical)"
                        className="wc-text-input wc-yt-input"
                        title="YouTrack priority field values"
                      />
                      <button className="wc-remove-btn" onClick={() => removeTag(i)} title="Remove tag">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="wc-actions">
                  <button className="btn btn-ghost btn-sm" onClick={addPriorityTag}>
                    <Plus size={14} /> Add Tag
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={handleSavePriorities} disabled={wcSaving}>
                    <Save size={14} /> {wcSaving ? 'Saving...' : 'Save Tags'}
                  </button>
                </div>
              </div>
            )}

            {/* Column Hierarchy */}
            {wcSection === 'columns' && (
              <div className="wc-section">
                <p className="form-help">Define the order and role of your YouTrack workflow columns. Drag rows using the arrows.</p>
                <div className="wc-col-list">
                  <div className="wc-col-header">
                    <span>Order</span>
                    <span>State Name</span>
                    <span>Role</span>
                    <span>Aliases</span>
                    <span>Lateral</span>
                  </div>
                  {editColumns.map((col, i) => (
                    <div key={i} className="wc-col-row">
                      <div className="wc-col-order">
                        <button className="wc-arrow-btn" onClick={() => moveColumn(i, -1)} disabled={i === 0}>▲</button>
                        <button className="wc-arrow-btn" onClick={() => moveColumn(i, 1)} disabled={i === editColumns.length - 1}>▼</button>
                      </div>
                      <input
                        type="text"
                        value={col.state}
                        onChange={e => updateColumn(i, 'state', e.target.value)}
                        className="wc-text-input"
                        placeholder="State name"
                      />
                      <select
                        value={col.role}
                        onChange={e => updateColumn(i, 'role', e.target.value)}
                        className="wc-select"
                      >
                        {COLUMN_ROLES.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={(col.aliases ?? []).join(', ')}
                        onChange={e => updateColumn(i, 'aliases', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                        className="wc-text-input wc-alias-input"
                        placeholder="Aliases (comma-separated)"
                      />
                      <input
                        type="checkbox"
                        checked={col.is_lateral}
                        onChange={e => updateColumn(i, 'is_lateral', e.target.checked)}
                        className="wc-checkbox"
                        title="Lateral (not part of main flow)"
                      />
                    </div>
                  ))}
                </div>
                <div className="wc-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleSaveColumns} disabled={wcSaving}>
                    <Save size={14} /> {wcSaving ? 'Saving...' : 'Save Columns'}
                  </button>
                </div>
              </div>
            )}

            {/* Hotfix Rules */}
            {wcSection === 'hotfix' && (
              <div className="wc-section">
                <p className="form-help">
                  Hotfix detection: a ticket jumping directly from a "backlog" or "active" column to a "deployed" column (skipping dev_done + verified) is flagged as a hotfix.
                  Leave lists empty to auto-derive from column roles, or specify explicit state names.
                </p>
                <div className="wc-hotfix-grid">
                  <div className="form-group">
                    <label>From States (empty = auto: backlog + active roles)</label>
                    <input
                      type="text"
                      value={editHotfix.from_states.join(', ')}
                      onChange={e => setEditHotfix(h => ({ ...h, from_states: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                      className="form-input"
                      placeholder="e.g. Backlog, In Progress"
                    />
                  </div>
                  <div className="form-group">
                    <label>To States (empty = auto: deployed roles)</label>
                    <input
                      type="text"
                      value={editHotfix.to_states.join(', ')}
                      onChange={e => setEditHotfix(h => ({ ...h, to_states: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                      className="form-input"
                      placeholder="e.g. STAGE, PROD"
                    />
                  </div>
                </div>
                <div className="wc-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleSaveHotfix} disabled={wcSaving}>
                    <Save size={14} /> {wcSaving ? 'Saving...' : 'Save Rules'}
                  </button>
                </div>
              </div>
            )}

            {/* Report Defaults */}
            {wcSection === 'report' && (
              <div className="wc-section">
                <p className="form-help">Configure which columns and priorities appear in PM reports by default.</p>
                <div className="wc-report-grid">
                  <div className="form-group">
                    <label>Done Role (columns with this role count as "done" in reports)</label>
                    <select
                      value={editReport.done_role}
                      onChange={e => setEditReport(r => ({ ...r, done_role: e.target.value }))}
                      className="form-input"
                    >
                      {COLUMN_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Open States (comma-separated column names to include in open issues)</label>
                    <input
                      type="text"
                      value={editReport.open_states.join(', ')}
                      onChange={e => setEditReport(r => ({ ...r, open_states: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                      className="form-input"
                      placeholder="e.g. In Progress, Backlog, STAGE"
                    />
                  </div>
                  <div className="form-group">
                    <label>Blocked States (comma-separated)</label>
                    <input
                      type="text"
                      value={editReport.blocked_states.join(', ')}
                      onChange={e => setEditReport(r => ({ ...r, blocked_states: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                      className="form-input"
                      placeholder="e.g. Blocked"
                    />
                  </div>
                  <div className="form-group">
                    <label>Priority Filters (which tags to include, empty = all)</label>
                    <input
                      type="text"
                      value={editReport.priority_filters.join(', ')}
                      onChange={e => setEditReport(r => ({ ...r, priority_filters: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                      className="form-input"
                      placeholder="e.g. P0, P1, B0"
                    />
                  </div>
                  <div className="form-group">
                    <label>Report Sections</label>
                    <div className="wc-section-chips">
                      {REPORT_SECTIONS.map(s => (
                        <label key={s} className="wc-chip-label">
                          <input
                            type="checkbox"
                            checked={editReport.sections.length === 0 || editReport.sections.includes(s)}
                            onChange={e => {
                              setEditReport(r => {
                                const all = REPORT_SECTIONS
                                const current = r.sections.length === 0 ? all : r.sections
                                return { ...r, sections: e.target.checked ? [...current.filter(x => x !== s), s] : current.filter(x => x !== s) }
                              })
                            }}
                          />
                          {s}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="wc-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleSaveReport} disabled={wcSaving}>
                    <Save size={14} /> {wcSaving ? 'Saving...' : 'Save Report Config'}
                  </button>
                </div>
              </div>
            )}

            <div className="wc-footer">
              <button className="btn btn-ghost btn-sm" onClick={handleResetWorkflow} disabled={wcSaving}>
                <RotateCcw size={14} /> Reset to Defaults
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
