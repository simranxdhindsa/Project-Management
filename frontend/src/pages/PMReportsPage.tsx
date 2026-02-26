import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  MessageSquare, Send, User, Bot, Loader2,
  FileText, Users, Clock, Copy, Check,
  RefreshCw, ChevronDown, AlertTriangle, TrendingUp,
  Calendar, Pin, PinOff, ChevronLeft, ChevronRight,
  Search, RotateCcw, ArrowDownUp, ArrowUpNarrowWide,
  ArrowDownNarrowWide, Star, Activity, X, TriangleAlert,
  CheckCircle2, Timer, Zap, Filter, Trash2,
} from 'lucide-react'
import api, { getYouTrackAvatarMap } from '../services/api'
import type { IssueTimeline, IssueStint } from '../services/api'
import DailyOpsTab from './DailyOpsTab'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface PMReport {
  id: string
  date: string
  report_text: string
  done_count: number
  open_count: number
  blocked_count: number
  generated_at: string
  updated_at: string
}

interface AssigneeStat {
  assignee: string
  open: number
  in_progress: number
  done: number
  blocked: number
  avg_hours_in_progress: number | null
  issues: string[]
}

interface TimeTrackingRow {
  id: string
  issue_id: string
  issue_summary: string
  assignee: string
  moved_by: string
  moved_by_mismatch: boolean
  from_state: string
  to_state: string
  priority: string
  transitioned_at: string
  duration_in_prev_state_hours: number | null
  comment: string
  overdue: boolean
  threshold_hours: number
  pinned: boolean
}

// State order for moved-back detection (lower = earlier in workflow)
const STATE_ORDER: Record<string, number> = {
  'backlog': 0, 'open': 0,
  'in progress': 1,
  'dev': 2,
  'stage': 3, 'ready for stage': 3,
  'prod': 4, 'ready for prod': 4,
  'done': 5, 'closed': 5, "won't fix": 5, 'duplicate': 5, 'mobile done': 5,
}

function isMovedBack(fromState: string, toState: string): boolean {
  const from = STATE_ORDER[fromState.toLowerCase()] ?? 1
  const to = STATE_ORDER[toState.toLowerCase()] ?? 1
  return to < from
}

// Get Monday of the week containing the given date
function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day // adjust so Monday=0
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  return `${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString(undefined, opts)}`
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'tracking', label: 'Time Tracking', icon: Clock },
  { id: 'timeline', label: 'Issue Timeline', icon: Activity },
  { id: 'daily', label: 'Daily Report', icon: FileText },
  { id: 'assignees', label: 'Assignee Stats', icon: Users },
  { id: 'dailyops', label: 'Daily Ops', icon: Zap },
] as const

type TabId = typeof TABS[number]['id']

const SUGGESTED_QUERIES = [
  'Which tickets are currently overdue?',
  'Show tickets that were moved back',
  'How long has each In Progress ticket been active?',
  'Show workload by assignee',
  'Which tickets are pinned?',
  'Give me a summary of blocked and In Progress tickets',
  'P1-P3 issues by status',
  'Tickets in DEV',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatHours(h: number | null): string {
  if (h == null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${h.toFixed(1)}h`
}

function priorityBadgeClass(priority: string): string {
  const p = priority.toUpperCase()
  if (p === 'P0' || p === 'CRITICAL') return 'priority-badge p0'
  if (p === 'P1') return 'priority-badge p1'
  if (p === 'P2') return 'priority-badge p2'
  if (p === 'P3') return 'priority-badge p3'
  return 'priority-badge other'
}

// ─── Markdown renderer (preserved from original) ─────────────────────────────

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderInline(text: string) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
}

function renderMarkdown(text: string): string {
  const lines = text.split('\n')
  const htmlParts: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim().startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]))
        i++
      }
      i++
      htmlParts.push(`<pre class="pm-code-block"><code>${codeLines.join('\n')}</code></pre>`)
      continue
    }

    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableRows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const row = lines[i].trim()
        if (/^\|[\s\-:|]+\|$/.test(row)) { i++; continue }
        const cells = row.slice(1, -1).split('|').map(c => c.trim())
        tableRows.push(cells)
        i++
      }
      if (tableRows.length > 0) {
        let tableHtml = '<table class="pm-report-table"><thead><tr>'
        for (const cell of tableRows[0]) tableHtml += `<th>${escapeHtml(cell)}</th>`
        tableHtml += '</tr></thead><tbody>'
        for (let r = 1; r < tableRows.length; r++) {
          tableHtml += '<tr>'
          for (const cell of tableRows[r]) tableHtml += `<td>${renderInline(cell)}</td>`
          tableHtml += '</tr>'
        }
        tableHtml += '</tbody></table>'
        htmlParts.push(tableHtml)
      }
      continue
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length + 1
      htmlParts.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`)
      i++; continue
    }

    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const listItems: string[] = []
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        listItems.push(`<li>${renderInline(lines[i].trim().slice(2))}</li>`)
        i++
      }
      htmlParts.push(`<ul>${listItems.join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s/.test(line.trim())) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        listItems.push(`<li>${renderInline(lines[i].trim().replace(/^\d+\.\s/, ''))}</li>`)
        i++
      }
      htmlParts.push(`<ol>${listItems.join('')}</ol>`)
      continue
    }

    if (line.trim() === '') { htmlParts.push('<br/>'); i++; continue }

    htmlParts.push(`<p>${renderInline(line)}</p>`)
    i++
  }

  return htmlParts.join('')
}

// ─── Tab: PM Assistant ────────────────────────────────────────────────────────

export function PMAssistantTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (query?: string) => {
    const text = query || input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { id: `msg-${Date.now()}-user`, role: 'user', content: text, timestamp: new Date() }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    try {
      // Send full conversation history for multi-turn memory
      const history = updatedMessages.map(m => ({ role: m.role, content: m.content }))
      // The last message (current user query) is sent separately as `query`
      const historyWithoutLast = history.slice(0, -1)
      const response = await api.pmAssistantQuery(text, historyWithoutLast)
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: response.data?.response || 'No response received.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const clearChat = () => setMessages([])

  return (
    <div className="pm-tab-content pm-assistant-tab">
      {/* Context badge + clear button */}
      <div className="pm-assistant-header">
        <div className="pm-assistant-context-badge">
          <Bot size={12} />
          <span>Context: Live YouTrack issues + Time tracking data + Conversation memory</span>
        </div>
        {messages.length > 0 && (
          <button className="btn-sm btn-secondary" onClick={clearChat} title="Start a new conversation">
            Clear chat
          </button>
        )}
      </div>

      <div className="pm-chat-messages">
        {messages.length === 0 && (
          <div className="pm-chat-empty">
            <MessageSquare size={48} />
            <h3>PM Assistant</h3>
            <p>Ask about overdue tickets, regressions, workload, or anything about your project.</p>
            <div className="pm-suggested-queries">
              {SUGGESTED_QUERIES.map(q => (
                <button key={q} className="pm-suggested-chip" onClick={() => handleSend(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`pm-chat-message pm-chat-${msg.role}`}>
            <div className="pm-chat-avatar">
              {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>
            <div className="pm-chat-bubble">
              {msg.role === 'assistant' ? (
                <div className="pm-chat-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
              ) : (
                <div className="pm-chat-content">{msg.content}</div>
              )}
              <span className="pm-chat-time">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="pm-chat-message pm-chat-assistant">
            <div className="pm-chat-avatar"><Bot size={16} /></div>
            <div className="pm-chat-bubble pm-chat-loading">
              <Loader2 size={16} className="animate-spin" />
              <span>Thinking…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="pm-chat-input-bar">
        {messages.length > 0 && (
          <div className="pm-suggested-queries pm-suggested-inline">
            {SUGGESTED_QUERIES.slice(0, 4).map(q => (
              <button key={q} className="pm-suggested-chip pm-suggested-sm" onClick={() => handleSend(q)} disabled={loading}>{q}</button>
            ))}
          </div>
        )}
        <div className="pm-chat-input-row">
          <input
            ref={inputRef}
            type="text"
            className="pm-chat-input"
            placeholder="Ask about overdue tickets, workload, regressions…"
            value={input}
            onChange={e => setInput(e.target.value.slice(0, 500))}
            maxLength={500}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            disabled={loading}
          />
          <button className="pm-chat-send-btn" onClick={() => handleSend()} disabled={loading || !input.trim()}>
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Daily Report ────────────────────────────────────────────────────────

const drMonthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']

function drFormatDisplay(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${String(d).padStart(2,'0')}-${String(m).padStart(2,'0')}-${y}`
}

function DailyReportTab() {
  const [date, setDate] = useState(todayStr())
  const [report, setReport] = useState<PMReport | null>(null)
  const [history, setHistory] = useState<PMReport[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Calendar dropdown state
  const [calOpen, setCalOpen] = useState(false)
  const [calDate, setCalDate] = useState(() => new Date())
  const calRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!calOpen) return
    function handler(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [calOpen])

  function drSelectDate(d: string) {
    setDate(d)
    setReport(null)
    setCalOpen(false)
  }

  function drNavigateMonth(dir: number) {
    setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() + dir, 1))
  }

  const drDaysInMonth = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0).getDate()
  const drFirstDay   = new Date(calDate.getFullYear(), calDate.getMonth(), 1).getDay()
  const drTodayStr   = todayStr()

  // Carry-over from yesterday's EOD plan — only shown when viewing today
  const [carryoverItems, setCarryoverItems] = useState<{ text: string; done: boolean }[]>([])

  useEffect(() => {
    if (date !== todayStr()) { setCarryoverItems([]); return }
    api.getCarryover().then(res => {
      if (res.data?.yesterday?.length) setCarryoverItems(res.data.yesterday)
    }).catch(() => {})
  }, [date])

  async function handleCarryoverToggle(idx: number) {
    const updated = carryoverItems.map((item, i) => i === idx ? { ...item, done: !item.done } : item)
    setCarryoverItems(updated)
    try { await api.saveCarryoverPlan(updated) } catch { setCarryoverItems(carryoverItems) }
  }

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await api.listPMReports()
      setHistory(res.data || [])
    } catch {
      // non-fatal
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const generateReport = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.generatePMReport(date)
      setReport(res.data)
      fetchHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report')
    } finally {
      setLoading(false)
    }
  }

  const copyReport = async () => {
    if (!report) return
    await navigator.clipboard.writeText(report.report_text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const loadHistoricReport = async (r: PMReport) => {
    setDate(r.date)
    setReport(r)
  }

  // Format the slack-style report text for display
  const renderReportText = (text: string) => {
    const lines = text.split('\n')
    return lines.map((line, i) => {
      if (line.startsWith('*') && line.endsWith('*')) {
        return <div key={i} className="pm-report-section-header">{line.slice(1, -1)}</div>
      }
      if (line.startsWith('•')) {
        return <div key={i} className="pm-report-bullet">{line}</div>
      }
      if (line.startsWith('_') && line.endsWith('_')) {
        return <div key={i} className="pm-report-italic">{line.slice(1, -1)}</div>
      }
      if (line.trim() === '') {
        return <div key={i} className="pm-report-spacer" />
      }
      return <div key={i} className="pm-report-line">{line}</div>
    })
  }

  return (
    <div className="pm-tab-content pm-daily-tab">
      <div className="pm-daily-layout">
        {/* Left: Report Viewer */}
        <div className="pm-daily-main glass-card">
          <div className="pm-daily-toolbar">
            <div className="pm-daily-date-row">
              <div className="dr-cal-wrap" ref={calRef}>
                <button className="dr-cal-trigger" onClick={() => setCalOpen(o => !o)}>
                  <Calendar size={14} />
                  {drFormatDisplay(date)}
                  <ChevronDown size={13} style={{ marginLeft: '0.15rem', opacity: 0.6 }} />
                </button>
                {calOpen && (
                  <div className="dr-cal-dropdown daily-calendar glass-card">
                    <div className="calendar-nav">
                      <button className="calendar-nav-btn" onClick={() => drNavigateMonth(-1)}>
                        <ChevronLeft size={16} />
                      </button>
                      <span className="calendar-month-label">
                        {drMonthNames[calDate.getMonth()]} {calDate.getFullYear()}
                      </span>
                      <button className="calendar-nav-btn" onClick={() => drNavigateMonth(1)}>
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    <div className="calendar-grid">
                      <div className="calendar-header-row">
                        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                          <span key={d} className="calendar-day-label">{d}</span>
                        ))}
                      </div>
                      <div className="calendar-body">
                        {Array.from({ length: drFirstDay }).map((_, i) => (
                          <span key={`e-${i}`} className="calendar-day empty" />
                        ))}
                        {Array.from({ length: drDaysInMonth }).map((_, i) => {
                          const day = i + 1
                          const ds = `${calDate.getFullYear()}-${String(calDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                          const isFuture = ds > drTodayStr
                          return (
                            <button
                              key={day}
                              className={`calendar-day ${ds === date ? 'selected' : ''} ${ds === drTodayStr ? 'today' : ''} ${isFuture ? 'empty' : ''}`}
                              disabled={isFuture}
                              onClick={() => !isFuture && drSelectDate(ds)}
                            >
                              {day}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm calendar-today-btn"
                      onClick={() => { drSelectDate(drTodayStr); setCalDate(new Date()) }}
                    >
                      <Calendar size={14} />
                      Today
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="pm-daily-actions">
              <button className="btn-primary pm-generate-btn" onClick={generateReport} disabled={loading}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {loading ? 'Generating...' : 'Generate Report'}
              </button>
              {report && (
                <button className="btn-secondary pm-copy-btn" onClick={copyReport}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              )}
            </div>
          </div>

          <div className="pm-report-scroll">
            {error && (
              <div className="pm-report-error">
                <AlertTriangle size={16} />
                {error}
              </div>
            )}

            {/* Carry-over checklist — shown at top when viewing today */}
            {date === todayStr() && carryoverItems.length > 0 && (
              <div className="pm-carryover-block">
                <div className="pm-carryover-header">
                  <Pin size={13} />
                  <span>Carry-over from yesterday's plan</span>
                  <span className="pm-carryover-count">
                    {carryoverItems.filter(i => i.done).length}/{carryoverItems.length} done
                  </span>
                </div>
                <div className="pm-carryover-list">
                  {carryoverItems.map((item, idx) => (
                    <label
                      key={idx}
                      className={`pm-carryover-item ${item.done ? 'pm-carryover-item--done' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => handleCarryoverToggle(idx)}
                      />
                      <span>{item.text}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {report ? (
              <div className="pm-report-viewer">
                <div className="pm-report-meta">
                  <div className="pm-report-stat-chip done">
                    <span className="chip-num">{report.done_count}</span> Done
                  </div>
                  <div className="pm-report-stat-chip open">
                    <span className="chip-num">{report.open_count}</span> Open
                  </div>
                  <div className="pm-report-stat-chip blocked">
                    <span className="chip-num">{report.blocked_count}</span> Blocked
                  </div>
                  <span className="pm-report-date-label">
                    {new Date(report.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="pm-report-body">
                  {renderReportText(report.report_text)}
                </div>
              </div>
            ) : (
              <div className="pm-report-empty">
                <FileText size={40} />
                <p>Select a date and click <strong>Generate Report</strong> to create today's Slack-style PM report.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: History Sidebar */}
        <div className="pm-daily-sidebar glass-card">
          <div className="pm-sidebar-header">
            <h4>Report History</h4>
            <button className="pm-sidebar-refresh" onClick={fetchHistory} disabled={loadingHistory}>
              {loadingHistory ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          <div className="pm-history-list">
            {history.length === 0 && !loadingHistory && (
              <p className="pm-history-empty">No saved reports yet.</p>
            )}
            {history.map(r => (
              <div key={r.id} className={`pm-history-item ${report?.id === r.id ? 'active' : ''}`}>
                <button className="pm-history-item-btn" onClick={() => loadHistoricReport(r)}>
                  <div className="pm-history-date">{r.date}</div>
                  <div className="pm-history-counts">
                    <span className="hc done">{r.done_count} done</span>
                    <span className="hc blocked">{r.blocked_count} blocked</span>
                  </div>
                </button>
                <div className="pm-history-actions">
                  {confirmDeleteId === r.id ? (
                    <>
                      <button
                        className="pm-history-confirm-btn confirm-yes"
                        title="Confirm delete"
                        onClick={async (e) => {
                          e.stopPropagation()
                          await api.deletePMReport(r.id)
                          setHistory(prev => prev.filter(h => h.id !== r.id))
                          if (report?.id === r.id) setReport(null)
                          setConfirmDeleteId(null)
                        }}
                      >
                        <Check size={12} />
                      </button>
                      <button
                        className="pm-history-confirm-btn confirm-no"
                        title="Cancel"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}
                      >
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      className="pm-history-delete-btn"
                      title="Delete report"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(r.id) }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Assignee Stats ──────────────────────────────────────────────────────

function AssigneeStatsTab() {
  const [stats, setStats] = useState<AssigneeStat[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({})

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getAssigneeStats()
      setStats(res.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { getYouTrackAvatarMap().then(setAvatarMap) }, [])

  const maxTotal = Math.max(...stats.map(s => s.open + s.in_progress + s.done + s.blocked), 1)

  return (
    <div className="pm-tab-content pm-assignees-tab">
      <div className="pm-tab-header">
        <h3 className="pm-section-title"><TrendingUp size={18} /> Assignee Stats</h3>
        <button className="btn-secondary btn-sm" onClick={fetchStats} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {error && <div className="pm-report-error"><AlertTriangle size={16} />{error}</div>}

      {loading && stats.length === 0 ? (
        <div className="pm-loading-state"><Loader2 size={32} className="animate-spin" /><span>Loading stats...</span></div>
      ) : stats.length === 0 ? (
        <div className="pm-empty-state"><Users size={40} /><p>No assignee data yet. Stats populate from YouTrack webhook events.</p></div>
      ) : (
        <div className="pm-card-list glass-card">
          <div className="pm-list-summary">
            <span>{stats.length} assignees</span>
          </div>

          {/* Column headers */}
          <div className="pm-col-header">
            <span className="pm-col-as-name">Assignee</span>
            <span className="pm-col-as-stat">Open</span>
            <span className="pm-col-as-stat">In Progress</span>
            <span className="pm-col-as-stat">Done</span>
            <span className="pm-col-as-stat">Blocked</span>
            <span className="pm-col-as-avg">Avg Time</span>
            <span className="pm-col-as-workload">Workload</span>
            <span className="pm-col-chevron" />
          </div>

          <div className="pm-rows-scroll">
          {stats.map(s => {
            const total = s.open + s.in_progress + s.done + s.blocked
            const pct = Math.round((total / maxTotal) * 100)
            const isExpanded = expandedRow === s.assignee

            return (
              <div key={s.assignee} className={`pm-row ${isExpanded ? 'pm-row-expanded' : ''}`}>
                <div className="pm-row-main" onClick={() => setExpandedRow(isExpanded ? null : s.assignee)}>
                  {/* Assignee */}
                  <div className="pm-col-as-name tt-assignee">
                    {avatarMap[s.assignee]
                      ? <img src={avatarMap[s.assignee]} alt={s.assignee} className="filter-avatar-img" />
                      : <span className="filter-avatar-placeholder">{s.assignee.charAt(0).toUpperCase()}</span>
                    }
                    <span className="tt-assignee-name">{s.assignee}</span>
                  </div>

                  {/* Stat badges */}
                  <span className="pm-col-as-stat">
                    <span className={`tt-badge ${s.open > 0 ? 'tt-badge-open' : 'tt-badge-zero'}`}>{s.open}</span>
                  </span>
                  <span className="pm-col-as-stat">
                    <span className={`tt-badge ${s.in_progress > 0 ? 'tt-badge-live' : 'tt-badge-zero'}`}>{s.in_progress}</span>
                  </span>
                  <span className="pm-col-as-stat">
                    <span className={`tt-badge ${s.done > 0 ? 'tt-badge-done' : 'tt-badge-zero'}`}>{s.done}</span>
                  </span>
                  <span className="pm-col-as-stat">
                    <span className={`tt-badge ${s.blocked > 0 ? 'tt-badge-blocked' : 'tt-badge-zero'}`}>{s.blocked}</span>
                  </span>

                  {/* Avg time */}
                  <span className="pm-col-as-avg tt-time-label">{formatHours(s.avg_hours_in_progress)}</span>

                  {/* Workload bar */}
                  <div className="pm-col-as-workload workload-cell">
                    <div className="tt-time-bar">
                      <div className="tt-time-bar-fill" style={{ width: `${pct}%`, background: '#6366f1' }} />
                    </div>
                    <span className="tt-threshold">{total}</span>
                  </div>

                  <ChevronDown size={13} className={`tt-chevron ${isExpanded ? 'open' : ''}`} />
                </div>

                {/* Expanded: open issues */}
                {isExpanded && s.issues && s.issues.length > 0 && (
                  <div className="tt-row-detail">
                    <div className="pm-issue-tags">
                      <span className="tt-detail-label">Open Issues</span>
                      <div className="pm-issue-tags-list">
                        {s.issues.map((issue, idx) => (
                          <span key={idx} className="pm-issue-tag">{issue}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Time Tracking ───────────────────────────────────────────────────────

type SortKey = 'time_asc' | 'time_desc' | 'priority' | 'entered_at' | 'status'

function TimeTrackingTab({ blockerIssueIds }: { blockerIssueIds?: Set<string> }) {
  // Week navigation — defaults to current week
  const [selectedWeek, setSelectedWeek] = useState<Date>(() => getMondayOf(new Date()))
  const [noWeekFilter, setNoWeekFilter] = useState(false)

  const [rows, setRows] = useState<TimeTrackingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // YouTrack avatar map: fullName → avatarUrl
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({})

  // Filters (client-side)
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [filterMismatch, setFilterMismatch] = useState(false)
  const [filterMovedBack, setFilterMovedBack] = useState(false)
  const [filterLive, setFilterLive] = useState(false)
  const [filterDelayed, setFilterDelayed] = useState(false)
  const [filterPinned, setFilterPinned] = useState(false)
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterPriorities, setFilterPriorities] = useState<string[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('entered_at')
  const [searchIssue, setSearchIssue] = useState('')

  // Custom dropdown open states
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false)
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)
  const assigneeDropdownRef = useRef<HTMLDivElement>(null)
  const sortDropdownRef = useRef<HTMLDivElement>(null)

  // Actions
  const [resetting, setResetting] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [importing, setImporting] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [togglingPin, setTogglingPin] = useState<string | null>(null)

  const fetchRows = useCallback(async (week: Date, skipWeek: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const params: { week?: string } = {}
      if (!skipWeek) params.week = toISODate(week)
      const res = await api.getTimeTracking(params)
      setRows(res.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load time tracking')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRows(selectedWeek, noWeekFilter) }, [fetchRows, selectedWeek, noWeekFilter])

  // Load YouTrack avatars once
  useEffect(() => { getYouTrackAvatarMap().then(setAvatarMap) }, [])

  // Close custom dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(e.target as Node)) {
        setAssigneeDropdownOpen(false)
      }
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const changeWeek = (delta: number) => {
    setSelectedWeek(w => {
      const next = new Date(w)
      next.setDate(next.getDate() + delta * 7)
      return next
    })
    setNoWeekFilter(false)
  }

  const goThisWeek = () => {
    setSelectedWeek(getMondayOf(new Date()))
    setNoWeekFilter(false)
  }

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const togglePin = async (row: TimeTrackingRow) => {
    setTogglingPin(row.issue_id)
    try {
      if (row.pinned) {
        await api.unpinIssue(row.issue_id)
      } else {
        await api.pinIssue(row.issue_id)
      }
      await fetchRows(selectedWeek, noWeekFilter)
    } catch {
      // silently ignore
    } finally {
      setTogglingPin(null)
    }
  }

  const runReset = async () => {
    if (!resetConfirm) {
      setResetConfirm(true)
      setTimeout(() => setResetConfirm(false), 5000)
      return
    }
    setResetConfirm(false)
    setResetting(true)
    setBackfillMsg(null)
    try {
      const res = await api.resetStateLog()
      setBackfillMsg(`State log cleared: ${res.data?.deleted ?? 0} rows deleted.`)
      setRows([])
    } catch (err) {
      setBackfillMsg(`Reset failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setResetting(false)
    }
  }

  const runReconcile = async () => {
    setReconciling(true)
    setBackfillMsg(null)
    try {
      const res = await api.reconcileStateLog()
      const d = res.data
      setBackfillMsg(`Reconcile: ${d?.reconciled ?? 0} exit rows inserted, ${d?.skipped ?? 0} up-to-date.`)
      fetchRows(selectedWeek, noWeekFilter)
    } catch (err) {
      setBackfillMsg(`Reconcile failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setReconciling(false)
    }
  }

  const runImportHistory = async () => {
    setImporting(true)
    setBackfillMsg(null)
    try {
      const res = await api.importHistory()
      const d = res.data
      setBackfillMsg(`Sync done: ${d?.inserted ?? 0} transitions inserted. ${d?.skipped ?? 0} already existed.`)
      fetchRows(selectedWeek, noWeekFilter)
    } catch (err) {
      setBackfillMsg(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setImporting(false)
    }
  }

  // Derive unique assignees for dropdown
  const allAssignees = Array.from(new Set(rows.map(r => r.assignee).filter(Boolean))).sort()

  // Client-side filtering
  let displayed = rows
  if (filterOverdue)   displayed = displayed.filter(r => r.overdue)
  if (filterMismatch)  displayed = displayed.filter(r => r.moved_by_mismatch)
  if (filterMovedBack) displayed = displayed.filter(r => isMovedBack(r.from_state, r.to_state))
  // Live = currently in progress (no exit yet: duration is null)
  if (filterLive)    displayed = displayed.filter(r => r.duration_in_prev_state_hours === null)
  // Delayed = time spent exceeds threshold
  if (filterDelayed) displayed = displayed.filter(r =>
    r.duration_in_prev_state_hours !== null && r.duration_in_prev_state_hours > r.threshold_hours
  )
  if (filterPinned)  displayed = displayed.filter(r => r.pinned)
  if (filterAssignee) displayed = displayed.filter(r => r.assignee.toLowerCase() === filterAssignee.toLowerCase())
  if (filterPriorities.length > 0) displayed = displayed.filter(r => filterPriorities.includes(r.priority))
  if (searchIssue) {
    const q = searchIssue.toLowerCase()
    displayed = displayed.filter(r => r.issue_id.toLowerCase().includes(q) || r.issue_summary.toLowerCase().includes(q))
  }

  // Sort
  displayed = [...displayed].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1 // pinned always first
    switch (sortKey) {
      case 'time_asc': return (a.duration_in_prev_state_hours ?? 0) - (b.duration_in_prev_state_hours ?? 0)
      case 'time_desc': return (b.duration_in_prev_state_hours ?? 0) - (a.duration_in_prev_state_hours ?? 0)
      case 'priority': {
        const ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, Other: 4 }
        return (ORDER[a.priority] ?? 4) - (ORDER[b.priority] ?? 4)
      }
      case 'status': {
        const statusOrder = (r: TimeTrackingRow) => {
          if (r.overdue) return 0
          if (r.duration_in_prev_state_hours === null) return 1  // live
          if (isMovedBack(r.from_state, r.to_state)) return 2
          return 3
        }
        return statusOrder(a) - statusOrder(b)
      }
      default: return new Date(b.transitioned_at).getTime() - new Date(a.transitioned_at).getTime()
    }
  })

  // Group by issue_id — pick the most critical row as the representative
  const groupedIssues: { rep: TimeTrackingRow; all: TimeTrackingRow[] }[] = []
  const seenIssues = new Map<string, number>()
  for (const row of displayed) {
    const idx = seenIssues.get(row.issue_id)
    if (idx === undefined) {
      seenIssues.set(row.issue_id, groupedIssues.length)
      groupedIssues.push({ rep: row, all: [row] })
    } else {
      groupedIssues[idx].all.push(row)
      // promote rep if this row is more critical
      const cur = groupedIssues[idx].rep
      const curScore = cur.overdue ? 0 : cur.duration_in_prev_state_hours === null ? 1 : isMovedBack(cur.from_state, cur.to_state) ? 2 : 3
      const newScore = row.overdue ? 0 : row.duration_in_prev_state_hours === null ? 1 : isMovedBack(row.from_state, row.to_state) ? 2 : 3
      if (newScore < curScore) groupedIssues[idx].rep = row
    }
  }

  const overdueCount   = rows.filter(r => r.overdue).length
  const mismatchCount  = rows.filter(r => r.moved_by_mismatch).length
  const movedBackCount = rows.filter(r => isMovedBack(r.from_state, r.to_state)).length
  const pinnedCount    = rows.filter(r => r.pinned).length
  const liveCount      = rows.filter(r => r.duration_in_prev_state_hours === null).length
  const delayedCount   = rows.filter(r => r.duration_in_prev_state_hours !== null && r.duration_in_prev_state_hours > r.threshold_hours).length
  const ttActiveFilterCount = [filterOverdue, filterMismatch, filterMovedBack, filterLive, filterDelayed,
    filterPinned, filterAssignee !== '', filterPriorities.length > 0].filter(Boolean).length

  return (
    <div className="pm-tab-content pm-tracking-tab">
      {/* Header */}
      <div className="pm-tab-header">
        <h3 className="pm-section-title"><Clock size={18} /> Time Tracking</h3>
        <div className="pm-tracking-controls">
          <button
            className={`btn-sm ${resetConfirm ? 'btn-danger-active' : 'btn-secondary'}`}
            onClick={runReset}
            disabled={resetting || importing || loading}
            title={resetConfirm ? 'Click again to confirm' : 'Clear all rows'}
          >
            {resetting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
            {resetting ? 'Clearing…' : resetConfirm ? 'Confirm?' : 'Clear'}
          </button>
          <button className="btn-secondary btn-sm" onClick={runReconcile} disabled={reconciling || importing || loading}
            title="Reconcile: close any In Progress entries whose ticket has since moved">
            {reconciling ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {reconciling ? 'Reconciling…' : 'Reconcile'}
          </button>
          <button className="btn-primary btn-sm" onClick={runImportHistory} disabled={importing || resetting || loading}>
            {importing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {importing ? 'Syncing…' : 'Sync History'}
          </button>
          <button className="btn-secondary btn-sm" onClick={() => fetchRows(selectedWeek, noWeekFilter)} disabled={loading || importing}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>

      {error && <div className="pm-report-error"><AlertTriangle size={16} />{error}</div>}
      {backfillMsg && (
        <div className={`pm-backfill-msg ${backfillMsg.includes('failed') ? 'error' : 'success'}`}>
          {backfillMsg}
        </div>
      )}

      {/* Week Navigator */}
      <div className="pm-week-nav glass-card">
        <button className="btn-icon" onClick={() => changeWeek(-1)} title="Previous week">
          <ChevronLeft size={16} />
        </button>
        <div className="week-label">
          {noWeekFilter ? (
            <span className="week-all">All Time</span>
          ) : (
            <>
              <Calendar size={14} />
              <span>{formatWeekRange(selectedWeek)}</span>
            </>
          )}
        </div>
        <button className="btn-icon" onClick={() => changeWeek(1)} title="Next week">
          <ChevronRight size={16} />
        </button>
        <button
          className={`btn-sm ${noWeekFilter ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setNoWeekFilter(f => !f)}
          title="Toggle between weekly view and all-time view"
        >
          {noWeekFilter ? 'By Week' : 'All Time'}
        </button>
        <button className="btn-sm btn-secondary" onClick={goThisWeek} disabled={noWeekFilter}>
          This Week
        </button>
        {pinnedCount > 0 && (
          <span className="pinned-count-badge"><Pin size={12} /> {pinnedCount} pinned</span>
        )}
      </div>

      {/* Filter Bar */}
      <div className="pm-filter-bar">
        {/* Search */}
        <div className="pm-search-box">
          <Search size={13} />
          <input
            type="text"
            placeholder="Search issue…"
            value={searchIssue}
            onChange={e => setSearchIssue(e.target.value)}
          />
        </div>

        {/* Assignee custom dropdown with avatars */}
        <div className="pm-custom-dropdown" ref={assigneeDropdownRef}>
          <button
            className="pm-custom-dropdown-trigger"
            onClick={() => setAssigneeDropdownOpen(o => !o)}
          >
            {filterAssignee ? (
              <>
                {avatarMap[filterAssignee] ? (
                  <img src={avatarMap[filterAssignee]} alt={filterAssignee} className="filter-avatar-img" />
                ) : (
                  <span className="filter-avatar-placeholder">{filterAssignee.charAt(0).toUpperCase()}</span>
                )}
                <span className="filter-assignee-name">{filterAssignee.split(' ')[0]}</span>
              </>
            ) : (
              <>
                <Users size={14} />
                <span>All Assignees</span>
              </>
            )}
            <ChevronDown size={12} className={`dropdown-chevron ${assigneeDropdownOpen ? 'open' : ''}`} />
          </button>
          {assigneeDropdownOpen && (
            <div className="pm-custom-dropdown-menu">
              <button
                className={`pm-dropdown-item ${!filterAssignee ? 'active' : ''}`}
                onClick={() => { setFilterAssignee(''); setAssigneeDropdownOpen(false) }}
              >
                <Users size={14} />
                <span>All Assignees</span>
              </button>
              {allAssignees.map(a => (
                <button
                  key={a}
                  className={`pm-dropdown-item ${filterAssignee === a ? 'active' : ''}`}
                  onClick={() => { setFilterAssignee(a); setAssigneeDropdownOpen(false) }}
                >
                  {avatarMap[a] ? (
                    <img src={avatarMap[a]} alt={a} className="filter-avatar-img" />
                  ) : (
                    <span className="filter-avatar-placeholder">{a.charAt(0).toUpperCase()}</span>
                  )}
                  <span>{a}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority chips */}
        <div className="pm-priority-chips">
          {['P0', 'P1', 'P2', 'P3'].map(p => (
            <button
              key={p}
              className={`priority-chip ${filterPriorities.includes(p) ? 'active' : ''} ${priorityBadgeClass(p)}`}
              onClick={() => setFilterPriorities(prev =>
                prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
              )}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Sort custom dropdown with icons */}
        <div className="pm-custom-dropdown" ref={sortDropdownRef}>
          <button
            className="pm-custom-dropdown-trigger"
            onClick={() => setSortDropdownOpen(o => !o)}
          >
            {sortKey === 'entered_at' && <><ArrowDownUp size={14} /><span>Newest First</span></>}
            {sortKey === 'time_asc' && <><ArrowUpNarrowWide size={14} /><span>Time ↑</span></>}
            {sortKey === 'time_desc' && <><ArrowDownNarrowWide size={14} /><span>Time ↓</span></>}
            {sortKey === 'priority' && <><Star size={14} /><span>Priority</span></>}
            {sortKey === 'status' && <><Activity size={14} /><span>Status</span></>}
            <ChevronDown size={12} className={`dropdown-chevron ${sortDropdownOpen ? 'open' : ''}`} />
          </button>
          {sortDropdownOpen && (
            <div className="pm-custom-dropdown-menu">
              {([
                { key: 'entered_at', label: 'Newest First', Icon: ArrowDownUp },
                { key: 'status',     label: 'Status (Overdue→Live→Done)', Icon: Activity },
                { key: 'time_asc',   label: 'Time ↑ (low→high)', Icon: ArrowUpNarrowWide },
                { key: 'time_desc',  label: 'Time ↓ (high→low)', Icon: ArrowDownNarrowWide },
                { key: 'priority',   label: 'Priority', Icon: Star },
              ] as { key: SortKey; label: string; Icon: React.ElementType }[]).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  className={`pm-dropdown-item ${sortKey === key ? 'active' : ''}`}
                  onClick={() => { setSortKey(key); setSortDropdownOpen(false) }}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Toggle filters */}
        <div className="pm-toggle-filters">
          {liveCount > 0 && (
            <button
              className={`btn-sm ${filterLive ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterLive(f => !f)}
            >
              <Timer size={13} /> Live ({liveCount})
            </button>
          )}
          {delayedCount > 0 && (
            <button
              className={`btn-sm ${filterDelayed ? 'btn-danger-active' : 'btn-secondary'}`}
              onClick={() => setFilterDelayed(f => !f)}
            >
              <Zap size={13} /> Delayed ({delayedCount})
            </button>
          )}
          {overdueCount > 0 && (
            <button
              className={`btn-sm ${filterOverdue ? 'btn-danger-active' : 'btn-secondary'}`}
              onClick={() => setFilterOverdue(f => !f)}
            >
              <AlertTriangle size={13} /> Overdue ({overdueCount})
            </button>
          )}
          {mismatchCount > 0 && (
            <button
              className={`btn-sm ${filterMismatch ? 'btn-warning-active' : 'btn-secondary'}`}
              onClick={() => setFilterMismatch(f => !f)}
            >
              <AlertTriangle size={13} /> Mismatch ({mismatchCount})
            </button>
          )}
          {movedBackCount > 0 && (
            <button
              className={`btn-sm ${filterMovedBack ? 'btn-warning-active' : 'btn-secondary'}`}
              onClick={() => setFilterMovedBack(f => !f)}
            >
              <RotateCcw size={13} /> Moved Back ({movedBackCount})
            </button>
          )}
          {pinnedCount > 0 && (
            <button
              className={`btn-sm ${filterPinned ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterPinned(f => !f)}
            >
              <Pin size={13} /> Pinned ({pinnedCount})
            </button>
          )}
          {ttActiveFilterCount > 0 && (
            <button
              className="btn-sm btn-ghost tl-clear-filters"
              onClick={() => {
                setFilterOverdue(false); setFilterMismatch(false); setFilterMovedBack(false)
                setFilterLive(false); setFilterDelayed(false); setFilterPinned(false)
                setFilterAssignee(''); setFilterPriorities([]); setSearchIssue('')
              }}
            >
              <X size={12} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {loading && rows.length === 0 ? (
        <div className="pm-loading-state"><Loader2 size={32} className="animate-spin" /><span>Loading time tracking…</span></div>
      ) : rows.length === 0 ? (
        <div className="pm-empty-state">
          <Clock size={40} />
          <p>No time tracking data for this week.</p>
          <p style={{fontSize:'0.8rem'}}>Try <strong>All Time</strong> view or click <strong>Sync History</strong> to import from YouTrack.</p>
        </div>
      ) : (
        <div className="pm-card-list glass-card">
          <div className="pm-list-summary">
            <span>{groupedIssues.length} issues · {displayed.length} transitions</span>
            {overdueCount > 0 && <span className="overdue-summary-badge"><AlertTriangle size={12} /> {overdueCount} overdue</span>}
            {mismatchCount > 0 && <span className="mismatch-summary-badge"><AlertTriangle size={12} /> {mismatchCount} mismatch</span>}
            {movedBackCount > 0 && <span className="moved-back-summary-badge"><RotateCcw size={12} /> {movedBackCount} moved back</span>}
          </div>

          {/* Column headers */}
          <div className="pm-col-header">
            <span className="tt-col-pin" />
            <span className="tt-col-issue">Issue</span>
            <span className="tt-col-regression">Regression</span>
            <span className="tt-col-priority">Priority</span>
            <span className="tt-col-status">Status</span>
            <span className="tt-col-time">Time / Threshold</span>
            <span className="tt-col-assignee">Assignee</span>
            <span className="tt-col-chevron" />
          </div>

          <div className="pm-rows-scroll">
          {groupedIssues.map(({ rep: row, all: transitions }) => {
            const isLive = row.to_state.toLowerCase() === 'in progress'
            const isBlocked = row.to_state.toLowerCase() === 'blocked'
            const movedBack = isMovedBack(row.from_state, row.to_state)
            const isExpanded = expandedRows.has(row.issue_id)
            const isDone = ['dev', 'done', 'mobile done', 'stage', 'prod'].includes(row.to_state.toLowerCase())
            const showOverdue = row.overdue && !isDone && !isBlocked
            const hasRegression = transitions.some(t => isMovedBack(t.from_state, t.to_state))
            const ratio = row.duration_in_prev_state_hours != null && row.threshold_hours > 0
              ? Math.min(row.duration_in_prev_state_hours / row.threshold_hours, 1)
              : 0
            const barColor = row.overdue ? '#ef4444' : isLive ? '#22c55e' : '#6366f1'

            return (
              <div
                key={row.issue_id}
                className={['pm-row', showOverdue ? 'pm-row-overdue' : '', row.pinned ? 'pm-row-pinned' : '', movedBack ? 'pm-row-movedback' : ''].filter(Boolean).join(' ')}
              >
                {/* Collapsed row — click anywhere to expand */}
                <div className="pm-row-main" onClick={() => toggleRow(row.issue_id)}>
                  {/* Pin button */}
                  <button
                    className={`tt-pin-btn ${row.pinned ? 'pinned' : ''}`}
                    onClick={e => { e.stopPropagation(); togglePin(row) }}
                    disabled={togglingPin === row.issue_id}
                    title={row.pinned ? 'Unpin' : 'Pin (show every week)'}
                  >
                    {togglingPin === row.issue_id
                      ? <Loader2 size={12} className="animate-spin" />
                      : row.pinned ? <Pin size={12} /> : <PinOff size={12} />
                    }
                  </button>

                  {/* Issue ID + summary */}
                  <div className="tt-issue">
                    {row.pinned && <Pin size={10} className="tt-pin-indicator" />}
                    <span className="tt-issue-id">{row.issue_id}</span>
                    <span className="tt-issue-summary">{row.issue_summary}</span>
                    {transitions.length > 1 && (
                      <span className="tt-transition-count" title={`${transitions.length} transitions`}>{transitions.length}</span>
                    )}
                    {blockerIssueIds?.has(row.issue_id) && (
                      <span className="do-overdue-chip">⚠ Blocked</span>
                    )}
                  </div>

                  {/* Regression indicator */}
                  <span className="tt-col-regression">
                    {hasRegression && (
                      <span className="tt-regression-chip" title="Regression — moved back to an earlier state">↩R</span>
                    )}
                  </span>

                  {/* Priority */}
                  <span className={`tt-priority ${priorityBadgeClass(row.priority)}`}>{row.priority || '—'}</span>

                  {/* Status badge */}
                  <span className="tt-col-status">
                    {isBlocked && (
                      <span className="tt-badge tt-badge-blocked">⊘ Blocked</span>
                    )}
                    {isLive && !showOverdue && !isBlocked && (
                      <span className="tt-badge tt-badge-live"><span className="live-dot-pulse" />Live</span>
                    )}
                    {showOverdue && (
                      <span className="tt-badge tt-badge-overdue"><AlertTriangle size={11} /> Overdue</span>
                    )}
                    {movedBack && !showOverdue && !isBlocked && (
                      <span className="tt-badge tt-badge-mb"><RotateCcw size={11} /> Back</span>
                    )}
                    {!isLive && !isBlocked && !showOverdue && !movedBack && (
                      <span className="tt-badge tt-badge-done">✓ Done</span>
                    )}
                  </span>

                  {/* Time bar + label */}
                  <div className="tt-time-bar-wrap">
                    <div className="tt-time-bar">
                      <div className="tt-time-bar-fill" style={{ width: `${ratio * 100}%`, background: barColor }} />
                    </div>
                    <span className="tt-time-label">
                      {formatHours(row.duration_in_prev_state_hours)}
                      <span className="tt-threshold"> / {row.threshold_hours}h</span>
                    </span>
                  </div>

                  {/* Assignee */}
                  <div className="tt-assignee">
                    {avatarMap[row.assignee]
                      ? <img src={avatarMap[row.assignee]} alt={row.assignee} className="filter-avatar-img" />
                      : <span className="filter-avatar-placeholder">{(row.assignee || '?').charAt(0).toUpperCase()}</span>
                    }
                    <span className="tt-assignee-name">{row.assignee ? row.assignee.split(' ')[0] : '—'}</span>
                  </div>

                  <ChevronDown size={13} className={`tt-chevron ${isExpanded ? 'open' : ''}`} />
                </div>

                {/* Expanded: all transitions for this issue */}
                {isExpanded && (
                  <div className="tt-row-detail">
                    {[...transitions].sort((a, b) => new Date(a.transitioned_at).getTime() - new Date(b.transitioned_at).getTime()).map((t, i) => {
                      const tMovedBack = isMovedBack(t.from_state, t.to_state)
                      const tIsLive = t.duration_in_prev_state_hours === null
                      const isMostRecent = i === transitions.length - 1
                      return (
                        <div key={t.id} className="tt-transition-row">
                          <span className="tt-tr-index">{i + 1}</span>
                          <span className="tt-tr-transition">
                            <span className="tt-from-state">{t.from_state || 'Backlog'}</span>
                            <span className={`tt-arrow ${tMovedBack ? 'tt-arrow-back' : ''}`}>→</span>
                            <span className={`tt-to-state${tIsLive && isMostRecent ? ' live' : ''}${tMovedBack ? ' tt-to-state-back' : ''}${isMostRecent && !tMovedBack ? ' tt-to-state-current' : ''}`}>
                              {t.to_state}{tIsLive && isMostRecent ? ' ●' : ''}
                            </span>
                            {tMovedBack && <span className="tt-regression-tag">regression</span>}
                          </span>
                          <span className="tt-tr-time">{formatHours(t.duration_in_prev_state_hours)}</span>
                          <span className="tt-tr-by">
                            {t.moved_by || '—'}
                            {t.moved_by_mismatch && <AlertTriangle size={10} className="tt-mismatch-icon" />}
                          </span>
                          <span className="tt-tr-at">
                            {new Date(t.transitioned_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                          </span>
                          {t.comment && !/^activity:[^\s]+$/.test(t.comment.trim()) && (
                            <span className="tt-tr-comment">{t.comment}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers for IssueTimelineTab ────────────────────────────────────────────

function formatHoursDetailed(h: number | null): string {
  if (h === null || h === undefined) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  const days = Math.floor(h / 24)
  const hrs = Math.floor(h % 24)
  const mins = Math.round((h % 1) * 60)
  if (days > 0 && hrs > 0) return `${days}d ${hrs}h`
  if (days > 0) return `${days}d`
  if (mins > 0 && hrs === 0) return `${mins}m`
  return `${hrs}h`
}

function stintStatusClass(stint: IssueStint): string {
  if (!stint.exited_at) return 'stint-live'
  if (stint.moved_back) return 'stint-moved-back'
  const toL = stint.exited_to.toLowerCase()
  if (['dev', 'done', 'mobile done', 'stage', 'prod'].includes(toL)) return 'stint-completed'
  return 'stint-other'
}

function stintLabel(stint: IssueStint): string {
  if (!stint.exited_at) return '● Live'
  if (stint.moved_back) return `↩ → ${stint.exited_to}`
  return `→ ${stint.exited_to}`
}

// ─── Tab: Issue Timeline ──────────────────────────────────────────────────────

function IssueTimelineTab({ blockerIssueIds }: { blockerIssueIds?: Set<string> }) {
  const [timelines, setTimelines] = useState<IssueTimeline[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterSearch, setFilterSearch] = useState('')
  const [filterLive, setFilterLive] = useState(false)
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [filterMovedBack, setFilterMovedBack] = useState(false)
  const [filterDelayed, setFilterDelayed] = useState(false)
  const [filterPinned, setFilterPinned] = useState(false)
  const [filterPriorities, setFilterPriorities] = useState<string[]>([])
  const [filterAssignee, setFilterAssignee] = useState('')
  const [tlAssigneeOpen, setTlAssigneeOpen] = useState(false)
  const tlAssigneeRef = useRef<HTMLDivElement>(null)
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set())
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({})
  const [dismissing, setDismissing] = useState<string | null>(null)

  const fetchTimelines = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getIssueTimelines()
      setTimelines(res.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timelines')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTimelines() }, [fetchTimelines])
  useEffect(() => { getYouTrackAvatarMap().then(setAvatarMap) }, [])

  // Auto-refresh timeline every 2 minutes so new state transitions appear without restart
  useEffect(() => {
    const id = setInterval(() => { fetchTimelines() }, 2 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchTimelines])

  const toggleExpand = (issueID: string) => {
    setExpandedIssues(prev => {
      const next = new Set(prev)
      if (next.has(issueID)) next.delete(issueID)
      else next.add(issueID)
      return next
    })
  }

  const handleDismiss = async (issueID: string) => {
    setDismissing(issueID)
    try {
      await api.dismissAlert(issueID)
      setTimelines(prev => prev.map(t =>
        t.issue_id === issueID ? { ...t, alert_dismissed: true } : t
      ))
    } finally {
      setDismissing(null)
    }
  }

  const handleUndismiss = async (issueID: string) => {
    setDismissing(issueID)
    try {
      await api.undismissAlert(issueID)
      setTimelines(prev => prev.map(t =>
        t.issue_id === issueID ? { ...t, alert_dismissed: false } : t
      ))
    } finally {
      setDismissing(null)
    }
  }

  // Close assignee dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (tlAssigneeRef.current && !tlAssigneeRef.current.contains(e.target as Node)) {
        setTlAssigneeOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  // Moved-back alerts: live tickets that were moved back and alert not dismissed
  const movedBackAlerts = timelines.filter(
    t => t.is_live && t.moved_back_count > 0 && !t.alert_dismissed
  )

  // Unique assignees for dropdown
  const tlAllAssignees = Array.from(new Set(timelines.map(t => t.assignee).filter(Boolean))).sort()

  // Filter tickets
  let displayed = timelines
  if (filterSearch) {
    const q = filterSearch.toLowerCase()
    displayed = displayed.filter(t =>
      t.issue_id.toLowerCase().includes(q) || t.issue_summary.toLowerCase().includes(q)
    )
  }
  if (filterLive)       displayed = displayed.filter(t => t.is_live)
  if (filterOverdue)    displayed = displayed.filter(t => t.is_overdue)
  if (filterMovedBack)  displayed = displayed.filter(t => t.moved_back_count > 0)
  if (filterDelayed)    displayed = displayed.filter(t => t.total_hours > t.threshold_hours)
  if (filterPinned)     displayed = displayed.filter(t => t.pinned)
  if (filterAssignee)   displayed = displayed.filter(t => t.assignee?.toLowerCase() === filterAssignee.toLowerCase())
  if (filterPriorities.length > 0) displayed = displayed.filter(t => filterPriorities.includes(t.priority))

  const liveCount      = timelines.filter(t => t.is_live).length
  const overdueCount   = timelines.filter(t => t.is_overdue).length
  const movedBackCount = timelines.filter(t => t.moved_back_count > 0).length
  const delayedCount   = timelines.filter(t => t.total_hours > t.threshold_hours).length
  const pinnedCount    = timelines.filter(t => t.pinned).length
  const activeFilterCount = [filterLive, filterOverdue, filterMovedBack, filterDelayed, filterPinned,
    filterAssignee !== '', filterPriorities.length > 0].filter(Boolean).length

  return (
    <div className="pm-tab-content pm-timeline-tab">
      {/* Header */}
      <div className="pm-tab-header">
        <h3 className="pm-section-title"><Activity size={18} /> Issue Timeline</h3>
        <button className="btn-secondary btn-sm" onClick={fetchTimelines} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {error && <div className="pm-report-error"><AlertTriangle size={16} />{error}</div>}

      {/* Moved-back alerts */}
      {movedBackAlerts.length > 0 && (
        <div className="tl-alert-section">
          <div className="tl-alert-header">
            <TriangleAlert size={16} />
            <span>{movedBackAlerts.length} ticket{movedBackAlerts.length > 1 ? 's' : ''} moved back and still In Progress</span>
          </div>
          {movedBackAlerts.map(t => (
            <div key={t.issue_id} className="tl-alert-card">
              <div className="tl-alert-card-body">
                <span className="tl-alert-issue-id">{t.issue_id}</span>
                <span className="tl-alert-summary">{t.issue_summary}</span>
                {t.assignee && (
                  <span className="tl-alert-assignee">
                    {avatarMap[t.assignee]
                      ? <img src={avatarMap[t.assignee]} alt={t.assignee} className="filter-avatar-img" />
                      : <span className="filter-avatar-placeholder">{t.assignee.charAt(0).toUpperCase()}</span>
                    }
                    {t.assignee.split(' ')[0]}
                  </span>
                )}
                <span className="tl-alert-meta">
                  Moved back {t.moved_back_count}× · {formatHoursDetailed(t.total_hours)} total
                  {t.stints.filter(s => s.moved_back).slice(-1).map(s => s.comment).filter(Boolean).map(c => (
                    <span key={c} className="tl-alert-reason"> · "{c}"</span>
                  ))}
                </span>
              </div>
              <div className="tl-alert-actions">
                <button
                  className="btn-sm btn-primary"
                  onClick={() => { toggleExpand(t.issue_id); setFilterSearch(''); setFilterLive(false) }}
                  title="See full timeline"
                >
                  View Timeline
                </button>
                <button
                  className="btn-sm btn-secondary"
                  onClick={() => handleDismiss(t.issue_id)}
                  disabled={dismissing === t.issue_id}
                  title="Dismiss this alert"
                >
                  {dismissing === t.issue_id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="pm-filter-bar tl-filter-bar">
        {/* Search */}
        <div className="pm-search-box">
          <Search size={13} />
          <input
            type="text"
            placeholder="Search issue…"
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
          />
        </div>

        {/* Assignee dropdown */}
        <div className="pm-custom-dropdown" ref={tlAssigneeRef}>
          <button
            className="pm-custom-dropdown-trigger"
            onClick={() => setTlAssigneeOpen(o => !o)}
          >
            {filterAssignee ? (
              <>
                {avatarMap[filterAssignee]
                  ? <img src={avatarMap[filterAssignee]} alt={filterAssignee} className="filter-avatar-img" />
                  : <span className="filter-avatar-placeholder">{filterAssignee.charAt(0).toUpperCase()}</span>
                }
                <span className="filter-assignee-name">{filterAssignee.split(' ')[0]}</span>
              </>
            ) : (
              <><Users size={14} /><span>All Assignees</span></>
            )}
            <ChevronDown size={12} className={`dropdown-chevron ${tlAssigneeOpen ? 'open' : ''}`} />
          </button>
          {tlAssigneeOpen && (
            <div className="pm-custom-dropdown-menu">
              <button
                className={`pm-dropdown-item ${!filterAssignee ? 'active' : ''}`}
                onClick={() => { setFilterAssignee(''); setTlAssigneeOpen(false) }}
              >
                <Users size={14} /><span>All Assignees</span>
              </button>
              {tlAllAssignees.map(a => (
                <button
                  key={a}
                  className={`pm-dropdown-item ${filterAssignee === a ? 'active' : ''}`}
                  onClick={() => { setFilterAssignee(a); setTlAssigneeOpen(false) }}
                >
                  {avatarMap[a]
                    ? <img src={avatarMap[a]} alt={a} className="filter-avatar-img" />
                    : <span className="filter-avatar-placeholder">{a.charAt(0).toUpperCase()}</span>
                  }
                  <span>{a}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority chips */}
        <div className="pm-priority-chips">
          {['P0', 'P1', 'P2', 'P3'].map(p => (
            <button
              key={p}
              className={`priority-chip ${filterPriorities.includes(p) ? 'active' : ''} ${priorityBadgeClass(p)}`}
              onClick={() => setFilterPriorities(prev =>
                prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
              )}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Status / state quick-filters */}
        <div className="pm-toggle-filters">
          <button
            className={`btn-sm ${filterLive ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterLive(f => !f)}
          >
            <Timer size={13} /> Live {liveCount > 0 && `(${liveCount})`}
          </button>
          {delayedCount > 0 && (
            <button
              className={`btn-sm ${filterDelayed ? 'btn-danger-active' : 'btn-secondary'}`}
              onClick={() => setFilterDelayed(f => !f)}
            >
              <Zap size={13} /> Delayed ({delayedCount})
            </button>
          )}
          {overdueCount > 0 && (
            <button
              className={`btn-sm ${filterOverdue ? 'btn-warning-active' : 'btn-secondary'}`}
              onClick={() => setFilterOverdue(f => !f)}
            >
              <AlertTriangle size={13} /> Overdue ({overdueCount})
            </button>
          )}
          {movedBackCount > 0 && (
            <button
              className={`btn-sm ${filterMovedBack ? 'btn-warning-active' : 'btn-secondary'}`}
              onClick={() => setFilterMovedBack(f => !f)}
            >
              <RotateCcw size={13} /> Moved Back ({movedBackCount})
            </button>
          )}
          {pinnedCount > 0 && (
            <button
              className={`btn-sm ${filterPinned ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterPinned(f => !f)}
            >
              <Pin size={13} /> Pinned ({pinnedCount})
            </button>
          )}
          {activeFilterCount > 0 && (
            <button
              className="btn-sm btn-ghost tl-clear-filters"
              onClick={() => {
                setFilterLive(false); setFilterOverdue(false); setFilterMovedBack(false)
                setFilterDelayed(false); setFilterPinned(false); setFilterAssignee('')
                setFilterPriorities([]); setFilterSearch('')
              }}
            >
              <X size={12} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <div className="tl-summary-bar">
        <span>{displayed.length} of {timelines.length} issues</span>
      </div>

      {/* Issue list */}
      {loading && timelines.length === 0 ? (
        <div className="pm-loading-state"><Loader2 size={32} className="animate-spin" /><span>Loading timelines…</span></div>
      ) : displayed.length === 0 ? (
        <div className="pm-empty-state"><Activity size={40} /><p>No issues found.</p></div>
      ) : (
        <div className="pm-card-list glass-card">
          {/* Summary */}
          <div className="pm-list-summary">
            <span>{displayed.length} of {timelines.length} issues</span>
            {overdueCount > 0 && <span className="overdue-summary-badge"><AlertTriangle size={12} /> {overdueCount} overdue</span>}
            {movedBackCount > 0 && <span className="moved-back-summary-badge"><RotateCcw size={12} /> {movedBackCount} moved back</span>}
          </div>

          {/* Column headers */}
          <div className="pm-col-header">
            <span className="pm-col-pin" />
            <span className="pm-col-issue">Issue</span>
            <span className="pm-col-priority">Priority</span>
            <span className="pm-col-status">Status</span>
            <span className="pm-col-time">Time / Threshold</span>
            <span className="pm-col-stints">Stints</span>
            <span className="pm-col-assignee">Assignee</span>
            <span className="pm-col-chevron" />
          </div>

          <div className="pm-rows-scroll">
          {displayed.map(t => {
            const isExpanded = expandedIssues.has(t.issue_id)
            const lastMovedBackStint = [...t.stints].reverse().find(s => s.moved_back)
            const ratio = t.threshold_hours > 0 ? Math.min(t.total_hours / t.threshold_hours, 1) : 0
            const barColor = t.is_overdue ? '#ef4444' : t.total_hours > t.threshold_hours ? '#f97316' : t.is_live ? '#22c55e' : '#6366f1'

            return (
              <div
                key={t.issue_id}
                className={['pm-row', t.is_overdue ? 'pm-row-overdue' : '', t.is_live ? 'pm-row-live' : '', t.pinned ? 'pm-row-pinned' : ''].filter(Boolean).join(' ')}
              >
                <div className="pm-row-main" onClick={() => toggleExpand(t.issue_id)}>
                  {/* Pin placeholder */}
                  <span className="pm-col-pin">
                    {t.pinned && <Pin size={10} className="tt-pin-indicator" />}
                  </span>

                  {/* Issue ID + summary */}
                  <div className="pm-col-issue pm-issue-cell">
                    <span className="pm-issue-id">{t.issue_id}</span>
                    <span className="pm-issue-summary">{t.issue_summary}</span>
                    {t.moved_back_count > 0 && (
                      <span className="tt-regression-chip" title={`Moved back ${t.moved_back_count}× `}>↩{t.moved_back_count}</span>
                    )}
                    {blockerIssueIds?.has(t.issue_id) && (
                      <span className="do-overdue-chip">⚠ Blocked</span>
                    )}
                  </div>

                  {/* Priority */}
                  <span className={`pm-col-priority tt-priority ${priorityBadgeClass(t.priority)}`}>{t.priority || '—'}</span>

                  {/* Status */}
                  <span className="pm-col-status">
                    {t.is_live && !t.is_overdue && <span className="tt-badge tt-badge-live"><span className="live-dot-pulse" />Live</span>}
                    {t.is_overdue && <span className="tt-badge tt-badge-overdue"><AlertTriangle size={11} /> Overdue</span>}
                    {!t.is_live && !t.is_overdue && <span className="tt-badge tt-badge-done">✓ Done</span>}
                  </span>

                  {/* Time bar */}
                  <div className="pm-col-time tt-time-bar-wrap">
                    <div className="tt-time-bar">
                      <div className="tt-time-bar-fill" style={{ width: `${ratio * 100}%`, background: barColor }} />
                    </div>
                    <span className="tt-time-label">
                      {formatHoursDetailed(t.total_hours)}
                      <span className="tt-threshold"> / {t.threshold_hours}h</span>
                    </span>
                  </div>

                  {/* Stints */}
                  <span className="pm-col-stints">
                    {t.total_stints > 1 && <span className="tt-transition-count" title={`${t.total_stints} stints`}>{t.total_stints}</span>}
                  </span>

                  {/* Assignee */}
                  <div className="pm-col-assignee tt-assignee">
                    {t.assignee && (avatarMap[t.assignee]
                      ? <img src={avatarMap[t.assignee]} alt={t.assignee} className="filter-avatar-img" />
                      : <span className="filter-avatar-placeholder">{t.assignee.charAt(0).toUpperCase()}</span>
                    )}
                    <span className="tt-assignee-name">{t.assignee ? t.assignee.split(' ')[0] : '—'}</span>
                  </div>

                  <ChevronDown size={13} className={`tt-chevron ${isExpanded ? 'open' : ''}`} />
                </div>

                {/* Expanded: stint timeline */}
                {isExpanded && (
                  <div className="tt-row-detail">
                    {t.stints.map(stint => (
                      <div key={stint.stint_number} className={`tl-stint ${stintStatusClass(stint)}`}>
                        <div className="tl-stint-marker">
                          {!stint.exited_at
                            ? <span className="stint-dot live-dot-pulse" />
                            : stint.moved_back ? <RotateCcw size={12} /> : <CheckCircle2 size={12} />
                          }
                          {stint.stint_number < t.total_stints && <div className="tl-stint-line" />}
                        </div>
                        <div className="tl-stint-body">
                          <div className="tl-stint-header">
                            <span className="tl-stint-num">#{stint.stint_number}</span>
                            <span className={`tl-stint-label ${stintStatusClass(stint)}`}>{stintLabel(stint)}</span>
                            <span className="tl-stint-duration">{formatHoursDetailed(stint.duration_hours)}</span>
                          </div>
                          <div className="tl-stint-dates">
                            <span>
                              {new Date(stint.entered_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              {stint.exited_at && <> → {new Date(stint.exited_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</>}
                            </span>
                            {stint.moved_by && <span className="tl-stint-movedby">by {stint.moved_by}</span>}
                          </div>
                          {stint.comment && <div className="tl-stint-comment">"{stint.comment}"</div>}
                        </div>
                      </div>
                    ))}
                    <div className="tl-stint-summary">
                      <span>Total: <strong>{formatHoursDetailed(t.total_hours)}</strong></span>
                      <span>Threshold: <strong>{t.threshold_hours}h</strong></span>
                      {lastMovedBackStint && (
                        <span className="tl-last-reason">Last moved back: {lastMovedBackStint.comment || `→ ${lastMovedBackStint.exited_to}`}</span>
                      )}
                      {t.alert_dismissed && t.moved_back_count > 0 && (
                        <button className="tl-undismiss-btn" onClick={e => { e.stopPropagation(); handleUndismiss(t.issue_id) }} title="Restore alert">
                          {dismissing === t.issue_id ? <Loader2 size={10} className="animate-spin" /> : '↺ Restore alert'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

interface PMReportsPageProps {
  initialTab?: TabId
  onTabChange?: (tab: TabId) => void
}

export function PMReportsPage({ initialTab = 'tracking', onTabChange }: PMReportsPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const [blockerIssueIds, setBlockerIssueIds] = useState<Set<string>>(new Set())

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab)
    onTabChange?.(tab)
  }

  // Sync if parent changes initialTab (e.g. URL navigated directly)
  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  return (
    <div className="pm-reports-page">
      <div className="pm-reports-container">
        {/* Tab Bar */}
        <div className="pm-tab-bar glass-card">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                className={`pm-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => handleTabChange(tab.id)}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className={`pm-tab-panel glass-card${activeTab === 'daily' ? ' pm-tab-panel--daily' : ''}`}>
          {activeTab === 'daily' && <DailyReportTab />}
          {activeTab === 'assignees' && <AssigneeStatsTab />}
          {activeTab === 'tracking' && <TimeTrackingTab blockerIssueIds={blockerIssueIds} />}
          {activeTab === 'timeline' && <IssueTimelineTab blockerIssueIds={blockerIssueIds} />}
          {activeTab === 'dailyops' && <DailyOpsTab onBlockersChange={setBlockerIssueIds} />}
        </div>
      </div>
    </div>
  )
}
