import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, CheckCircle, Clock, Bell, Hash,
  Settings, AlertCircle, MessageSquare,
  ExternalLink, Moon, ChevronDown, Filter, Zap,
  Trash2, X, Calendar, Plus
} from 'lucide-react'
import api from '../services/api'
import type { SlackMention, SlackThread, ReminderItem } from '../services/api'

// ── Slack SVG icon ──────────────────────────────────────────────────────────
function SlackIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.7 32.5a4.9 4.9 0 1 1-4.9-4.9h4.9v4.9Z" fill="#E01E5A"/>
      <path d="M22.2 32.5a4.9 4.9 0 0 1 9.8 0v12.3a4.9 4.9 0 0 1-9.8 0V32.5Z" fill="#E01E5A"/>
      <path d="M27.1 19.7a4.9 4.9 0 1 1 4.9-4.9v4.9H27.1Z" fill="#36C5F0"/>
      <path d="M27.1 22.2a4.9 4.9 0 0 1 0 9.8H14.8a4.9 4.9 0 0 1 0-9.8H27.1Z" fill="#36C5F0"/>
      <path d="M39.9 27.1a4.9 4.9 0 1 1 4.9 4.9H39.9V27.1Z" fill="#2EB67D"/>
      <path d="M37.4 27.1a4.9 4.9 0 0 1-9.8 0V14.8a4.9 4.9 0 0 1 9.8 0V27.1Z" fill="#2EB67D"/>
      <path d="M32.5 39.9a4.9 4.9 0 1 1-4.9 4.9V39.9h4.9Z" fill="#ECB22E"/>
      <path d="M32.5 37.4a4.9 4.9 0 0 1 0-9.8h12.3a4.9 4.9 0 0 1 0 9.8H32.5Z" fill="#ECB22E"/>
    </svg>
  )
}

// ── Utilities ────────────────────────────────────────────────────────────────
function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

function truncate(text: string, max = 140) {
  return text.length <= max ? text : text.slice(0, max) + '…'
}

function cleanSlackText(text: string): string {
  return text
    .replace(/<@U[A-Z0-9]+>/g, '@user')
    .replace(/<#C[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<#C[A-Z0-9]+>/g, '#channel')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<https?:[^>]+>/g, '[link]')
    .replace(/\n+/g, ' ')
    .trim()
}

// Extract YouTrack issue IDs like ARD-123 from text
function extractIssueIds(text: string): string[] {
  const matches = text.match(/[A-Z]{2,10}-\d+/g)
  return matches ? [...new Set(matches)] : []
}

// Determine urgency: 0=high (red), 1=medium (yellow), 2=low (default)
function urgency(m: SlackMention): number {
  const ageMins = (Date.now() - new Date(m.created_at).getTime()) / 60000
  if (ageMins > 120) return 0   // > 2h old = high
  if (ageMins > 30) return 1    // > 30m = medium
  return 2
}

function isSnoozed(snoozedUntil?: string): boolean {
  if (!snoozedUntil) return false
  return new Date(snoozedUntil) > new Date()
}

type Tab = 'inbox' | 'threads' | 'reminders' | 'settings'
type Filter = 'all' | 'unread' | 'snoozed' | 'resolved'
type ReminderSubTab = 'upcoming' | 'sent' | 'auto'
type Preset = 'tomorrow' | 'in2days' | 'nextmon' | 'in1week'

const PRESET_LABELS: Record<Preset, string> = {
  tomorrow: 'Tomorrow',
  in2days: 'In 2 days',
  nextmon: 'Next Monday',
  in1week: 'In 1 week',
}

function getPresetDate(preset: Preset): string {
  const d = new Date()
  if (preset === 'tomorrow') d.setDate(d.getDate() + 1)
  else if (preset === 'in2days') d.setDate(d.getDate() + 2)
  else if (preset === 'nextmon') { const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? 1 : 8 - day)) }
  else if (preset === 'in1week') d.setDate(d.getDate() + 7)
  return d.toISOString().split('T')[0]
}

function getReminderTypeLabel(type: string) {
  switch (type) {
    case 'task_followup': return 'Follow-up'
    case 'blocked_issue': return 'Blocker'
    case 'update_check': return 'Update Check'
    case 'daily_digest': return 'Daily Digest'
    case 'slack_followup': return 'Slack Follow-up'
    default: return 'Custom'
  }
}

interface SlackIntelligencePageProps {
  initialTab?: Tab
  onTabChange?: (tab: Tab) => void
}

export function SlackIntelligencePage({ initialTab = 'inbox', onTabChange }: SlackIntelligencePageProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [filter, setFilter] = useState<Filter>('unread')

  useEffect(() => { setTab(initialTab) }, [initialTab])

  const handleTabChange = (t: Tab) => { setTab(t); onTabChange?.(t) }

  // ── Data state ──────────────────────────────────────────────────────────
  const [mentions, setMentions] = useState<SlackMention[]>([])
  const [threads, setThreads] = useState<SlackThread[]>([])
  const [remindersAll, setRemindersAll] = useState<ReminderItem[]>([])
  const [loading, setLoading] = useState(false)

  // ── Reminders sub-tab state ──────────────────────────────────────────────
  const [reminderSubTab, setReminderSubTab] = useState<ReminderSubTab>('upcoming')
  const [activePreset, setActivePreset] = useState<Preset | null>(null)
  const [quickTitle, setQuickTitle] = useState('')
  const [quickIssueId, setQuickIssueId] = useState('')
  const [creatingReminder, setCreatingReminder] = useState(false)

  // ── Auto-scan state ─────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<Date | null>(null)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const autoScanRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [autoScanEnabled] = useState(true)

  // ── Team/channel state ──────────────────────────────────────────────────
  const [slackTeamId, setSlackTeamId] = useState('T03Q9638YJJ')
  const [monitorChannelId, setMonitorChannelId] = useState('')
  const [monitorChannelName, setMonitorChannelName] = useState('')
  const [resolvedMonitorChannelName, setResolvedMonitorChannelName] = useState('')
  const [savingChannel, setSavingChannel] = useState(false)
  const [channelMsg, setChannelMsg] = useState<string | null>(null)

  // ── Modal state ─────────────────────────────────────────────────────────
  const [reminderModal, setReminderModal] = useState<{ mention?: SlackMention; thread?: SlackThread } | null>(null)
  const [reminderDate, setReminderDate] = useState(new Date(Date.now() + 86400000).toISOString().split('T')[0])
  const [reminderNote, setReminderNote] = useState('')
  const [savingReminder, setSavingReminder] = useState(false)
  const [reminderMsg, setReminderMsg] = useState<string | null>(null)

  // ── Snooze dropdown ─────────────────────────────────────────────────────
  const [snoozeOpen, setSnoozeOpen] = useState<string | null>(null) // messageTS or threadTS

  // ── Fetch functions ─────────────────────────────────────────────────────
  const fetchMentions = useCallback(async () => {
    try {
      const res: any = await api.getSlackMentions()
      if (res.success) {
        setMentions(res.mentions ?? [])
      }
    } catch {}
  }, [])

  const fetchThreads = useCallback(async () => {
    try {
      const res: any = await api.getSlackThreads()
      if (res.success) setThreads(res.threads ?? [])
    } catch {}
  }, [])

  const fetchReminders = useCallback(async () => {
    try {
      const res = await api.getReminders()
      if (res.success && res.data) {
        setRemindersAll(res.data)
      }
    } catch {}
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([fetchMentions(), fetchThreads(), fetchReminders()])
    setLoading(false)
  }, [fetchMentions, fetchThreads, fetchReminders])

  useEffect(() => {
    fetchAll()
    api.getSlackStatus().then((res: any) => {
      if (res.team_id) setSlackTeamId(res.team_id)
      if (res.monitor_channel_id) setMonitorChannelId(res.monitor_channel_id)
      if (res.monitor_channel_name) {
        setMonitorChannelName(res.monitor_channel_name)
        setResolvedMonitorChannelName(res.monitor_channel_name)
      }
    }).catch(() => {})
  }, [fetchAll])

  // ── Auto-scan every 15 min ───────────────────────────────────────────────
  useEffect(() => {
    if (!autoScanEnabled) return
    autoScanRef.current = setInterval(async () => {
      try {
        const res: any = await api.scanSlack()
        if (res.success) {
          setLastScan(new Date())
          if (res.new_mentions > 0 || res.new_threads > 0) {
            await fetchMentions()
            await fetchThreads()
          }
        }
      } catch {}
    }, 15 * 60 * 1000)
    return () => { if (autoScanRef.current) clearInterval(autoScanRef.current) }
  }, [autoScanEnabled, fetchMentions, fetchThreads])

  // ── Manual scan ──────────────────────────────────────────────────────────
  const handleScan = async () => {
    setScanning(true)
    setScanMsg(null)
    try {
      const res: any = await api.scanSlack()
      if (res.success) {
        setLastScan(new Date())
        setScanMsg(
          res.new_mentions > 0 || res.new_threads > 0
            ? `↑ ${res.new_mentions} new mention(s), ${res.new_threads} new thread(s)`
            : 'All caught up'
        )
        await fetchMentions()
        await fetchThreads()
      }
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : 'Scan failed')
    }
    setScanning(false)
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  const openSlack = (channelId: string, messageTs: string, threadTs?: string | null) => {
    const ts = messageTs.replace('.', '')
    const appUrl = `slack://channel?team=${slackTeamId}&id=${channelId}&message=${ts}`
    const webUrl = `https://app.slack.com/client/${slackTeamId}/${channelId}/p${ts}`
    window.location.href = appUrl
    setTimeout(() => window.open(webUrl, '_blank', 'noopener,noreferrer'), 1500)
  }

  const handleDismiss = async (messageTS: string) => {
    await api.dismissSlackMention(messageTS).catch(() => {})
    setMentions(prev => prev.map(m => m.message_ts === messageTS ? { ...m, replied: true } : m))
  }

  const handleSnooze = async (type: 'mention' | 'thread', ts: string, until: '2h' | 'tomorrow') => {
    setSnoozeOpen(null)
    const snoozedUntil = until === 'tomorrow'
      ? new Date(new Date().setDate(new Date().getDate() + 1)).toISOString()
      : new Date(Date.now() + 2 * 3600000).toISOString()

    if (type === 'mention') {
      await api.snoozeSlackMention(ts, until).catch(() => {})
      setMentions(prev => prev.map(m => m.message_ts === ts ? { ...m, snoozed_until: snoozedUntil } : m))
    } else {
      await api.snoozeSlackThread(ts, until).catch(() => {})
      setThreads(prev => prev.map(t => t.thread_ts === ts ? { ...t, snoozed_until: snoozedUntil } : t))
    }
  }

  const openReminderModal = (mention?: SlackMention, thread?: SlackThread) => {
    setReminderModal({ mention, thread })
    setReminderDate(new Date(Date.now() + 86400000).toISOString().split('T')[0])
    setReminderNote('')
    setReminderMsg(null)
  }

  const handleSaveReminder = async () => {
    if (!reminderModal) return
    setSavingReminder(true)
    try {
      const { mention, thread } = reminderModal
      const res = await api.createSlackFollowupReminder({
        thread_ts: mention?.thread_ts ?? mention?.message_ts ?? thread?.thread_ts ?? '',
        channel_id: mention?.channel_id ?? thread?.channel_id ?? '',
        message_text: mention?.message_text ?? thread?.message_text ?? '',
        follow_up_date: reminderDate,
        note: reminderNote,
      })
      if (res.success) {
        setReminderMsg('Reminder saved!')
        await fetchFollowups()
        setTimeout(() => { setReminderModal(null); setReminderMsg(null) }, 1200)
      }
    } catch (e) {
      setReminderMsg(e instanceof Error ? e.message : 'Failed')
    }
    setSavingReminder(false)
  }

  const handleSaveChannel = async () => {
    if (!monitorChannelId.trim()) return
    setSavingChannel(true)
    setChannelMsg(null)
    try {
      await api.setSlackMonitorChannel(monitorChannelId.trim(), monitorChannelName.trim() || monitorChannelId.trim())
      setChannelMsg('Channel saved!')
    } catch (e) {
      setChannelMsg(e instanceof Error ? e.message : 'Failed')
    }
    setSavingChannel(false)
  }

  // ── Reminder CRUD ────────────────────────────────────────────────────────
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activePreset || !quickTitle.trim()) return
    setCreatingReminder(true)
    try {
      const res = await api.createReminder({
        title: quickTitle.trim(),
        target_date: getPresetDate(activePreset),
        type: 'custom',
        related_issue_id: quickIssueId.trim() || undefined,
      })
      if (res.success) {
        setActivePreset(null); setQuickTitle(''); setQuickIssueId('')
        setReminderSubTab('upcoming')
        fetchReminders()
      }
    } catch {}
    setCreatingReminder(false)
  }

  const handleDismissReminder = async (id: string) => {
    await api.dismissReminder(id).catch(() => {})
    setRemindersAll(prev => prev.filter(r => r.id !== id))
  }

  const handleDeleteReminder = async (id: string) => {
    await api.deleteReminder(id).catch(() => {})
    setRemindersAll(prev => prev.filter(r => r.id !== id))
  }

  // ── Filtered lists ───────────────────────────────────────────────────────
  const visibleMentions = mentions.filter(m => {
    if (filter === 'unread') return !m.replied && !isSnoozed(m.snoozed_until)
    if (filter === 'snoozed') return isSnoozed(m.snoozed_until)
    if (filter === 'resolved') return m.replied
    return true
  })

  // Reminders derived lists
  const upcomingReminders = remindersAll
    .filter(r => r.status === 'pending' && r.type === 'custom')
    .sort((a, b) => a.target_date.localeCompare(b.target_date))
  const sentReminders = remindersAll
    .filter(r => r.status === 'sent' && r.type === 'custom')
    .sort((a, b) => b.target_date.localeCompare(a.target_date))
    .slice(0, 30)
  const autoReminders = remindersAll
    .filter(r => r.type !== 'custom')
    .sort((a, b) => b.target_date.localeCompare(a.target_date))

  // Sort: unreplied first, then by urgency, then by recency
  const sortedMentions = [...visibleMentions].sort((a, b) => {
    if (!a.replied && b.replied) return -1
    if (a.replied && !b.replied) return 1
    return urgency(a) - urgency(b)
  })

  const visibleThreads = threads.filter(t => {
    if (filter === 'snoozed') return isSnoozed(t.snoozed_until)
    if (filter === 'unread') return !t.has_reply && !isSnoozed(t.snoozed_until)
    return true
  })

  const needsActionCount = mentions.filter(m => !m.replied && !isSnoozed(m.snoozed_until)).length
    + threads.filter(t => !t.has_reply && !isSnoozed(t.snoozed_until)).length

  // ── Render helpers ───────────────────────────────────────────────────────
  const renderUrgencyDot = (m: SlackMention) => {
    const u = urgency(m)
    if (m.replied) return null
    if (u === 0) return <span className="si-urgency-dot si-urgency-high" title="Waiting > 2h" />
    if (u === 1) return <span className="si-urgency-dot si-urgency-med" title="Waiting > 30m" />
    return <span className="si-urgency-dot si-urgency-low" />
  }

  const renderIssueChips = (text: string) => {
    const ids = extractIssueIds(text)
    if (ids.length === 0) return null
    return (
      <div className="si-issue-chips">
        {ids.map(id => (
          <span
            key={id}
            className="si-issue-chip"
            onClick={e => { e.stopPropagation(); navigate(`/board?issue=${id}`) }}
            title={`Open ${id} in YouTrack`}
          >
            <ExternalLink size={10} />{id}
          </span>
        ))}
      </div>
    )
  }

  const renderSnoozeMenu = (type: 'mention' | 'thread', ts: string) => (
    <div className="si-snooze-menu" onClick={e => e.stopPropagation()}>
      <button className="si-snooze-opt" onClick={() => handleSnooze(type, ts, '2h')}>
        <Clock size={12} /> 2 hours
      </button>
      <button className="si-snooze-opt" onClick={() => handleSnooze(type, ts, 'tomorrow')}>
        <Moon size={12} /> Tomorrow 9 AM
      </button>
    </div>
  )

  // ── Last scan display ────────────────────────────────────────────────────
  const lastScanLabel = lastScan
    ? `Last scan ${timeAgo(lastScan.toISOString())}`
    : 'Not scanned yet'

  return (
    <div className="si-page" onClick={() => setSnoozeOpen(null)}>

      {/* ── Header ── */}
      <div className="si-header">
        <div className="si-header-left">
          <SlackIcon size={22} />
          <h2>Slack Intelligence</h2>
          {needsActionCount > 0 && (
            <span className="si-unread-badge">{needsActionCount}</span>
          )}
        </div>
        <div className="si-header-right">
          <span className="si-autoscan-label">
            <Zap size={12} className="si-autoscan-icon" />
            {lastScanLabel}
          </span>
          <button
            className={`si-scan-btn ${scanning ? 'scanning' : ''}`}
            onClick={handleScan}
            disabled={scanning}
          >
            <RefreshCw size={14} className={scanning ? 'spin' : ''} />
            {scanning ? 'Scanning…' : 'Scan Now'}
          </button>
        </div>
      </div>

      {scanMsg && <div className={`si-scan-result ${scanMsg === 'All caught up' ? 'ok' : ''}`}>{scanMsg}</div>}

      {/* ── Tabs ── */}
      <div className="si-tabs">
        <button className={`si-tab ${tab === 'inbox' ? 'active' : ''}`} onClick={() => handleTabChange('inbox')}>
          <AlertCircle size={14} />
          Priority Inbox
          {needsActionCount > 0 && <span className="si-tab-badge">{needsActionCount}</span>}
        </button>
        <button className={`si-tab ${tab === 'threads' ? 'active' : ''}`} onClick={() => handleTabChange('threads')}>
          <MessageSquare size={14} />
          My Threads
          {threads.filter(t => !t.has_reply && !isSnoozed(t.snoozed_until)).length > 0 && (
            <span className="si-tab-badge si-tab-badge-warn">
              {threads.filter(t => !t.has_reply && !isSnoozed(t.snoozed_until)).length}
            </span>
          )}
        </button>
        <button className={`si-tab ${tab === 'reminders' ? 'active' : ''}`} onClick={() => handleTabChange('reminders')}>
          <Bell size={14} />
          Reminders
          {upcomingReminders.length > 0 && (
            <span className="si-tab-badge">{upcomingReminders.length}</span>
          )}
        </button>
        <button className={`si-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => handleTabChange('settings')}>
          <Settings size={14} />
          Settings
        </button>
      </div>

      {/* ── Filter bar (inbox + threads) ── */}
      {(tab === 'inbox' || tab === 'threads') && (
        <div className="si-filter-bar">
          <Filter size={13} className="si-filter-icon" />
          {(tab === 'inbox'
            ? ['unread', 'all', 'snoozed', 'resolved'] as Filter[]
            : ['unread', 'all', 'snoozed'] as Filter[]
          ).map(f => (
            <button
              key={f}
              className={`si-filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'unread' ? 'Needs Action' : f === 'all' ? 'All' : f === 'snoozed' ? 'Snoozed' : 'Resolved'}
            </button>
          ))}
        </div>
      )}

      {/* ── Content ── */}
      <div className="si-content">

        {/* ── INBOX TAB ── */}
        {tab === 'inbox' && (
          loading ? (
            <div className="si-loading"><RefreshCw size={16} className="spin" /> Loading…</div>
          ) : sortedMentions.length === 0 ? (
            <div className="si-empty">
              <CheckCircle size={36} />
              <p>{filter === 'snoozed' ? 'No snoozed mentions.' : 'Inbox zero — no unread @mentions.'}</p>
              {filter !== 'snoozed' && <p className="si-empty-sub">Connect Slack and click Scan Now to detect new mentions.</p>}
            </div>
          ) : (
            <div className="si-card-list">
              {sortedMentions.map(m => {
                const snoozed = isSnoozed(m.snoozed_until)
                const isOpen = snoozeOpen === m.message_ts
                return (
                  <div
                    key={m.id}
                    className={`si-card ${m.replied ? 'si-card-done' : ''} ${snoozed ? 'si-card-snoozed' : ''}`}
                  >
                    {/* Card body — click to open in Slack */}
                    <div
                      className="si-card-body si-card-link"
                      onClick={() => openSlack(m.channel_id, m.message_ts, m.thread_ts)}
                    >
                      <div className="si-card-meta">
                        {m.sender_avatar
                          ? <img src={m.sender_avatar} alt={m.sender_name} className="si-avatar" />
                          : <span className="si-avatar si-avatar-fallback">{m.sender_name.charAt(0).toUpperCase()}</span>
                        }
                        {renderUrgencyDot(m)}
                        <span className="si-sender">{m.sender_name}</span>
                        <span className="si-channel"><Hash size={11} />{resolvedMonitorChannelName || 'slack'}</span>
                        <span className="si-time">{timeAgo(m.created_at)}</span>
                        {snoozed && m.snoozed_until && (
                          <span className="si-snooze-label">
                            <Moon size={10} /> until {new Date(m.snoozed_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        {m.replied && <span className="si-done-chip"><CheckCircle size={11} /> Done</span>}
                      </div>
                      <p className="si-card-text">{truncate(cleanSlackText(m.message_text))}</p>
                      {renderIssueChips(m.message_text)}
                    </div>

                    {/* Actions */}
                    {!m.replied && (
                      <div className="si-card-actions" onClick={e => e.stopPropagation()}>
                        <button className="si-btn si-btn-done" onClick={() => handleDismiss(m.message_ts)}>
                          <CheckCircle size={12} /> Handled
                        </button>
                        <button className="si-btn si-btn-reminder" onClick={() => openReminderModal(m)}>
                          <Clock size={12} /> Remind
                        </button>
                        <div className="si-snooze-wrap">
                          <button
                            className="si-btn si-btn-snooze"
                            onClick={() => setSnoozeOpen(isOpen ? null : m.message_ts)}
                          >
                            <Moon size={12} /> Snooze <ChevronDown size={10} />
                          </button>
                          {isOpen && renderSnoozeMenu('mention', m.message_ts)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* ── THREADS TAB ── */}
        {tab === 'threads' && (
          loading ? (
            <div className="si-loading"><RefreshCw size={16} className="spin" /> Loading…</div>
          ) : visibleThreads.length === 0 ? (
            <div className="si-empty">
              <MessageSquare size={36} />
              <p>{filter === 'snoozed' ? 'No snoozed threads.' : 'No unanswered threads.'}</p>
            </div>
          ) : (
            <div className="si-card-list">
              {visibleThreads.map(t => {
                const snoozed = isSnoozed(t.snoozed_until)
                const isOpen = snoozeOpen === t.thread_ts
                return (
                  <div
                    key={t.id}
                    className={`si-card ${t.has_reply ? 'si-card-done' : ''} ${snoozed ? 'si-card-snoozed' : ''}`}
                  >
                    <div
                      className="si-card-body si-card-link"
                      onClick={() => openSlack(t.channel_id, t.thread_ts)}
                    >
                      <div className="si-card-meta">
                        <span className="si-channel"><Hash size={11} />{resolvedMonitorChannelName || 'slack'}</span>
                        <span className="si-time">{timeAgo(t.created_at)}</span>
                        <span className={`si-reply-chip ${t.has_reply ? 'has-reply' : 'no-reply'}`}>
                          {t.reply_count === 0 ? 'No replies' : `${t.reply_count} repl${t.reply_count === 1 ? 'y' : 'ies'}`}
                        </span>
                        {snoozed && t.snoozed_until && (
                          <span className="si-snooze-label">
                            <Moon size={10} /> snoozed
                          </span>
                        )}
                      </div>
                      <p className="si-card-text">{truncate(cleanSlackText(t.message_text))}</p>
                      {renderIssueChips(t.message_text)}
                    </div>
                    <div className="si-card-actions" onClick={e => e.stopPropagation()}>
                      <button className="si-btn si-btn-reminder" onClick={() => openReminderModal(undefined, t)}>
                        <Clock size={12} /> Follow up
                      </button>
                      {!t.has_reply && (
                        <div className="si-snooze-wrap">
                          <button
                            className="si-btn si-btn-snooze"
                            onClick={() => setSnoozeOpen(isOpen ? null : t.thread_ts)}
                          >
                            <Moon size={12} /> Snooze <ChevronDown size={10} />
                          </button>
                          {isOpen && renderSnoozeMenu('thread', t.thread_ts)}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* ── REMINDERS TAB ── */}
        {tab === 'reminders' && (
          <div className="si-reminders-panel">
            {/* Quick-add bar */}
            <div className="si-quick-add-bar glass-card">
              <div className="si-quick-add-presets">
                {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
                  <button
                    key={p}
                    className={`si-preset-btn${activePreset === p ? ' active' : ''}`}
                    onClick={() => { setActivePreset(activePreset === p ? null : p); setQuickTitle(''); setQuickIssueId('') }}
                  >
                    {PRESET_LABELS[p]}
                  </button>
                ))}
              </div>
              {activePreset && (
                <form className="si-quick-add-form" onSubmit={handleQuickAdd}>
                  <span className="si-quick-add-date"><Clock size={12} /> {getPresetDate(activePreset)}</span>
                  <input
                    className="si-modal-input"
                    placeholder="Reminder title…"
                    value={quickTitle}
                    onChange={e => setQuickTitle(e.target.value)}
                    autoFocus
                    required
                  />
                  <input
                    className="si-modal-input si-quick-issue-input"
                    placeholder="Issue ID (optional)"
                    value={quickIssueId}
                    onChange={e => setQuickIssueId(e.target.value)}
                  />
                  <button type="submit" className="si-btn si-btn-save" disabled={creatingReminder || !quickTitle.trim()}>
                    <Plus size={12} /> {creatingReminder ? 'Adding…' : 'Add'}
                  </button>
                  <button type="button" className="si-btn si-btn-cancel" onClick={() => { setActivePreset(null); setQuickTitle(''); setQuickIssueId('') }}>
                    Cancel
                  </button>
                </form>
              )}
            </div>

            {/* Sub-tabs */}
            <div className="si-reminder-subtabs">
              <button className={`si-reminder-subtab${reminderSubTab === 'upcoming' ? ' active' : ''}`} onClick={() => setReminderSubTab('upcoming')}>
                Upcoming {upcomingReminders.length > 0 && <span className="si-tab-badge">{upcomingReminders.length}</span>}
              </button>
              <button className={`si-reminder-subtab${reminderSubTab === 'sent' ? ' active' : ''}`} onClick={() => setReminderSubTab('sent')}>
                Sent
              </button>
              <button className={`si-reminder-subtab${reminderSubTab === 'auto' ? ' active' : ''}`} onClick={() => setReminderSubTab('auto')}>
                Auto-alerts {autoReminders.filter(r => r.status === 'pending').length > 0 && <span className="si-tab-badge">{autoReminders.filter(r => r.status === 'pending').length}</span>}
              </button>
            </div>

            {/* Upcoming */}
            {reminderSubTab === 'upcoming' && (
              upcomingReminders.length === 0 ? (
                <div className="si-empty"><Clock size={32} /><p>No upcoming reminders</p><p className="si-empty-sub">Use the preset buttons above to add one</p></div>
              ) : (
                <div className="si-card-list">
                  {upcomingReminders.map(r => (
                    <div key={r.id} className="si-card si-reminder-card">
                      <div className="si-card-body">
                        <div className="si-card-meta">
                          <Clock size={11} className="si-reminder-icon" />
                          <span className="si-time"><Calendar size={11} /> {r.target_date}</span>
                          {r.related_issue_id && <span className="si-issue-chip"><ExternalLink size={10} />{r.related_issue_id}</span>}
                        </div>
                        <p className="si-card-text">{r.title}</p>
                        {r.message && <p className="si-card-note">{r.message}</p>}
                      </div>
                      <div className="si-card-actions" onClick={e => e.stopPropagation()}>
                        <button className="si-btn si-btn-done" onClick={() => handleDismissReminder(r.id)} title="Dismiss"><X size={12} /></button>
                        <button className="si-btn si-btn-cancel" onClick={() => handleDeleteReminder(r.id)} title="Delete"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Sent */}
            {reminderSubTab === 'sent' && (
              sentReminders.length === 0 ? (
                <div className="si-empty"><CheckCircle size={32} /><p>No sent reminders</p></div>
              ) : (
                <div className="si-card-list">
                  {sentReminders.map(r => (
                    <div key={r.id} className="si-card si-reminder-card si-card-done">
                      <div className="si-card-body">
                        <div className="si-card-meta">
                          <CheckCircle size={11} className="si-reminder-icon" />
                          <span className="si-time"><Calendar size={11} /> {r.target_date}</span>
                        </div>
                        <p className="si-card-text">{r.title}</p>
                      </div>
                      <div className="si-card-actions" onClick={e => e.stopPropagation()}>
                        <button className="si-btn si-btn-cancel" onClick={() => handleDeleteReminder(r.id)} title="Delete"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Auto-alerts */}
            {reminderSubTab === 'auto' && (
              autoReminders.length === 0 ? (
                <div className="si-empty"><Bell size={32} /><p>No auto-alerts</p><p className="si-empty-sub">Scheduler-generated alerts appear here</p></div>
              ) : (
                <div className="si-card-list">
                  {autoReminders.map(r => (
                    <div key={r.id} className={`si-card si-reminder-card ${r.status === 'sent' ? 'si-card-done' : ''}`}>
                      <div className="si-card-body">
                        <div className="si-card-meta">
                          <span className={`si-status-chip status-${r.status}`}>{getReminderTypeLabel(r.type)}</span>
                          <span className="si-time"><Calendar size={11} /> {r.target_date}</span>
                          {r.related_issue_id && <span className="si-issue-chip"><ExternalLink size={10} />{r.related_issue_id}</span>}
                        </div>
                        <p className="si-card-text">{r.title}</p>
                        {r.message && <p className="si-card-note">{r.message}</p>}
                      </div>
                      <div className="si-card-actions" onClick={e => e.stopPropagation()}>
                        {r.status === 'pending' && <button className="si-btn si-btn-done" onClick={() => handleDismissReminder(r.id)} title="Dismiss"><X size={12} /></button>}
                        <button className="si-btn si-btn-cancel" onClick={() => handleDeleteReminder(r.id)} title="Delete"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {tab === 'settings' && (
          <div className="si-settings">
            <div className="si-settings-card glass-card">
              <div className="si-settings-section">
                <h4 className="si-settings-title"><Hash size={15} /> Monitor Channel</h4>
                <p className="si-settings-desc">
                  Channel scanned for your @mentions. Enter the channel ID and name.
                  The Slack bot must be invited to this channel.
                </p>
                <div className="si-settings-row">
                  <input
                    className="si-modal-input"
                    placeholder="Channel ID (e.g. C012AB3CD)"
                    value={monitorChannelId}
                    onChange={e => setMonitorChannelId(e.target.value)}
                  />
                  <input
                    className="si-modal-input"
                    placeholder="Channel name (e.g. general)"
                    value={monitorChannelName}
                    onChange={e => setMonitorChannelName(e.target.value)}
                  />
                  <button
                    className="si-btn si-btn-save"
                    onClick={handleSaveChannel}
                    disabled={savingChannel || !monitorChannelId.trim()}
                  >
                    {savingChannel ? <><RefreshCw size={12} className="spin" /> Saving…</> : <><CheckCircle size={12} /> Save</>}
                  </button>
                </div>
                {channelMsg && (
                  <p className={`si-modal-msg ${channelMsg === 'Channel saved!' ? 'success' : 'error'}`}>{channelMsg}</p>
                )}
              </div>

              <div className="si-settings-section">
                <h4 className="si-settings-title"><Zap size={15} /> Auto-scan</h4>
                <p className="si-settings-desc">
                  Slack is automatically scanned every <strong>15 minutes</strong> in the background.
                  New @mentions trigger a notification bell. You can also scan manually anytime.
                </p>
                <div className="si-autoscan-status">
                  <span className="si-autoscan-dot" />
                  Active — {lastScanLabel}
                </div>
              </div>

              <div className="si-settings-section">
                <h4 className="si-settings-title"><MessageSquare size={15} /> Connected Channels</h4>
                <p className="si-settings-desc">
                  Your bot must be in both the monitor channel and the digest channel.
                  Configure the full connection in{' '}
                  <span className="si-inline-link" onClick={() => navigate('/integrations')}>Integrations →</span>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Reminder modal ── */}
      {reminderModal && (
        <div className="si-modal-overlay" onClick={() => setReminderModal(null)}>
          <div className="si-modal" onClick={e => e.stopPropagation()}>
            <div className="si-modal-header">
              <Clock size={16} />
              <h3>Set Follow-up Reminder</h3>
              <button className="si-modal-close" onClick={() => setReminderModal(null)}>✕</button>
            </div>
            <div className="si-modal-body">
              <p className="si-modal-preview">
                {truncate(cleanSlackText(
                  reminderModal.mention?.message_text ?? reminderModal.thread?.message_text ?? ''
                ), 80)}
              </p>
              <label className="si-modal-label">Follow-up date</label>
              <input
                type="date"
                className="si-modal-input"
                value={reminderDate}
                onChange={e => setReminderDate(e.target.value)}
              />
              <label className="si-modal-label">Note (optional)</label>
              <input
                type="text"
                className="si-modal-input"
                placeholder="What to follow up on…"
                value={reminderNote}
                onChange={e => setReminderNote(e.target.value)}
              />
              {reminderMsg && (
                <p className={`si-modal-msg ${reminderMsg === 'Reminder saved!' ? 'success' : 'error'}`}>{reminderMsg}</p>
              )}
            </div>
            <div className="si-modal-footer">
              <button className="si-btn si-btn-cancel" onClick={() => setReminderModal(null)}>Cancel</button>
              <button className="si-btn si-btn-save" onClick={handleSaveReminder} disabled={savingReminder}>
                {savingReminder ? 'Saving…' : 'Save Reminder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
