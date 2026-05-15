import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, CheckCircle, Clock, Hash, MessageSquare, Bell,
  Settings, Zap, Plus, X, Trash2, Calendar, AlertTriangle,
  Sparkles, Bookmark, ExternalLink,
} from 'lucide-react'
import api from '../services/api'
import type { ReminderItem } from '../services/api'
import { AvatarFallback, cleanSlackText, timeAgo } from './SlackCards'

// ── Types shared by tab components ───────────────────────────────────────────
export type ReminderSubTab = 'Upcoming' | 'Sent' | 'Auto-alerts' | 'Templates'
export type Preset = 'tomorrow' | 'in2days' | 'nextmon' | 'in1week'

export const PRESET_LABELS: Record<Preset, string> = {
  tomorrow: 'Tomorrow', in2days: 'In 2 days', nextmon: 'Next Monday', in1week: 'In 1 week',
}

export function getPresetDate(preset: Preset): string {
  const d = new Date()
  if (preset === 'tomorrow') d.setDate(d.getDate() + 1)
  else if (preset === 'in2days') d.setDate(d.getDate() + 2)
  else if (preset === 'nextmon') { const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? 1 : 8 - day)) }
  else if (preset === 'in1week') d.setDate(d.getDate() + 7)
  return d.toISOString().split('T')[0]
}

// ── Sprint Pulse Tab ──────────────────────────────────────────────────────────
const PULSE_STATS = [
  { label: 'Feature tickets', value: 8, color: '#93c5fd', glow: '#3b82f6' },
  { label: 'Bug tickets', value: 12, color: '#f87171', glow: '#ef4444' },
  { label: 'Slack coverage', value: '58%', color: '#fcd34d', glow: '#f59e0b' },
]

const SPRINT_TICKETS = [
  { id: 'ARD-1700', type: 'Bug', summary: 'Auth service refresh token loop — mobile logout', hasDiscussion: true, mentions: 3, lastMention: '2h ago' },
  { id: 'ARD-1688', type: 'Feature', summary: 'Dashboard widget lazy loading — improve TTI by 40%', hasDiscussion: false, mentions: 0, lastMention: null },
  { id: 'ARD-1692', type: 'Feature', summary: 'A/B test framework — variant assignment persistence', hasDiscussion: false, mentions: 0, lastMention: null },
  { id: 'ARD-1698', type: 'Bug', summary: 'Payment gateway timeout under high load — prod incident', hasDiscussion: true, mentions: 5, lastMention: '30m ago' },
  { id: 'ARD-1695', type: 'Feature', summary: 'User preferences migration to new schema', hasDiscussion: false, mentions: 0, lastMention: null },
  { id: 'ARD-1701', type: 'Bug', summary: 'Redis cache invalidation race — concurrent writes', hasDiscussion: true, mentions: 8, lastMention: '15m ago' },
]

const YT_BASE_URL = 'https://simran.youtrack.cloud/issue/'

// ── Feature Tickets Modal ─────────────────────────────────────────────────────
function FeatureTicketsModal({ onClose }: { onClose: () => void }) {
  const features = SPRINT_TICKETS.filter(t => t.type === 'Feature')
  const openTicket = (id: string) => window.open(`${YT_BASE_URL}${id}`, '_blank', 'noopener')

  return (
    <div className="si2-modal-overlay" onClick={onClose}>
      <div className="si2-modal si2-modal--wide" onClick={e => e.stopPropagation()}>
        <div className="si2-modal-header">
          <AlertTriangle size={16} style={{ color: '#f59e0b' }} />
          <h3>Feature Tickets Without Discussion</h3>
          <button className="si2-modal-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="si2-modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <p className="si2-modal-preview" style={{ borderLeftColor: 'rgba(245,158,11,0.5)', marginBottom: '0.75rem' }}>
            These feature tickets have had <strong>zero Slack discussion</strong> this sprint while bug conversations dominate.
            Consider checking in with owners.
          </p>
          <div className="si2-coverage-list">
            {features.map(ticket => (
              <div key={ticket.id} className="si2-coverage-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', width: '100%' }}>
                  <span className="si2-issue-chip" style={{ cursor: 'pointer' }} onClick={() => openTicket(ticket.id)}>
                    {ticket.id}
                  </span>
                  <span className="si2-type-badge si2-type-badge--feature">Feature</span>
                  <div className="si2-coverage-activity" style={{ marginLeft: 'auto' }}>
                    <div className={`si2-activity-dot${ticket.hasDiscussion ? ' active' : ''}`} />
                    <span className={`si2-activity-label${ticket.hasDiscussion ? ' active' : ''}`}>
                      {ticket.hasDiscussion ? `${ticket.mentions} mentions` : 'No discussion'}
                    </span>
                  </div>
                </div>
                <span
                  className="si2-coverage-summary"
                  style={{ cursor: 'pointer', whiteSpace: 'normal', fontSize: '0.82rem', color: 'var(--text-primary)' }}
                  onClick={() => openTicket(ticket.id)}
                  title="Open in YouTrack"
                >
                  {ticket.summary}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="si2-modal-footer">
          <button className="si2-cancel-btn" onClick={onClose}>Close</button>
          <button className="si2-pulse-ai-btn" style={{ padding: '0.4rem 1rem', fontSize: '0.76rem' }}
            onClick={() => { features.forEach(t => openTicket(t.id)); onClose() }}>
            Open all in YouTrack
          </button>
        </div>
      </div>
    </div>
  )
}

export function SprintPulseTab({ onOpenPMAssistant }: { onOpenPMAssistant?: () => void }) {
  const [showFeaturesModal, setShowFeaturesModal] = useState(false)
  const openTicket = (id: string) => window.open(`${YT_BASE_URL}${id}`, '_blank', 'noopener')

  return (
    <div className="si2-tab-scroll">
      {showFeaturesModal && <FeatureTicketsModal onClose={() => setShowFeaturesModal(false)} />}

      {/* KPI mini-cards */}
      <div className="si2-pulse-grid">
        {PULSE_STATS.map(s => (
          <div key={s.label} className="si2-pulse-stat">
            <div className="si2-pulse-stat-glow" style={{ background: `radial-gradient(circle, ${s.glow} 0%, transparent 70%)` }} />
            <div className="si2-pulse-stat-label">{s.label}</div>
            <div className="si2-pulse-stat-value" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Focus mismatch banner */}
      <div className="si2-mismatch-banner">
        <AlertTriangle size={18} className="si2-mismatch-icon" />
        <div className="si2-mismatch-body">
          <div className="si2-mismatch-title">Focus mismatch detected</div>
          <div className="si2-mismatch-desc">
            Team Slack conversations are <strong>68% bug-related</strong>, but this sprint is 40% features.{' '}
            <strong>4 features</strong> have had zero discussion.
          </div>
        </div>
        <span className="si2-mismatch-cta" style={{ cursor: 'pointer' }} onClick={() => setShowFeaturesModal(true)}>
          View features →
        </span>
      </div>

      {/* Ticket coverage list */}
      <div>
        <div className="si2-section-label">SPRINT TICKETS</div>
        <div className="si2-coverage-list">
          {SPRINT_TICKETS.map(ticket => (
            <div key={ticket.id} className="si2-coverage-row">
              <div className="si2-coverage-chips">
                <span className="si2-issue-chip" style={{ cursor: 'pointer' }} onClick={() => openTicket(ticket.id)}>
                  {ticket.id}
                </span>
                <span className={`si2-type-badge si2-type-badge--${ticket.type === 'Bug' ? 'bug' : 'feature'}`}>
                  {ticket.type}
                </span>
              </div>
              <span className="si2-coverage-summary" style={{ cursor: 'pointer' }} onClick={() => openTicket(ticket.id)}>
                {ticket.summary}
              </span>
              <div className="si2-coverage-activity">
                <div className={`si2-activity-dot${ticket.hasDiscussion ? ' active' : ''}`} />
                <span className={`si2-activity-label${ticket.hasDiscussion ? ' active' : ''}`}>
                  {ticket.hasDiscussion ? `${ticket.mentions} mentions` : 'No discussion'}
                </span>
                {ticket.lastMention && <span className="si2-activity-time">· {ticket.lastMention}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PM Assistant CTA */}
      <div className="si2-pulse-ai-cta">
        <div className="si2-pulse-ai-cta-left">
          <Sparkles size={16} className="si2-pulse-ai-icon" />
          <div>
            <div className="si2-pulse-ai-title">Ask PM Assistant about this sprint</div>
            <div className="si2-pulse-ai-desc">
              Analyse Slack coverage, focus mismatches, and silent tickets using the PM Assistant with full sprint context.
            </div>
          </div>
        </div>
        <button className="si2-pulse-ai-btn" onClick={onOpenPMAssistant}>
          <Sparkles size={13} /> Open PM Assistant
        </button>
      </div>
    </div>
  )
}

// ── Saved Items Tab ───────────────────────────────────────────────────────────
export function SavedItemsTab({ slackTeamId }: { slackTeamId: string }) {
  const [items, setItems] = useState<Array<{ type: string; channel_id: string; text: string; user: string; ts: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getSlackSavedItems().then(res => {
      setItems(res.items ?? [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const openSlack = (channelId: string, ts: string) => {
    const t = ts.replace('.', '')
    window.location.href = `slack://channel?team=${slackTeamId}&id=${channelId}&message=${t}`
    setTimeout(() => window.open(`https://app.slack.com/client/${slackTeamId}/${channelId}/p${t}`, '_blank', 'noopener'), 1500)
  }

  if (loading) return (
    <div className="si2-empty"><RefreshCw size={20} className="spin" /><p>Loading saved items…</p></div>
  )

  if (items.length === 0) return (
    <div className="si2-empty">
      <Bookmark size={36} />
      <p>No saved messages</p>
      <p className="si2-empty-sub">Star messages in Slack to see them here.</p>
    </div>
  )

  return (
    <div className="si2-tab-scroll">
      <div className="si2-card-list">
        {items.map((item, i) => (
          <div key={i} className="si2-card" onClick={() => openSlack(item.channel_id, item.ts)}>
            <div className="si2-card-stripe" style={{ background: 'rgba(99,102,241,0.6)' }} />
            <div className="si2-card-body">
              <div className="si2-card-head">
                <AvatarFallback name={item.user || '?'} size={24} />
                <span className="si2-card-sender">{item.user}</span>
                <span style={{ flex: 1 }} />
                <ExternalLink size={11} className="si2-card-time" />
              </div>
              <p className="si2-card-text">{cleanSlackText(item.text)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
interface SettingsTabProps {
  monitorChannelId: string
  monitorChannelName: string
  lastScan: Date | null
  onSaveChannel: () => void
  onChannelIdChange: (v: string) => void
  onChannelNameChange: (v: string) => void
}

export function SettingsTabContent({ monitorChannelId, monitorChannelName, lastScan, onSaveChannel, onChannelIdChange, onChannelNameChange }: SettingsTabProps) {
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await onSaveChannel()
    setSaved(true)
    setSaving(false)
    setTimeout(() => setSaved(false), 2000)
  }

  const lastScanLabel = lastScan ? `Last scan ${timeAgo(lastScan.toISOString())}` : 'Not scanned yet'

  return (
    <div className="si2-tab-scroll">
      <div className="si2-settings-card">
        <div className="si2-settings-section">
          <div className="si2-settings-title"><Hash size={14} /> Monitor Channel</div>
          <p className="si2-settings-desc">Channel scanned for your @mentions. The Slack bot must be invited.</p>
          <div className="si2-settings-row">
            <input className="si2-input" placeholder="Channel ID (e.g. C012AB3CD)" value={monitorChannelId} onChange={e => onChannelIdChange(e.target.value)} />
            <input className="si2-input" placeholder="Channel name (e.g. general)" value={monitorChannelName} onChange={e => onChannelNameChange(e.target.value)} />
            <button className={`si2-save-btn${saved ? ' saved' : ''}`} onClick={handleSave} disabled={saving || !monitorChannelId.trim()}>
              {saving ? <><RefreshCw size={12} className="spin" /> Saving…</> : saved ? <><CheckCircle size={12} /> Saved!</> : <><CheckCircle size={12} /> Save</>}
            </button>
          </div>
        </div>
        <div className="si2-settings-divider" />
        <div className="si2-settings-section">
          <div className="si2-settings-title"><Zap size={14} /> Auto-scan</div>
          <div className="si2-autoscan-status">
            <span className="si2-autoscan-dot" />
            <span>Active — {lastScanLabel}</span>
          </div>
          <p className="si2-settings-desc">Slack is scanned every 15 minutes automatically.</p>
        </div>
        <div className="si2-settings-divider" />
        <div className="si2-settings-section">
          <div className="si2-settings-title"><MessageSquare size={14} /> Connected Channels</div>
          <p className="si2-settings-desc">
            Bot must be in both monitor and digest channels.{' '}
            <span className="si2-link" onClick={() => navigate('/integrations')}>Integrations →</span>
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Reminders Tab ─────────────────────────────────────────────────────────────
interface RemindersTabProps {
  remindersAll: ReminderItem[]
  savedTemplates: Array<{ id: string; body: string }>
  onAddTemplate: (body: string) => void
  onDeleteTemplate: (id: string) => void
  onDismiss: (id: string) => void
  onDelete: (id: string) => void
  onQuickAdd: (preset: Preset, title: string, issueId: string) => void
}

export function RemindersTabContent({
  remindersAll, savedTemplates, onAddTemplate, onDeleteTemplate, onDismiss, onDelete, onQuickAdd
}: RemindersTabProps) {
  const [subTab, setSubTab] = useState<ReminderSubTab>('Upcoming')
  const [activePreset, setActivePreset] = useState<Preset | null>(null)
  const [quickTitle, setQuickTitle] = useState('')
  const [quickIssueId, setQuickIssueId] = useState('')
  const [newTemplate, setNewTemplate] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<Set<string>>(new Set())

  const requestDelete = (id: string) => {
    setConfirmingDelete(prev => new Set([...prev, id]))
    setTimeout(() => setConfirmingDelete(prev => { const s = new Set(prev); s.delete(id); return s }), 3000)
  }
  const cancelDelete = (id: string) => setConfirmingDelete(prev => { const s = new Set(prev); s.delete(id); return s })
  const confirmDelete = (id: string) => { onDelete(id); cancelDelete(id) }

  const upcomingReminders = remindersAll.filter(r => r.status === 'pending' && r.type === 'custom').sort((a, b) => a.target_date.localeCompare(b.target_date))
  const sentReminders = remindersAll.filter(r => r.status === 'sent' && r.type === 'custom').sort((a, b) => b.target_date.localeCompare(a.target_date)).slice(0, 30)
  const autoReminders = remindersAll.filter(r => r.type !== 'custom').sort((a, b) => b.target_date.localeCompare(a.target_date))

  const handleAddTemplate = () => {
    if (!newTemplate.trim()) return
    onAddTemplate(newTemplate.trim())
    setNewTemplate('')
  }

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activePreset || !quickTitle.trim()) return
    onQuickAdd(activePreset, quickTitle, quickIssueId)
    setActivePreset(null); setQuickTitle(''); setQuickIssueId('')
  }

  const SUB_TABS: ReminderSubTab[] = ['Upcoming', 'Sent', 'Auto-alerts', 'Templates']

  return (
    <div className="si2-tab-scroll">
      {/* Quick-add */}
      <div className="si2-quick-add">
        <div className="si2-quick-add-header">
          <Clock size={15} className="si2-quick-add-icon" />
          <span className="si2-quick-add-title">Quick Reminder</span>
        </div>
        <div className="si2-preset-row">
          {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
            <button key={p} className={`si2-preset-btn${activePreset === p ? ' active' : ''}`} onClick={() => { setActivePreset(activePreset === p ? null : p); setQuickTitle(''); setQuickIssueId('') }}>
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        {activePreset && (
          <form className="si2-quick-form" onSubmit={handleQuickAdd}>
            <span className="si2-quick-date"><Calendar size={11} /> {getPresetDate(activePreset)}</span>
            <input className="si2-input" placeholder="Reminder title…" value={quickTitle} onChange={e => setQuickTitle(e.target.value)} autoFocus required />
            <input className="si2-input si2-input--sm" placeholder="Issue ID" value={quickIssueId} onChange={e => setQuickIssueId(e.target.value)} />
            <button type="submit" className="si2-save-btn" disabled={!quickTitle.trim()}>
              <Plus size={12} /> Add
            </button>
            <button type="button" className="si2-cancel-btn" onClick={() => setActivePreset(null)}>Cancel</button>
          </form>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="si2-subtabs">
        {SUB_TABS.map(t => (
          <button key={t} className={`si2-subtab${subTab === t ? ' active' : ''}`} onClick={() => setSubTab(t)}>{t}</button>
        ))}
      </div>

      {subTab === 'Upcoming' && (
        upcomingReminders.length === 0
          ? <div className="si2-empty"><Clock size={32} /><p>No upcoming reminders</p></div>
          : <div className="si2-card-list">
            {upcomingReminders.map(r => (
              <div key={r.id} className="si2-card si2-reminder-card">
                <div className="si2-card-body">
                  <div className="si2-card-head">
                    <Clock size={12} style={{ color: 'var(--color-primary)' }} />
                    <span className="si2-card-time"><Calendar size={10} /> {r.target_date}</span>
                    {r.related_issue_id && <span className="si2-issue-chip">{r.related_issue_id}</span>}
                  </div>
                  <p className="si2-card-text">{r.title}</p>
                  {r.message && <p className="si2-card-note">{r.message}</p>}
                </div>
                <div className="si2-card-actions">
                  <button className="si2-act-btn si2-act-done" onClick={() => onDismiss(r.id)}><X size={12} /></button>
                  {confirmingDelete.has(r.id) ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ fontSize: '0.72rem', color: '#f87171' }}>Delete?</span>
                      <button className="si2-act-btn si2-act-done" onClick={() => confirmDelete(r.id)}>✓</button>
                      <button className="si2-act-btn" onClick={() => cancelDelete(r.id)}>✗</button>
                    </div>
                  ) : (
                    <button className="si2-act-btn" onClick={() => requestDelete(r.id)} title="Delete"><Trash2 size={12} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
      )}

      {subTab === 'Sent' && (
        sentReminders.length === 0
          ? <div className="si2-empty"><CheckCircle size={32} /><p>No sent reminders</p></div>
          : <div className="si2-card-list">
            {sentReminders.map(r => (
              <div key={r.id} className="si2-card si2-card--done si2-reminder-card">
                <div className="si2-card-body">
                  <div className="si2-card-head">
                    <CheckCircle size={12} style={{ color: '#4ade80' }} />
                    <span className="si2-card-time"><Calendar size={10} /> {r.target_date}</span>
                  </div>
                  <p className="si2-card-text">{r.title}</p>
                </div>
                <div className="si2-card-actions">
                  {confirmingDelete.has(r.id) ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ fontSize: '0.72rem', color: '#f87171' }}>Delete?</span>
                      <button className="si2-act-btn si2-act-done" onClick={() => confirmDelete(r.id)}>✓</button>
                      <button className="si2-act-btn" onClick={() => cancelDelete(r.id)}>✗</button>
                    </div>
                  ) : (
                    <button className="si2-act-btn" onClick={() => requestDelete(r.id)} title="Delete"><Trash2 size={12} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
      )}

      {subTab === 'Auto-alerts' && (
        autoReminders.length === 0
          ? <div className="si2-empty"><Bell size={32} /><p>No auto-alerts</p><p className="si2-empty-sub">Scheduler-generated alerts appear here</p></div>
          : <div className="si2-card-list">
            {autoReminders.map(r => (
              <div key={r.id} className={`si2-card si2-reminder-card${r.status === 'sent' ? ' si2-card--done' : ''}`}>
                <div className="si2-card-body">
                  <div className="si2-card-head">
                    <span className={`si2-status-chip status-${r.status}`}>{r.type.replace(/_/g, ' ')}</span>
                    <span className="si2-card-time"><Calendar size={10} /> {r.target_date}</span>
                  </div>
                  <p className="si2-card-text">{r.title}</p>
                </div>
                <div className="si2-card-actions">
                  {r.status === 'pending' && <button className="si2-act-btn si2-act-done" onClick={() => onDismiss(r.id)}><X size={12} /></button>}
                  {confirmingDelete.has(r.id) ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ fontSize: '0.72rem', color: '#f87171' }}>Delete?</span>
                      <button className="si2-act-btn si2-act-done" onClick={() => confirmDelete(r.id)}>✓</button>
                      <button className="si2-act-btn" onClick={() => cancelDelete(r.id)}>✗</button>
                    </div>
                  ) : (
                    <button className="si2-act-btn" onClick={() => requestDelete(r.id)} title="Delete"><Trash2 size={12} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
      )}

      {subTab === 'Templates' && (
        <div>
          <div className="si2-section-label">QUICK REPLY TEMPLATES</div>
          <div className="si2-template-add-row">
            <input
              className="si2-input"
              placeholder="Add new template…"
              value={newTemplate}
              onChange={e => setNewTemplate(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddTemplate() }}
            />
            <button className="si2-save-btn" onClick={handleAddTemplate} disabled={!newTemplate.trim()}>
              <Plus size={12} /> Add
            </button>
          </div>
          <div className="si2-template-list">
            {savedTemplates.map(t => (
              <div key={t.id} className="si2-template-row">
                <span className="si2-template-body">{t.body}</span>
                <button className="si2-template-del" onClick={() => onDeleteTemplate(t.id)}><X size={12} /></button>
              </div>
            ))}
            {savedTemplates.length === 0 && (
              <p className="si2-empty-sub" style={{ margin: '1rem 0' }}>No templates yet. Add one above.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// unused but keeps Settings icon imported
export const _settings = Settings
