import { useState, useEffect } from 'react'
import {
  Bot,
  Plus,
  Trash2,
  Save,
  Power,
  PowerOff,
  ChevronDown,
  ChevronUp,
  Variable,
  FileText,
  X,
  Copy,
  Check,
} from 'lucide-react'
import api from '../services/api'
import type { BotConfig, BotVariable } from '../services/api'

// ====== Variable Tag Component ======
function VariableTag({ name, onClick }: { name: string; onClick?: () => void }) {
  return (
    <span className="variable-tag" onClick={onClick} title={`Insert {{$${name}$}}`}>
      <Variable size={12} />
      {'{{$' + name + '$}}'}
    </span>
  )
}

// ====== Bot Card Component ======
function BotCard({
  bot,
  onEdit,
  onDelete,
  onToggle,
}: {
  bot: BotConfig
  onEdit: (bot: BotConfig) => void
  onDelete: (id: string) => void
  onToggle: (id: string, active: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const botTypeLabels: Record<string, string> = {
    slack_analysis: 'Slack Analysis',
    daily_report: 'Daily Report',
    custom: 'Custom',
  }

  const botTypeColors: Record<string, string> = {
    slack_analysis: 'var(--color-primary)',
    daily_report: 'var(--color-success)',
    custom: 'var(--color-secondary)',
  }

  let variables: BotVariable[] = []
  try {
    variables = JSON.parse(bot.variables || '[]')
  } catch {
    variables = []
  }

  return (
    <div className={`bot-card glass-card ${!bot.is_active ? 'bot-inactive' : ''}`}>
      <div className="bot-card-header">
        <div className="bot-card-info">
          <div className="bot-card-icon" style={{ backgroundColor: botTypeColors[bot.bot_type] || 'var(--color-secondary)' }}>
            <Bot size={18} />
          </div>
          <div>
            <h3 className="bot-card-name">{bot.name}</h3>
            <span className="bot-card-type">{botTypeLabels[bot.bot_type] || bot.bot_type}</span>
          </div>
        </div>
        <div className="bot-card-actions">
          <button
            className={`btn-icon-sm ${bot.is_active ? 'btn-active' : 'btn-inactive'}`}
            onClick={() => onToggle(bot.id, !bot.is_active)}
            title={bot.is_active ? 'Deactivate' : 'Activate'}
          >
            {bot.is_active ? <Power size={16} /> : <PowerOff size={16} />}
          </button>
          <button
            className="btn-icon-sm"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      <p className="bot-card-description">{bot.description}</p>

      {variables.length > 0 && (
        <div className="bot-card-variables">
          {variables.map((v) => (
            <VariableTag key={v.name} name={v.name} />
          ))}
        </div>
      )}

      {expanded && (
        <div className="bot-card-expanded">
          <div className="bot-prompt-preview">
            <label>Prompt</label>
            <pre className="bot-prompt-text">{bot.prompt}</pre>
          </div>

          {variables.length > 0 && (
            <div className="bot-variables-detail">
              <label>Variables</label>
              <div className="bot-variables-list">
                {variables.map((v) => (
                  <div key={v.name} className="bot-variable-item">
                    <span className="bot-variable-name">{'{{$' + v.name + '$}}'}</span>
                    <span className="bot-variable-label">{v.label}</span>
                    <span className="bot-variable-type">{v.type}</span>
                    {v.required && <span className="bot-variable-required">Required</span>}
                    {v.description && <span className="bot-variable-desc">{v.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bot-card-footer">
            <button className="btn btn-primary btn-sm" onClick={() => onEdit(bot)}>
              <FileText size={14} />
              Edit
            </button>
            {!bot.id.startsWith('template-') && (
              <button className="btn btn-ghost btn-sm btn-danger-text" onClick={() => onDelete(bot.id)}>
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ====== Bot Editor Modal ======
function BotEditor({
  bot,
  onSave,
  onClose,
}: {
  bot: BotConfig | null
  onSave: (config: BotConfig) => void
  onClose: () => void
}) {
  const [name, setName] = useState(bot?.name || '')
  const [description, setDescription] = useState(bot?.description || '')
  const [botType, setBotType] = useState(bot?.bot_type || 'custom')
  const [prompt, setPrompt] = useState(bot?.prompt || '')
  const [variables, setVariables] = useState<BotVariable[]>(() => {
    try {
      return JSON.parse(bot?.variables || '[]')
    } catch {
      return []
    }
  })
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic')
  const [copied, setCopied] = useState<string | null>(null)

  const addVariable = () => {
    setVariables([
      ...variables,
      {
        name: '',
        label: '',
        type: 'text',
        default: '',
        required: false,
      },
    ])
  }

  const updateVariable = (index: number, updates: Partial<BotVariable>) => {
    const updated = variables.map((v, i) => (i === index ? { ...v, ...updates } : v))
    setVariables(updated)
  }

  const removeVariable = (index: number) => {
    setVariables(variables.filter((_, i) => i !== index))
  }

  const insertVariable = (name: string) => {
    setPrompt(prompt + `{{$${name}$}}`)
  }

  const copyVariableTag = (name: string) => {
    navigator.clipboard.writeText(`{{$${name}$}}`)
    setCopied(name)
    setTimeout(() => setCopied(null), 1500)
  }

  const handleSave = () => {
    const config: BotConfig = {
      id: bot?.id || '',
      name,
      description,
      bot_type: botType as BotConfig['bot_type'],
      prompt,
      variables: JSON.stringify(variables),
      is_active: bot?.is_active ?? true,
    }
    onSave(config)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bot-editor-modal glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="bot-editor-header">
          <h2>{bot?.id ? 'Edit Bot' : 'Create Bot'}</h2>
          <div className="bot-editor-mode-toggle">
            <button
              className={`mode-btn ${mode === 'basic' ? 'active' : ''}`}
              onClick={() => setMode('basic')}
            >
              Basic
            </button>
            <button
              className={`mode-btn ${mode === 'advanced' ? 'active' : ''}`}
              onClick={() => setMode('advanced')}
            >
              Advanced
            </button>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="bot-editor-body">
          {/* Name & Type */}
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Bot Name</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Slack Task Analysis"
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Type</label>
              <select
                className="form-input"
                value={botType}
                onChange={(e) => setBotType(e.target.value)}
              >
                <option value="slack_analysis">Slack Analysis</option>
                <option value="daily_report">Daily Report</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div className="form-group">
            <label>Description</label>
            <input
              type="text"
              className="form-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this bot do?"
            />
          </div>

          {/* Variables Section */}
          <div className="form-group">
            <div className="form-label-row">
              <label>Variables</label>
              <button className="btn btn-ghost btn-sm" onClick={addVariable}>
                <Plus size={14} />
                Add Variable
              </button>
            </div>

            {variables.length > 0 && (
              <div className="variable-editor-list">
                {variables.map((v, i) => (
                  <div key={i} className="variable-editor-row">
                    <input
                      type="text"
                      className="form-input form-input-sm"
                      placeholder="Variable name"
                      value={v.name}
                      onChange={(e) =>
                        updateVariable(i, { name: e.target.value.toUpperCase().replace(/\s/g, '_') })
                      }
                    />
                    <input
                      type="text"
                      className="form-input form-input-sm"
                      placeholder="Label"
                      value={v.label}
                      onChange={(e) => updateVariable(i, { label: e.target.value })}
                    />
                    <select
                      className="form-input form-input-sm"
                      value={v.type}
                      onChange={(e) =>
                        updateVariable(i, { type: e.target.value as BotVariable['type'] })
                      }
                    >
                      <option value="text">Text</option>
                      <option value="select">Select</option>
                      <option value="date">Date</option>
                      <option value="team_member">Team Member</option>
                    </select>
                    <input
                      type="text"
                      className="form-input form-input-sm"
                      placeholder="Default"
                      value={v.default}
                      onChange={(e) => updateVariable(i, { default: e.target.value })}
                    />
                    <label className="variable-required-check">
                      <input
                        type="checkbox"
                        checked={v.required}
                        onChange={(e) => updateVariable(i, { required: e.target.checked })}
                      />
                      Req
                    </label>
                    <button
                      className="btn-icon-sm"
                      onClick={() => copyVariableTag(v.name)}
                      title="Copy tag"
                    >
                      {copied === v.name ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      className="btn-icon-sm btn-danger-ghost"
                      onClick={() => removeVariable(i)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {variables.length > 0 && (
              <div className="variable-insert-hint">
                Click a variable to insert into prompt:
                <div className="variable-insert-tags">
                  {variables
                    .filter((v) => v.name)
                    .map((v) => (
                      <VariableTag
                        key={v.name}
                        name={v.name}
                        onClick={() => insertVariable(v.name)}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Prompt */}
          <div className="form-group">
            <label>Prompt {mode === 'advanced' && '(Advanced)'}</label>
            <textarea
              className="form-input bot-prompt-editor"
              rows={mode === 'advanced' ? 15 : 8}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your bot prompt here. Use {{$VARIABLE_NAME$}} to reference variables."
            />
          </div>
        </div>

        <div className="bot-editor-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!name.trim()}>
            <Save size={16} />
            {bot?.id && !bot.id.startsWith('template-') ? 'Update Bot' : 'Create Bot'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ====== Main Page ======
export function BotConfigPage() {
  const [bots, setBots] = useState<BotConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editingBot, setEditingBot] = useState<BotConfig | null>(null)
  const [showEditor, setShowEditor] = useState(false)

  useEffect(() => {
    fetchBots()
  }, [])

  const fetchBots = async () => {
    setLoading(true)
    try {
      const response = await api.listBots()
      if (response.success && response.data) {
        setBots(response.data as BotConfig[])
      }
    } catch (err) {
      console.error('Error fetching bots:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (bot: BotConfig) => {
    setEditingBot(bot)
    setShowEditor(true)
  }

  const handleCreate = () => {
    setEditingBot(null)
    setShowEditor(true)
  }

  const handleSave = async (config: BotConfig) => {
    try {
      if (config.id && !config.id.startsWith('template-')) {
        await api.updateBot(config.id, {
          name: config.name,
          description: config.description,
          prompt: config.prompt,
          variables: config.variables,
          is_active: config.is_active,
        })
      } else {
        await api.createBot({
          name: config.name,
          description: config.description,
          bot_type: config.bot_type,
          prompt: config.prompt,
          variables: config.variables,
        })
      }
      setShowEditor(false)
      setEditingBot(null)
      fetchBots()
    } catch (err) {
      console.error('Error saving bot:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this bot?')) return
    try {
      await api.deleteBot(id)
      fetchBots()
    } catch (err) {
      console.error('Error deleting bot:', err)
    }
  }

  const handleToggle = async (id: string, active: boolean) => {
    try {
      await api.updateBot(id, { is_active: active })
      setBots(bots.map((b) => (b.id === id ? { ...b, is_active: active } : b)))
    } catch (err) {
      console.error('Error toggling bot:', err)
    }
  }

  if (loading) {
    return (
      <div className="bot-config-page">
        <div className="daily-loading">
          <div className="loading-spinner" />
          <p>Loading bot configurations...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bot-config-page">
      <div className="bot-config-header">
        <div>
          <h2 className="bot-config-title">Bot Configuration</h2>
          <p className="bot-config-subtitle">
            Configure AI bots for Slack analysis, report generation, and custom tasks.
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleCreate}>
          <Plus size={16} />
          New Bot
        </button>
      </div>

      {bots.length === 0 ? (
        <div className="daily-empty-state glass-card">
          <Bot size={48} />
          <h3>No Bots Configured</h3>
          <p>Create a bot from a template or build your own custom bot.</p>
          <button className="btn btn-primary" onClick={handleCreate}>
            <Plus size={16} />
            Create Bot
          </button>
        </div>
      ) : (
        <div className="bot-grid">
          {bots.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <BotEditor
          bot={editingBot}
          onSave={handleSave}
          onClose={() => {
            setShowEditor(false)
            setEditingBot(null)
          }}
        />
      )}
    </div>
  )
}
