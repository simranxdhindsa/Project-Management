import { useState, useRef, useEffect, useCallback } from 'react'
import {
  MessageSquare, Send, User, Bot, Loader2,
  FileText, Users, Clock, Copy, Check,
  RefreshCw, ChevronDown, AlertTriangle, TrendingUp,
  Calendar,
} from 'lucide-react'
import api from '../services/api'

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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'tracking', label: 'Time Tracking', icon: Clock },
  { id: 'daily', label: 'Daily Report', icon: FileText },
  { id: 'assignees', label: 'Assignee Stats', icon: Users },
  { id: 'assistant', label: 'PM Assistant', icon: MessageSquare },
] as const

type TabId = typeof TABS[number]['id']

const SUGGESTED_QUERIES = [
  'Give me open issues',
  'P1-P3 issues by status',
  'Report by assignees',
  'Blocked tickets',
  'Issues in DEV',
  'Summary of all tickets',
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

function PMAssistantTab() {
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
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const response = await api.pmAssistantQuery(text)
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

  return (
    <div className="pm-tab-content pm-assistant-tab">
      <div className="pm-chat-messages">
        {messages.length === 0 && (
          <div className="pm-chat-empty">
            <MessageSquare size={48} />
            <h3>PM Assistant</h3>
            <p>Ask questions about your YouTrack issues using natural language.</p>
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
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="pm-chat-message pm-chat-assistant">
            <div className="pm-chat-avatar"><Bot size={16} /></div>
            <div className="pm-chat-bubble pm-chat-loading">
              <Loader2 size={16} className="animate-spin" />
              <span>Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="pm-chat-input-bar">
        {messages.length > 0 && (
          <div className="pm-suggested-queries pm-suggested-inline">
            {SUGGESTED_QUERIES.slice(0, 3).map(q => (
              <button key={q} className="pm-suggested-chip pm-suggested-sm" onClick={() => handleSend(q)} disabled={loading}>{q}</button>
            ))}
          </div>
        )}
        <div className="pm-chat-input-row">
          <input
            ref={inputRef}
            type="text"
            className="pm-chat-input"
            placeholder="Ask about your issues..."
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

function DailyReportTab() {
  const [date, setDate] = useState(todayStr())
  const [report, setReport] = useState<PMReport | null>(null)
  const [history, setHistory] = useState<PMReport[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
              <Calendar size={16} />
              <input
                type="date"
                className="pm-date-input"
                value={date}
                max={todayStr()}
                onChange={e => { setDate(e.target.value); setReport(null) }}
              />
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

          {error && (
            <div className="pm-report-error">
              <AlertTriangle size={16} />
              {error}
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
              <button
                key={r.id}
                className={`pm-history-item ${report?.id === r.id ? 'active' : ''}`}
                onClick={() => loadHistoricReport(r)}
              >
                <div className="pm-history-date">{r.date}</div>
                <div className="pm-history-counts">
                  <span className="hc done">{r.done_count} done</span>
                  <span className="hc blocked">{r.blocked_count} blocked</span>
                </div>
              </button>
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
        <div className="pm-assignees-table-wrap glass-card">
          <table className="pm-assignees-table">
            <thead>
              <tr>
                <th>Assignee</th>
                <th className="num-col">Open</th>
                <th className="num-col">In Progress</th>
                <th className="num-col">Done</th>
                <th className="num-col">Blocked</th>
                <th className="num-col">Avg Time in Progress</th>
                <th>Workload</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => {
                const total = s.open + s.in_progress + s.done + s.blocked
                const pct = Math.round((total / maxTotal) * 100)
                const isExpanded = expandedRow === s.assignee

                return (
                  <>
                    <tr key={s.assignee} className={`pm-assignee-row ${isExpanded ? 'expanded' : ''}`}>
                      <td className="assignee-name-cell">
                        <div className="assignee-avatar">{s.assignee.charAt(0).toUpperCase()}</div>
                        {s.assignee}
                      </td>
                      <td className="num-col"><span className="stat-chip open">{s.open}</span></td>
                      <td className="num-col"><span className="stat-chip in-progress">{s.in_progress}</span></td>
                      <td className="num-col"><span className="stat-chip done">{s.done}</span></td>
                      <td className="num-col">
                        <span className={`stat-chip ${s.blocked > 0 ? 'blocked' : 'zero'}`}>{s.blocked}</span>
                      </td>
                      <td className="num-col avg-time">{formatHours(s.avg_hours_in_progress)}</td>
                      <td className="workload-cell">
                        <div className="workload-bar-bg">
                          <div className="workload-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="workload-label">{total}</span>
                      </td>
                      <td>
                        {s.issues && s.issues.length > 0 && (
                          <button
                            className="pm-expand-btn"
                            onClick={() => setExpandedRow(isExpanded ? null : s.assignee)}
                          >
                            <ChevronDown size={14} className={isExpanded ? 'rotated' : ''} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && s.issues && s.issues.length > 0 && (
                      <tr key={`${s.assignee}-expanded`} className="pm-assignee-issues-row">
                        <td colSpan={8}>
                          <div className="pm-assignee-issues">
                            <span className="issues-label">Open Issues:</span>
                            {s.issues.map((issue, idx) => (
                              <span key={idx} className="issue-tag">{issue}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Time Tracking ───────────────────────────────────────────────────────

function TimeTrackingTab() {
  const [rows, setRows] = useState<TimeTrackingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [filterMismatch, setFilterMismatch] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getTimeTracking()
      setRows(res.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load time tracking')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

  const runBackfill = async () => {
    setBackfilling(true)
    setBackfillMsg(null)
    try {
      const res = await api.backfillStateLog()
      const d = res.data
      setBackfillMsg(`Seeded ${d?.inserted ?? 0} entries from ${d?.total ?? 0} live tickets.`)
      fetchRows()
    } catch (err) {
      setBackfillMsg(`Backfill failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setBackfilling(false)
    }
  }

  const runReset = async () => {
    if (!resetConfirm) {
      setResetConfirm(true)
      // Auto-cancel confirm after 5s if user doesn't click again
      setTimeout(() => setResetConfirm(false), 5000)
      return
    }
    setResetConfirm(false)
    setResetting(true)
    setBackfillMsg(null)
    try {
      const res = await api.resetStateLog()
      const deleted = res.data?.deleted ?? 0
      setBackfillMsg(`State log cleared: ${deleted} rows deleted. Webhook events will repopulate it going forward.`)
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
      setBackfillMsg(`Reconcile complete: ${d?.reconciled ?? 0} exit rows inserted for tickets that moved without webhook. ${d?.skipped ?? 0} already up-to-date.`)
      fetchRows()
    } catch (err) {
      setBackfillMsg(`Reconcile failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setReconciling(false)
    }
  }

  let displayed = rows
  if (filterOverdue) displayed = displayed.filter(r => r.overdue)
  if (filterMismatch) displayed = displayed.filter(r => r.moved_by_mismatch)

  const overdueCount = rows.filter(r => r.overdue).length
  const mismatchCount = rows.filter(r => r.moved_by_mismatch).length

  return (
    <div className="pm-tab-content pm-tracking-tab">
      <div className="pm-tab-header">
        <h3 className="pm-section-title"><Clock size={18} /> Time Tracking</h3>
        <div className="pm-tracking-controls">
          {mismatchCount > 0 && (
            <button
              className={`btn-sm ${filterMismatch ? 'btn-warning-active' : 'btn-secondary'}`}
              onClick={() => setFilterMismatch(f => !f)}
            >
              <AlertTriangle size={14} />
              {filterMismatch ? 'Show All' : `Mismatch (${mismatchCount})`}
            </button>
          )}
          {overdueCount > 0 && (
            <button
              className={`btn-sm ${filterOverdue ? 'btn-danger-active' : 'btn-secondary'}`}
              onClick={() => setFilterOverdue(f => !f)}
            >
              <AlertTriangle size={14} />
              {filterOverdue ? 'Show All' : `Overdue (${overdueCount})`}
            </button>
          )}
          <button
            className={`btn-sm ${resetConfirm ? 'btn-danger-active' : 'btn-secondary'}`}
            onClick={runReset}
            disabled={resetting || loading}
            title={resetConfirm ? 'Click again to confirm — this deletes ALL state log rows' : 'Clear all state log rows (start fresh from webhooks)'}
          >
            {resetting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
            {resetting ? 'Clearing...' : resetConfirm ? 'Confirm Reset?' : 'Clear Log'}
          </button>
          <button className="btn-secondary btn-sm" onClick={runBackfill} disabled={backfilling || loading} title="Seed existing In Progress tickets into time tracking">
            {backfilling ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
            Backfill
          </button>
          <button className="btn-secondary btn-sm" onClick={runReconcile} disabled={reconciling || loading} title="Check tickets still marked In Progress against live YouTrack and insert missing exit rows">
            {reconciling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {reconciling ? 'Reconciling...' : 'Reconcile'}
          </button>
          <button className="btn-secondary btn-sm" onClick={fetchRows} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="pm-report-error"><AlertTriangle size={16} />{error}</div>}
      {backfillMsg && (
        <div className={`pm-backfill-msg ${backfillMsg.includes('failed') ? 'error' : 'success'}`}>
          {backfillMsg}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="pm-loading-state"><Loader2 size={32} className="animate-spin" /><span>Loading time tracking...</span></div>
      ) : rows.length === 0 ? (
        <div className="pm-empty-state">
          <Clock size={40} />
          <p>No time tracking data yet.</p>
          <p style={{fontSize:'0.8rem'}}>Click <strong>Backfill</strong> to seed current In Progress tickets, or wait for YouTrack webhooks to fire on state changes.</p>
        </div>
      ) : (
        <div className="pm-tracking-table-wrap glass-card">
          <div className="pm-tracking-summary">
            <span>{rows.length} transitions recorded</span>
            {overdueCount > 0 && <span className="overdue-summary-badge"><AlertTriangle size={12} /> {overdueCount} overdue</span>}
            {mismatchCount > 0 && <span className="mismatch-summary-badge"><AlertTriangle size={12} /> {mismatchCount} moved by non-assignee</span>}
          </div>
          <table className="pm-tracking-table">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Assignee</th>
                <th>Moved By</th>
                <th>Priority</th>
                <th>Transition</th>
                <th>Time in Progress</th>
                <th>Threshold</th>
                <th>Status</th>
                <th>Entered At</th>
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(row => {
                // A row with to_state='In Progress' and no exit yet = currently active
                const isCurrentlyInProgress = row.to_state.toLowerCase() === 'in progress'
                return (
                <tr key={row.id} className={`${row.overdue ? 'overdue-row' : ''} ${row.moved_by_mismatch ? 'mismatch-row' : ''}`}>
                  <td className="issue-cell">
                    <div className="issue-id">{row.issue_id}</div>
                    <div className="issue-summary">{row.issue_summary}</div>
                  </td>
                  <td>{row.assignee || '—'}</td>
                  <td>
                    {row.moved_by ? (
                      <span className={row.moved_by_mismatch ? 'moved-by-mismatch' : ''}>
                        {row.moved_by}
                        {row.moved_by_mismatch && <AlertTriangle size={12} style={{marginLeft: 4}} />}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    {row.priority ? (
                      <span className={priorityBadgeClass(row.priority)}>{row.priority}</span>
                    ) : '—'}
                  </td>
                  <td>
                    {isCurrentlyInProgress ? (
                      <span className="state-transition">
                        <span className="from-state">{row.from_state || 'Backlog'}</span>
                        <span className="arrow">→</span>
                        <span className="to-state in-progress-active">In Progress ●</span>
                      </span>
                    ) : (
                      <span className="state-transition">
                        <span className="from-state">In Progress</span>
                        <span className="arrow">→</span>
                        <span className="to-state">{row.to_state}</span>
                      </span>
                    )}
                  </td>
                  <td className={`duration-cell ${row.overdue ? 'overdue-duration' : ''}`}>
                    {isCurrentlyInProgress
                      ? <span className="live-elapsed">{formatHours(row.duration_in_prev_state_hours)} <span className="live-dot">live</span></span>
                      : formatHours(row.duration_in_prev_state_hours)
                    }
                  </td>
                  <td className="threshold-cell">{row.threshold_hours}h</td>
                  <td>
                    {isCurrentlyInProgress ? (
                      row.overdue
                        ? <span className="overdue-badge"><AlertTriangle size={12} /> Overdue</span>
                        : <span className="in-progress-badge">In Progress</span>
                    ) : (
                      row.overdue
                        ? <span className="overdue-badge"><AlertTriangle size={12} /> Overdue</span>
                        : <span className="on-time-badge">Done ✓</span>
                    )}
                  </td>
                  <td className="date-cell">
                    {new Date(row.transitioned_at).toLocaleString(undefined, {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                  <td className="comment-cell">
                    {row.comment
                      ? <span className="comment-text" title={row.comment}>
                          {row.comment.length > 40 ? row.comment.slice(0, 40) + '…' : row.comment}
                        </span>
                      : <span className="no-comment">—</span>
                    }
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PMReportsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('tracking')

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
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="pm-tab-panel glass-card">
          {activeTab === 'assistant' && <PMAssistantTab />}
          {activeTab === 'daily' && <DailyReportTab />}
          {activeTab === 'assignees' && <AssigneeStatsTab />}
          {activeTab === 'tracking' && <TimeTrackingTab />}
        </div>
      </div>
    </div>
  )
}
