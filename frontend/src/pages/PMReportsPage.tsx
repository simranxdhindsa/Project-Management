import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import DeploymentProjectBrowser from '../components/deployment/DeploymentProjectBrowser'
import DeploymentTicketInput from '../components/deployment/DeploymentTicketInput'
import DeploymentTicketList from '../components/deployment/DeploymentTicketList'
import DeploymentReportPreview from '../components/deployment/DeploymentReportPreview'
import DeploymentExportButtons from '../components/deployment/DeploymentExportButtons'
import DeploymentBotConfigPanel from '../components/deployment/DeploymentBotConfig'
import type { LoadedDeploymentTicket } from '../components/deployment/DeploymentProjectBrowser'
import type { TicketLine } from '../components/deployment/DeploymentTicketInput'
import type { DeploymentTicket, Platform } from '../components/deployment/types'
import { extractPriority, detectPlatform, stripPrefix } from '../components/deployment/types'
import type { DeploymentBotConfig, DeploymentSectionConfig } from '../services/api'
import { createPortal } from 'react-dom'
import {
  MessageSquare, Send, User, Bot, Loader2,
  FileText, Users, Clock, Copy, Check,
  RefreshCw, ChevronDown, AlertTriangle, TrendingUp,
  Calendar, Pin, PinOff, ChevronLeft, ChevronRight,
  Search, RotateCcw, Save, ArrowDownUp, ArrowUpNarrowWide,
  ArrowDownNarrowWide, Star, Activity, X, TriangleAlert,
  CheckCircle2, Timer, Zap, Filter, Trash2,
  Brain, ScanSearch, BarChart2, GitBranch, Layers,
  Cpu, Database, Radar, Gauge, ListChecks,
  Workflow, Telescope, FlaskConical, Network, Compass,
  Rocket,
} from 'lucide-react'
import { DAILY_LIMIT_MSGS, GENERIC_LIMIT_MSGS } from '../data/assistantMessages'
import api from '../services/api'
import type { IssueTimeline, IssueStint } from '../services/api'
import {
  pmAssistantQuery, getCarryover, saveCarryoverPlan,
  getAssigneeStats, getAvatarMap,
  getTimeTracking, getIssueTimelines,
  generatePMReport, generateWeeklyPMReport, listPMReports, listWeeklyPMReports, deletePMReport,
  getStageReportColumns, generateStageReport,
  getActiveSource,
} from '../services/pmDataService'
import DailyOpsTab from './DailyOpsTab'
import { useWorkflowConfig } from '../hooks/useWorkflowConfig'

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
  report_type?: string  // e.g. "daily-full", "daily-summary", "weekly-full", "weekly-summary"
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
  due_date?: string
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
  { id: 'tracking',    label: 'Tracking',          icon: Activity  },
  { id: 'daily',       label: 'Reports',            icon: FileText  },
  { id: 'assignees',   label: 'Assignee Stats',     icon: Users     },
  { id: 'dailyops',    label: 'Daily Ops',          icon: Zap       },
  { id: 'deployment',  label: 'Deployment Report',  icon: Rocket    },
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

const THINKING_PHRASES: { text: string; Icon: React.ElementType; key: string }[] = [
  { text: 'Thinking…',                    Icon: Brain,         key: 'brain' },
  { text: 'Analyzing your tickets…',      Icon: ScanSearch,    key: 'scan-search' },
  { text: 'Checking workload data…',      Icon: BarChart2,     key: 'bar-chart' },
  { text: 'Scanning issue history…',      Icon: Radar,         key: 'radar' },
  { text: 'Crunching the numbers…',       Icon: Cpu,           key: 'cpu' },
  { text: 'Looking through state logs…',  Icon: Database,      key: 'database' },
  { text: 'Reviewing assignee activity…', Icon: Users,         key: 'users' },
  { text: 'Checking for blockers…',       Icon: AlertTriangle, key: 'alert' },
  { text: 'Fetching live data…',          Icon: Network,       key: 'network' },
  { text: 'Correlating timelines…',       Icon: GitBranch,     key: 'git-branch' },
  { text: 'Inspecting ticket flow…',      Icon: Workflow,      key: 'workflow' },
  { text: 'Reading sprint context…',      Icon: Layers,        key: 'layers' },
  { text: 'Identifying patterns…',        Icon: TrendingUp,    key: 'trending-up' },
  { text: 'Pulling YouTrack data…',       Icon: Telescope,     key: 'telescope' },
  { text: 'Cross-referencing issues…',    Icon: ListChecks,    key: 'list-checks' },
  { text: 'Running diagnostics…',         Icon: FlaskConical,  key: 'flask' },
  { text: 'Processing context…',          Icon: Compass,       key: 'compass' },
  { text: 'Reviewing open items…',        Icon: FileText,      key: 'file-text' },
  { text: 'Checking delayed tickets…',    Icon: Timer,         key: 'timer' },
  { text: 'Almost there…',               Icon: Gauge,         key: 'gauge' },
]

export function PMAssistantTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [thinkingIdx, setThinkingIdx] = useState(0)
  const [thinkingVisible, setThinkingVisible] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!loading) { setThinkingIdx(0); setThinkingVisible(true); return }
    const cycle = () => {
      setThinkingVisible(false)
      thinkingTimerRef.current = setTimeout(() => {
        setThinkingIdx(i => (i + 1) % THINKING_PHRASES.length)
        setThinkingVisible(true)
        thinkingTimerRef.current = setTimeout(cycle, 2200)
      }, 350)
    }
    thinkingTimerRef.current = setTimeout(cycle, 2200)
    return () => { if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current) }
  }, [loading])

  const handleSend = async (query?: string) => {
    const text = query || input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { id: `msg-${Date.now()}-user`, role: 'user', content: text, timestamp: new Date() }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    const history = updatedMessages.map(m => ({ role: m.role, content: m.content }))
    const historyWithoutLast = history.slice(0, -1)

    const doQuery = () => pmAssistantQuery(text, historyWithoutLast)

    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]

    const friendlyError = (msg: string): string => {
      // Per-day token limit — retry window is minutes (e.g. "20m48s")
      const tpdMatch = msg.match(/try again in (\d+)m(\d+(?:\.\d+)?)?s?/i)
      if (tpdMatch) {
        const mins = parseInt(tpdMatch[1])
        const secs = tpdMatch[2] ? Math.round(parseFloat(tpdMatch[2])) : 0
        const timeStr = secs > 0 ? `${mins}m ${secs}s` : `${mins} minute${mins !== 1 ? 's' : ''}`
        return pick(DAILY_LIMIT_MSGS).replace(/{time}/g, timeStr)
      }

      // Per-minute short limit (already auto-retried — this is fallback)
      const perMinMatch = msg.match(/try again in (\d+(?:\.\d+)?)(ms|s)\b/i)
      if (perMinMatch) return pick(GENERIC_LIMIT_MSGS)

      // Generic rate/token error
      if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('token')) {
        return pick(GENERIC_LIMIT_MSGS)
      }

      return "Something went wrong on my end. Please try again."
    }

    try {
      let response
      try {
        response = await doQuery()
      } catch (firstErr) {
        const errMsg = firstErr instanceof Error ? firstErr.message : ''
        // Per-minute limit with short delay — auto retry silently
        const retryMatch = errMsg.match(/try again in (\d+(?:\.\d+)?)(ms|s)\b/i)
        if (retryMatch) {
          const value = parseFloat(retryMatch[1])
          const unit = retryMatch[2].toLowerCase()
          const delayMs = unit === 'ms' ? value : value * 1000
          if (delayMs <= 5000) {
            await new Promise(resolve => setTimeout(resolve, Math.ceil(delayMs) + 100))
            response = await doQuery()
          } else {
            throw firstErr
          }
        } else {
          throw firstErr
        }
      }
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: response.data?.response || 'No response received.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : ''
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: friendlyError(errMsg),
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

        {loading && (() => {
          const phrase = THINKING_PHRASES[thinkingIdx]
          const PhIcon = phrase.Icon
          return (
            <div className="pm-chat-message pm-chat-assistant">
              <div className="pm-chat-avatar"><Bot size={16} /></div>
              <div className="pm-chat-bubble pm-chat-loading">
                <span className={`pm-thinking-icon pm-ti-${phrase.key}${thinkingVisible ? ' pm-thinking-visible' : ''}`}>
                  <PhIcon size={15} />
                </span>
                <span className={`pm-thinking-text${thinkingVisible ? ' pm-thinking-visible' : ''}`}>
                  {phrase.text}
                </span>
              </div>
            </div>
          )
        })()}

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

function getMondayOfWeek(d: Date): string {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  return monday.toISOString().slice(0, 10)
}

function getWeekEnd(mondayStr: string): string {
  const monday = new Date(mondayStr + 'T00:00:00')
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return sunday.toISOString().slice(0, 10)
}

function formatWeekLabel(mondayStr: string): string {
  const monday = new Date(mondayStr + 'T00:00:00')
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const mo = monday.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  const su = sunday.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
  return `${mo} – ${su}`
}

function DailyReportTab() {
  const [mode, setMode] = useState<'daily' | 'weekly'>('daily')
  const [reportScope, setReportScope] = useState<'full' | 'summary'>('full')
  const [date, setDate] = useState(todayStr())
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()))
  const [report, setReport] = useState<PMReport | null>(null)
  const [history, setHistory] = useState<PMReport[]>([])
  const [weekHistory, setWeekHistory] = useState<PMReport[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Report config overrides
  const [configOpen, setConfigOpen] = useState(false)
  const [cfgPriorities, setCfgPriorities] = useState<string[]>([])
  const [cfgSections, setCfgSections] = useState<string[]>(['done', 'hotfixes', 'open', 'blocked', 'overdue'])
  const [cfgOpenStates, setCfgOpenStates] = useState<string[]>([])
  const [wfConfig, setWfConfig] = useState<{ priority_tags?: { label: string; color: string }[]; report_config?: { open_states?: string[]; sections?: string[]; priority_filters?: string[] } } | null>(null)
  const [ytStatesList, setYtStatesList] = useState<string[]>([])
  const [cfgSaveState, setCfgSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  // snapshot of what's currently saved in DB — used to detect unsaved changes
  const [savedSnapshot, setSavedSnapshot] = useState<{ priorities: string[]; sections: string[]; openStates: string[] } | null>(null)

  useEffect(() => {
    api.getWorkflowConfig().then(res => {
      if (res.success && res.data) {
        const cfg = res.data as typeof wfConfig
        setWfConfig(cfg)
        const rc = cfg?.report_config
        const p = rc?.priority_filters ?? []
        const s = rc?.sections ?? ['done','hotfixes','open','blocked','overdue']
        const o = rc?.open_states ?? []
        if (o.length) setCfgOpenStates(o)
        if (rc?.sections?.length) setCfgSections(s)
        if (rc?.priority_filters?.length) setCfgPriorities(p)
        setSavedSnapshot({ priorities: p, sections: s, openStates: o })
      }
    }).catch(() => {})
    // States dropdown (for open_states config) — use source-aware getPMStates
    import('../services/pmDataService').then(({ getPMStates }) => {
      getPMStates().then(res => {
        if ((res as any).success && (res as any).data)
          setYtStatesList(((res as any).data as Array<{ name: string }>).map((s: { name: string }) => s.name))
      }).catch(() => {})
    })
  }, [])

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

  function drSelectWeek(ds: string) {
    setWeekStart(getMondayOfWeek(new Date(ds + 'T00:00:00')))
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
    getCarryover().then(res => {
      if (res.data?.yesterday?.length) setCarryoverItems(res.data.yesterday)
    }).catch(() => {})
  }, [date])

  async function handleCarryoverToggle(idx: number) {
    const updated = carryoverItems.map((item, i) => i === idx ? { ...item, done: !item.done } : item)
    setCarryoverItems(updated)
    try { await saveCarryoverPlan(updated) } catch { setCarryoverItems(carryoverItems) }
  }

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await listPMReports()
      setHistory((res as any).data || [])
    } catch {
      // non-fatal
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  const fetchWeeklyHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await listWeeklyPMReports()
      setWeekHistory((res as any).data || [])
    } catch {
      // non-fatal
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  useEffect(() => {
    if (mode === 'weekly') fetchWeeklyHistory()
  }, [mode, fetchWeeklyHistory])

  const generateReport = async () => {
    setLoading(true)
    setError(null)
    const overrides = {
      priorities: cfgPriorities.length ? cfgPriorities : undefined,
      open_states: cfgOpenStates.length ? cfgOpenStates : undefined,
      sections: cfgSections.length > 0 ? cfgSections : undefined,
    }
    try {
      const res = mode === 'daily'
        ? await generatePMReport(date, reportScope, overrides)
        : await generateWeeklyPMReport(weekStart, reportScope)
      setReport((res as any).data)
      mode === 'daily' ? fetchHistory() : fetchWeeklyHistory()
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

  const loadHistoricReport = (r: PMReport) => {
    const rt = r.report_type ?? ''
    const isWeekly = rt.startsWith('weekly')
    if (isWeekly) {
      setWeekStart(r.date)
      setMode('weekly')
    } else {
      setDate(r.date)
      setMode('daily')
    }

    // Prefer full report — if user clicked summary but full exists for same date, load full instead
    const pool = isWeekly ? weekHistory : history
    const prefix = isWeekly ? 'weekly' : 'daily'
    const fullVersion = pool.find(h => h.date === r.date && h.report_type === `${prefix}-full`)
    const summaryVersion = pool.find(h => h.date === r.date && h.report_type === `${prefix}-summary`)
    const toLoad = fullVersion ?? summaryVersion ?? r
    setReportScope(toLoad.report_type?.includes('summary') ? 'summary' : 'full')
    setReport(toLoad)
  }

  // Switch scope using already-saved reports — never regenerates
  const switchScope = (newScope: 'full' | 'summary') => {
    if (newScope === reportScope) return
    if (!report) { setReportScope(newScope); return }
    const rt = report.report_type ?? ''
    const isWeekly = rt.startsWith('weekly')
    const pool = isWeekly ? weekHistory : history
    const prefix = isWeekly ? 'weekly' : 'daily'
    const target = pool.find(h => h.date === report.date && h.report_type === `${prefix}-${newScope}`)
    setReportScope(newScope)
    if (target) {
      setReport(target)
    } else {
      // Show placeholder — user can generate this scope if desired
      setReport(null)
    }
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
            <div className="pm-report-mode-toggle">
              <button
                className={`pm-mode-btn ${mode === 'daily' ? 'active' : ''}`}
                onClick={() => { setMode('daily'); setReport(null) }}
              >Daily</button>
              <button
                className={`pm-mode-btn ${mode === 'weekly' ? 'active' : ''}`}
                onClick={() => { setMode('weekly'); setReport(null) }}
              >Weekly</button>
            </div>
            <div className="pm-report-scope-toggle">
              {(() => {
                const pool = mode === 'weekly' ? weekHistory : history
                const prefix = mode === 'weekly' ? 'weekly' : 'daily'
                const activeDate = mode === 'weekly' ? weekStart : date
                const hasFullSaved = pool.some(h => h.date === activeDate && h.report_type === `${prefix}-full`)
                const hasSummarySaved = pool.some(h => h.date === activeDate && h.report_type === `${prefix}-summary`)
                return (
                  <>
                    <button
                      className={`pm-scope-btn ${reportScope === 'full' ? 'active' : ''}`}
                      onClick={() => report ? switchScope('full') : setReportScope('full')}
                    >Full Report</button>
                    <button
                      className={`pm-scope-btn ${reportScope === 'summary' ? 'active' : ''}`}
                      onClick={() => report ? switchScope('summary') : setReportScope('summary')}
                    >Summary</button>
                  </>
                )
              })()}
            </div>
            <div className="pm-daily-date-row">
              <div className="dr-cal-wrap" ref={calRef}>
                <button className="dr-cal-trigger" onClick={() => setCalOpen(o => !o)}>
                  <Calendar size={14} />
                  {mode === 'daily' ? drFormatDisplay(date) : formatWeekLabel(weekStart)}
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
                          const weekEnd = getWeekEnd(weekStart)
                          const isInWeek = mode === 'weekly' && ds >= weekStart && ds <= weekEnd
                          const isWeekStart = mode === 'weekly' && ds === weekStart
                          const isWeekEnd = mode === 'weekly' && ds === weekEnd
                          return (
                            <button
                              key={day}
                              className={`calendar-day ${mode === 'daily' && ds === date ? 'selected' : ''} ${ds === drTodayStr ? 'today' : ''} ${isFuture ? 'empty' : ''} ${isInWeek ? 'week-range' : ''} ${isWeekStart ? 'week-range-start' : ''} ${isWeekEnd ? 'week-range-end' : ''}`}
                              disabled={isFuture}
                              onClick={() => !isFuture && (mode === 'daily' ? drSelectDate(ds) : drSelectWeek(ds))}
                            >
                              {day}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm calendar-today-btn"
                      onClick={() => {
                        if (mode === 'daily') { drSelectDate(drTodayStr); setCalDate(new Date()) }
                        else { drSelectWeek(drTodayStr); setCalDate(new Date()) }
                      }}
                    >
                      <Calendar size={14} />
                      {mode === 'daily' ? 'Today' : 'This Week'}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="pm-daily-actions">
              <button className="btn-primary pm-generate-btn" onClick={() => setConfigOpen(o => !o)} disabled={loading}>
                <Filter size={15} />
                Generate Report{cfgPriorities.length || cfgSections.length < 5 ? ' •' : ''}
              </button>
              {report && (
                <button className="btn-secondary pm-copy-btn" onClick={copyReport}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              )}
            </div>

            {/* Config + Generate panel */}
            {configOpen && (() => {
              const allSections = ['done','hotfixes','open','blocked','overdue']
              const basePriorities = (wfConfig?.priority_tags ?? [{label:'P0',color:'#ef4444'},{label:'P1',color:'#f97316'},{label:'P2',color:'#eab308'},{label:'P3',color:'#6366f1'}])
              // Always include "Other" for unassigned issues
              const allPriorities = [...basePriorities, { label: 'Other', color: '#94a3b8' }]
              const allPriorityLabels = allPriorities.map(t => t.label)
              const allSectionsOn = cfgSections.length === allSections.length
              // "All" means cfgPriorities is empty (backend default = all) OR every label is included
              const allPrioritiesOn = cfgPriorities.length === 0 || allPriorityLabels.every(l => cfgPriorities.includes(l))
              return (
                <div className="pm-config-panel">
                  <div className="pm-config-grid">
                    <div className="pm-config-card">
                      <div className="pm-config-card-title">Sections</div>
                      <div className="pm-config-chips">
                        <label className="cfg-chip" style={{ gap: '0.35rem' }}>
                          <input type="checkbox" checked={allSectionsOn} onChange={() => setCfgSections(allSectionsOn ? [] : [...allSections])} style={{ accentColor: 'var(--color-primary)', margin: 0 }} />
                          All
                        </label>
                        {allSections.map(s => (
                          <button key={s} className={`cfg-chip${cfgSections.includes(s) ? ' on' : ''}`}
                            onClick={() => setCfgSections(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="pm-config-card">
                      <div className="pm-config-card-title">Priorities</div>
                      <div className="pm-config-chips">
                        <label className="cfg-chip" style={{ gap: '0.35rem' }}>
                          <input type="checkbox" checked={allPrioritiesOn}
                            onChange={() => {
                              if (allPrioritiesOn) {
                                setCfgPriorities([...allPriorityLabels])
                              } else {
                                setCfgPriorities([])
                              }
                            }}
                            style={{ accentColor: 'var(--color-primary)', margin: 0 }} />
                          All
                        </label>
                        {allPriorities.map(t => {
                          const isOn = cfgPriorities.length === 0 || cfgPriorities.includes(t.label)
                          return (
                            <button key={t.label} className={`cfg-chip${isOn ? ' on' : ''}`}
                              onClick={() => setCfgPriorities(prev => {
                                const effective = prev.length === 0 ? allPriorityLabels : prev
                                const next = effective.includes(t.label) ? effective.filter(x => x !== t.label) : [...effective, t.label]
                                return next.length === allPriorityLabels.length ? [] : next
                              })}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, display: 'inline-block', flexShrink: 0 }} />
                              {t.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {(() => {
                      const availableStates = ytStatesList.length > 0 ? ytStatesList : (wfConfig?.report_config?.open_states ?? [])
                      return availableStates.length > 0 ? (
                        <div className="pm-config-card">
                          <div className="pm-config-card-title">Open States</div>
                          <div className="pm-config-chips">
                            {availableStates.map(s => (
                              <button key={s} className={`cfg-chip${cfgOpenStates.includes(s) ? ' on' : ''}`}
                                onClick={() => setCfgOpenStates(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}>
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null
                    })()}
                  </div>
                  <div className="pm-config-actions">
                    <button className="btn-primary pm-generate-btn" disabled={loading} onClick={() => { setConfigOpen(false); generateReport() }}>
                      {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                      {loading ? 'Generating...' : 'Generate'}
                    </button>
                    <div className="pm-config-actions-right">
                      <button className="btn-ghost btn-sm" onClick={() => {
                        const snap = savedSnapshot
                        setCfgPriorities(snap?.priorities ?? [])
                        setCfgSections(snap?.sections?.length ? snap.sections : [...allSections])
                        setCfgOpenStates(snap?.openStates ?? [])
                        setCfgSaveState('idle')
                      }}>
                        <RotateCcw size={13} /> Reset
                      </button>
                      {(() => {
                        const isDirty = savedSnapshot && (
                          JSON.stringify([...cfgPriorities].sort()) !== JSON.stringify([...(savedSnapshot.priorities)].sort()) ||
                          JSON.stringify([...cfgSections].sort()) !== JSON.stringify([...(savedSnapshot.sections)].sort()) ||
                          JSON.stringify([...cfgOpenStates].sort()) !== JSON.stringify([...(savedSnapshot.openStates)].sort())
                        )
                        return (
                          <button
                            className={`btn-sm ${cfgSaveState === 'saved' ? 'btn-success' : 'btn-primary'}`}
                            disabled={cfgSaveState === 'saving' || !isDirty}
                            onClick={async () => {
                              setCfgSaveState('saving')
                              await api.updateReportConfig({ done_role: wfConfig?.report_config ? 'dev_done' : 'dev_done', blocked_states: [], open_states: cfgOpenStates, priority_filters: cfgPriorities, sections: cfgSections })
                              setSavedSnapshot({ priorities: cfgPriorities, sections: cfgSections, openStates: cfgOpenStates })
                              setCfgSaveState('saved')
                              setTimeout(() => setCfgSaveState('idle'), 2500)
                            }}>
                            {cfgSaveState === 'saving' ? <Loader2 size={13} className="animate-spin" /> : cfgSaveState === 'saved' ? <Check size={13} /> : <Save size={13} />}
                            {cfgSaveState === 'saving' ? 'Saving…' : cfgSaveState === 'saved' ? 'Saved!' : 'Save as Default'}
                          </button>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>

          <div className="pm-report-scroll">
            {error && (
              <div className="pm-report-error">
                <AlertTriangle size={16} />
                {error}
              </div>
            )}

            {/* Carry-over checklist — shown at top when viewing today in daily mode */}
            {mode === 'daily' && date === todayStr() && carryoverItems.length > 0 && (
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
                    {report.report_type === 'weekly'
                      ? `Week of ${formatWeekLabel(report.date)}`
                      : new Date(report.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="pm-report-body">
                  {renderReportText(report.report_text)}
                </div>
              </div>
            ) : (() => {
              const pool = mode === 'weekly' ? weekHistory : history
              const activeDate = mode === 'weekly' ? weekStart : date
              const prefix = mode === 'weekly' ? 'weekly' : 'daily'
              const hasAnyForDate = pool.some(h => h.date === activeDate)
              const hasSiblingScope = pool.some(h => h.date === activeDate && h.report_type === `${prefix}-${reportScope === 'full' ? 'summary' : 'full'}`)
              if (hasAnyForDate) {
                return (
                  <div className="pm-report-empty pm-report-scope-missing">
                    <FileText size={40} />
                    <p>No <strong>{reportScope === 'full' ? 'full' : 'summary'} report</strong> generated for this {mode === 'weekly' ? 'week' : 'date'}.</p>
                    {hasSiblingScope && (
                      <p className="pm-scope-hint">Switch to <strong>{reportScope === 'full' ? 'Summary' : 'Full Report'}</strong> to view the saved version, or click <strong>Generate Report</strong> to create this one.</p>
                    )}
                    {!hasSiblingScope && (
                      <p className="pm-scope-hint">Click <strong>Generate Report</strong> to create it.</p>
                    )}
                  </div>
                )
              }
              return (
                <div className="pm-report-empty">
                  <FileText size={40} />
                  {mode === 'daily'
                    ? <p>Select a date and click <strong>Generate Report</strong> to create today's Slack-style PM report.</p>
                    : <p>Select a week and click <strong>Generate Report</strong> to create a weekly PM report.</p>
                  }
                </div>
              )
            })()}
          </div>
        </div>

        {/* Right: History Sidebar */}
        <div className="pm-daily-sidebar glass-card">
          <div className="pm-sidebar-header">
            <h4>{mode === 'daily' ? 'Report History' : 'Weekly History'}</h4>
            <button className="pm-sidebar-refresh" onClick={mode === 'daily' ? fetchHistory : fetchWeeklyHistory} disabled={loadingHistory}>
              {loadingHistory ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          <div className="pm-history-list">
            {(mode === 'daily' ? history : weekHistory).length === 0 && !loadingHistory && (
              <p className="pm-history-empty">No saved reports yet.</p>
            )}
            {(mode === 'daily' ? history : weekHistory).map(r => (
              <div key={r.id} className={`pm-history-item ${report?.id === r.id ? 'active' : ''}`}>
                <button className="pm-history-item-btn" onClick={() => loadHistoricReport(r)}>
                  <div className="pm-history-date">
                    {mode === 'weekly' ? formatWeekLabel(r.date) : r.date}
                    <span className={`pm-history-scope-badge ${r.report_type?.includes('summary') ? 'summary' : 'full'}`}>
                      {r.report_type?.includes('summary') ? 'Summary' : 'Full'}
                    </span>
                  </div>
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
                          await deletePMReport(r.id)
                          if (mode === 'daily') setHistory(prev => prev.filter(h => h.id !== r.id))
                          else setWeekHistory(prev => prev.filter(h => h.id !== r.id))
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
      const res = await getAssigneeStats()
      setStats((res as any).data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { getAvatarMap().then(setAvatarMap) }, [])

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
        <div className="pm-empty-state"><Users size={40} /><p>No assignee data yet. Stats populate from webhook events or after a Backfill.</p></div>
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

// ─── Helpers for IssueTimeline (stint view) ──────────────────────────────────

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

// ─── Tab: Tracking (Logbook + Summary) ───────────────────────────────────────

type SortKey = 'time_asc' | 'time_desc' | 'priority' | 'entered_at' | 'status'

function TrackingTab({ blockerIssueIds }: { blockerIssueIds?: Set<string> }) {
  const isAsana = getActiveSource() === 'asana'
  const [mode, setMode] = useState<'logbook' | 'summary'>('logbook')

  // ── Logbook state ─────────────────────────────────────────────────────────
  const [selectedWeek, setSelectedWeek] = useState<Date>(() => getMondayOf(new Date()))
  const [noWeekFilter, setNoWeekFilter] = useState(false)
  const [rows, setRows] = useState<TimeTrackingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [resetting, setResetting] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [importing, setImporting] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [togglingPin, setTogglingPin] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('entered_at')
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)
  const sortDropdownRef = useRef<HTMLButtonElement>(null)
  const [sortDropdownRect, setSortDropdownRect] = useState<DOMRect | null>(null)
  const [filterMismatch, setFilterMismatch] = useState(false)

  // ── Summary state ─────────────────────────────────────────────────────────
  const [timelines, setTimelines] = useState<IssueTimeline[]>([])
  const [tlLoading, setTlLoading] = useState(false)
  const [tlError, setTlError] = useState<string | null>(null)
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set())
  const [dismissing, setDismissing] = useState<string | null>(null)

  // ── Workflow config (for column role filter) ──────────────────────────────
  const { config: wfConfig, getColumnHierarchy } = useWorkflowConfig()

  // ── Shared filter state ───────────────────────────────────────────────────
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({})
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [filterMovedBack, setFilterMovedBack] = useState(false)
  const [filterLive, setFilterLive] = useState(false)
  const [filterDelayed, setFilterDelayed] = useState(false)
  const [filterPinned, setFilterPinned] = useState(false)
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterPriorities, setFilterPriorities] = useState<string[]>([])
  const [filterColumnRoles, setFilterColumnRoles] = useState<string[]>(() =>
    wfConfig?.report_config?.tracked_column_roles ?? []
  )
  const [searchIssue, setSearchIssue] = useState('')
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false)
  const assigneeDropdownRef = useRef<HTMLButtonElement>(null)
  const [assigneeDropdownRect, setAssigneeDropdownRect] = useState<DOMRect | null>(null)

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchRows = useCallback(async (week: Date, skipWeek: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const params: { week?: string } = {}
      if (!skipWeek) params.week = toISODate(week)
      const res = await getTimeTracking(params)
      setRows((res as any).data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load time tracking')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTimelines = useCallback(async () => {
    setTlLoading(true)
    setTlError(null)
    try {
      const res = await getIssueTimelines()
      setTimelines((res as any).data || [])
    } catch (err) {
      setTlError(err instanceof Error ? err.message : 'Failed to load timelines')
    } finally {
      setTlLoading(false)
    }
  }, [])

  useEffect(() => { fetchRows(selectedWeek, noWeekFilter) }, [fetchRows, selectedWeek, noWeekFilter])
  useEffect(() => { fetchTimelines() }, [fetchTimelines])
  useEffect(() => {
    const id = setInterval(() => { fetchTimelines() }, 2 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchTimelines])
  useEffect(() => { getAvatarMap().then(setAvatarMap) }, [])
  // Sync column role filter from workflow config when config loads
  useEffect(() => {
    const configured = wfConfig?.report_config?.tracked_column_roles
    if (configured && configured.length > 0) setFilterColumnRoles(configured)
  }, [wfConfig])

  // ── Close dropdowns on outside click ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(e.target as Node))
        setAssigneeDropdownOpen(false)
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node))
        setSortDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Logbook handlers ──────────────────────────────────────────────────────
  const changeWeek = (delta: number) => {
    setSelectedWeek(w => { const next = new Date(w); next.setDate(next.getDate() + delta * 7); return next })
    setNoWeekFilter(false)
  }
  const goThisWeek = () => { setSelectedWeek(getMondayOf(new Date())); setNoWeekFilter(false) }
  const toggleRow = (id: string) => {
    setExpandedRows(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
  const togglePin = async (row: TimeTrackingRow) => {
    setTogglingPin(row.issue_id)
    try {
      if (row.pinned) await api.unpinIssue(row.issue_id)
      else await api.pinIssue(row.issue_id)
      await fetchRows(selectedWeek, noWeekFilter)
    } catch { /* ignore */ } finally { setTogglingPin(null) }
  }
  const runReset = async () => {
    if (!resetConfirm) { setResetConfirm(true); setTimeout(() => setResetConfirm(false), 5000); return }
    setResetConfirm(false); setResetting(true); setBackfillMsg(null)
    try {
      const res = await api.resetStateLog()
      setBackfillMsg(`State log cleared: ${res.data?.deleted ?? 0} rows deleted.`)
      setRows([])
    } catch (err) { setBackfillMsg(`Reset failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally { setResetting(false) }
  }
  const runReconcile = async () => {
    setReconciling(true); setBackfillMsg(null)
    try {
      const res = await api.reconcileStateLog()
      const d = res.data
      setBackfillMsg(`Reconcile: ${d?.reconciled ?? 0} exit rows inserted, ${d?.skipped ?? 0} up-to-date.`)
      fetchRows(selectedWeek, noWeekFilter)
    } catch (err) { setBackfillMsg(`Reconcile failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally { setReconciling(false) }
  }
  const runImportHistory = async () => {
    setImporting(true); setBackfillMsg(null)
    try {
      const res = await api.importHistory()
      const d = res.data
      setBackfillMsg(`Sync done: ${d?.inserted ?? 0} transitions inserted. ${d?.skipped ?? 0} already existed.`)
      fetchRows(selectedWeek, noWeekFilter)
    } catch (err) { setBackfillMsg(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally { setImporting(false) }
  }

  // ── Summary handlers ──────────────────────────────────────────────────────
  const toggleExpand = (issueID: string) => {
    setExpandedIssues(prev => { const next = new Set(prev); next.has(issueID) ? next.delete(issueID) : next.add(issueID); return next })
  }
  const handleDismiss = async (issueID: string) => {
    setDismissing(issueID)
    try {
      await api.dismissAlert(issueID)
      setTimelines(prev => prev.map(t => t.issue_id === issueID ? { ...t, alert_dismissed: true } : t))
    } finally { setDismissing(null) }
  }
  const handleUndismiss = async (issueID: string) => {
    setDismissing(issueID)
    try {
      await api.undismissAlert(issueID)
      setTimelines(prev => prev.map(t => t.issue_id === issueID ? { ...t, alert_dismissed: false } : t))
    } finally { setDismissing(null) }
  }

  // ── Logbook derived values ────────────────────────────────────────────────
  const getStateRole = (stateName: string): string | undefined => {
    const hierarchy = getColumnHierarchy()
    const col = hierarchy.find(c =>
      c.state.toLowerCase() === stateName.toLowerCase() ||
      (c.aliases ?? []).some(a => a.toLowerCase() === stateName.toLowerCase())
    )
    return col?.role
  }

  let displayed = rows
  if (filterColumnRoles.length > 0) displayed = displayed.filter(r => {
    const role = getStateRole(r.to_state)
    return role ? filterColumnRoles.includes(role) : true
  })
  if (filterOverdue)   displayed = displayed.filter(r => r.overdue)
  if (filterMismatch)  displayed = displayed.filter(r => r.moved_by_mismatch)
  if (filterMovedBack) displayed = displayed.filter(r => isMovedBack(r.from_state, r.to_state))
  if (filterLive)      displayed = displayed.filter(r => r.duration_in_prev_state_hours === null)
  if (filterDelayed)   displayed = displayed.filter(r => r.duration_in_prev_state_hours !== null && r.duration_in_prev_state_hours > r.threshold_hours)
  if (filterPinned)    displayed = displayed.filter(r => r.pinned)
  if (filterAssignee)  displayed = displayed.filter(r => r.assignee.toLowerCase() === filterAssignee.toLowerCase())
  if (filterPriorities.length > 0) displayed = displayed.filter(r => filterPriorities.includes(r.priority))
  if (searchIssue) {
    const q = searchIssue.toLowerCase()
    displayed = displayed.filter(r => r.issue_id.toLowerCase().includes(q) || r.issue_summary.toLowerCase().includes(q))
  }
  displayed = [...displayed].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    switch (sortKey) {
      case 'time_asc':  return (a.duration_in_prev_state_hours ?? 0) - (b.duration_in_prev_state_hours ?? 0)
      case 'time_desc': return (b.duration_in_prev_state_hours ?? 0) - (a.duration_in_prev_state_hours ?? 0)
      case 'priority': { const O: Record<string,number> = {P0:0,P1:1,P2:2,P3:3,Other:4}; return (O[a.priority]??4)-(O[b.priority]??4) }
      case 'status': {
        const s = (r: TimeTrackingRow) => r.overdue ? 0 : r.duration_in_prev_state_hours === null ? 1 : isMovedBack(r.from_state, r.to_state) ? 2 : 3
        return s(a) - s(b)
      }
      default: return new Date(b.transitioned_at).getTime() - new Date(a.transitioned_at).getTime()
    }
  })
  const groupedIssues: { rep: TimeTrackingRow; all: TimeTrackingRow[] }[] = []
  const seenIssues = new Map<string, number>()
  for (const row of displayed) {
    const idx = seenIssues.get(row.issue_id)
    if (idx === undefined) {
      seenIssues.set(row.issue_id, groupedIssues.length)
      groupedIssues.push({ rep: row, all: [row] })
    } else {
      groupedIssues[idx].all.push(row)
      const cur = groupedIssues[idx].rep
      const cs = cur.overdue ? 0 : cur.duration_in_prev_state_hours === null ? 1 : isMovedBack(cur.from_state, cur.to_state) ? 2 : 3
      const ns = row.overdue ? 0 : row.duration_in_prev_state_hours === null ? 1 : isMovedBack(row.from_state, row.to_state) ? 2 : 3
      if (ns < cs) groupedIssues[idx].rep = row
    }
  }
  const overdueCount   = rows.filter(r => r.overdue).length
  const mismatchCount  = rows.filter(r => r.moved_by_mismatch).length
  const lbMovedBack    = rows.filter(r => isMovedBack(r.from_state, r.to_state)).length
  const pinnedCount    = rows.filter(r => r.pinned).length
  const liveCount      = rows.filter(r => r.duration_in_prev_state_hours === null).length
  const delayedCount   = rows.filter(r => r.duration_in_prev_state_hours !== null && r.duration_in_prev_state_hours > r.threshold_hours).length

  // ── Summary derived values ────────────────────────────────────────────────
  const movedBackAlerts = timelines.filter(t => t.is_live && t.moved_back_count > 0 && !t.alert_dismissed)
  let tlDisplayed = timelines
  if (searchIssue) {
    const q = searchIssue.toLowerCase()
    tlDisplayed = tlDisplayed.filter(t => t.issue_id.toLowerCase().includes(q) || t.issue_summary.toLowerCase().includes(q))
  }
  if (filterLive)       tlDisplayed = tlDisplayed.filter(t => t.is_live)
  if (filterOverdue)    tlDisplayed = tlDisplayed.filter(t => t.is_overdue)
  if (filterMovedBack)  tlDisplayed = tlDisplayed.filter(t => t.moved_back_count > 0)
  if (filterDelayed)    tlDisplayed = tlDisplayed.filter(t => t.total_hours > t.threshold_hours)
  if (filterPinned)     tlDisplayed = tlDisplayed.filter(t => t.pinned)
  if (filterAssignee)   tlDisplayed = tlDisplayed.filter(t => t.assignee?.toLowerCase() === filterAssignee.toLowerCase())
  if (filterPriorities.length > 0) tlDisplayed = tlDisplayed.filter(t => filterPriorities.includes(t.priority))
  const tlOverdueCount   = timelines.filter(t => t.is_overdue).length
  const tlMovedBackCount = timelines.filter(t => t.moved_back_count > 0).length
  const tlLiveCount      = timelines.filter(t => t.is_live).length
  const tlDelayedCount   = timelines.filter(t => t.total_hours > t.threshold_hours).length
  const tlPinnedCount    = timelines.filter(t => t.pinned).length

  // ── Shared/active counts for filter bar ──────────────────────────────────
  const activeOverdueCount   = mode === 'logbook' ? overdueCount   : tlOverdueCount
  const activeLiveCount      = mode === 'logbook' ? liveCount      : tlLiveCount
  const activeDelayedCount   = mode === 'logbook' ? delayedCount   : tlDelayedCount
  const activeMovedBackCount = mode === 'logbook' ? lbMovedBack    : tlMovedBackCount
  const activePinnedCount    = mode === 'logbook' ? pinnedCount    : tlPinnedCount
  const allAssignees = Array.from(new Set(
    mode === 'logbook'
      ? rows.map(r => r.assignee).filter(Boolean)
      : timelines.map(t => t.assignee).filter(Boolean)
  )).sort()
  const activeFilterCount = [
    filterOverdue, filterMovedBack, filterLive, filterDelayed, filterPinned,
    filterAssignee !== '', filterPriorities.length > 0, filterColumnRoles.length > 0,
    ...(mode === 'logbook' ? [filterMismatch] : []),
  ].filter(Boolean).length

  return (
    <div className="pm-tab-content pm-tracking-tab">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="pm-tab-header">
        <h3 className="pm-section-title"><Activity size={18} /> Tracking</h3>
        <div className="pm-tracking-controls">
          {mode === 'logbook' && (
            <>
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
            </>
          )}
          {mode === 'summary' && (
            <button className="btn-secondary btn-sm" onClick={fetchTimelines} disabled={tlLoading}>
              {tlLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* ── Mode toggle ────────────────────────────────────────────────────── */}
      <div className="tracking-mode-toggle">
        <button className={mode === 'logbook' ? 'active' : ''} onClick={() => setMode('logbook')}>
          <RotateCcw size={13} /> Logbook
        </button>
        <button className={mode === 'summary' ? 'active' : ''} onClick={() => setMode('summary')}>
          <Activity size={13} /> Summary
        </button>
      </div>

      {(error || tlError || backfillMsg) && (
        <>
          {error && <div className="pm-report-error"><AlertTriangle size={16} />{error}</div>}
          {tlError && <div className="pm-report-error"><AlertTriangle size={16} />{tlError}</div>}
          {backfillMsg && (
            <div className={`pm-backfill-msg ${backfillMsg.includes('failed') ? 'error' : 'success'}`}>
              {backfillMsg}
            </div>
          )}
        </>
      )}

      {/* ── Week navigator (Logbook only) ───────────────────────────────────── */}
      {mode === 'logbook' && (
        <div className="pm-week-nav glass-card">
          <button className="btn-icon" onClick={() => changeWeek(-1)} title="Previous week"><ChevronLeft size={16} /></button>
          <div className="week-label">
            {noWeekFilter
              ? <span className="week-all">All Time</span>
              : <><Calendar size={14} /><span>{formatWeekRange(selectedWeek)}</span></>
            }
          </div>
          <button className="btn-icon" onClick={() => changeWeek(1)} title="Next week"><ChevronRight size={16} /></button>
          <button className={`btn-sm ${noWeekFilter ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setNoWeekFilter(f => !f)}>
            {noWeekFilter ? 'By Week' : 'All Time'}
          </button>
          <button className="btn-sm btn-secondary" onClick={goThisWeek} disabled={noWeekFilter}>This Week</button>
          {pinnedCount > 0 && <span className="pinned-count-badge"><Pin size={12} /> {pinnedCount} pinned</span>}
        </div>
      )}

      {/* ── Moved-back alerts (Summary only) ───────────────────────────────── */}
      {mode === 'summary' && movedBackAlerts.length > 0 && (
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
                      : <span className="filter-avatar-placeholder">{t.assignee.charAt(0).toUpperCase()}</span>}
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
                <button className="btn-sm btn-primary" onClick={() => toggleExpand(t.issue_id)} title="See full timeline">View Timeline</button>
                <button className="btn-sm btn-secondary" onClick={() => handleDismiss(t.issue_id)} disabled={dismissing === t.issue_id} title="Dismiss alert">
                  {dismissing === t.issue_id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Shared filter bar ──────────────────────────────────────────────── */}
      <div className="pm-filter-bar">
        <div className="pm-search-box">
          <Search size={13} />
          <input
            type="text"
            placeholder="Search issue…"
            value={searchIssue}
            onChange={e => setSearchIssue(e.target.value)}
          />
        </div>

        <div className="pm-custom-dropdown">
          <button ref={assigneeDropdownRef} className="pm-custom-dropdown-trigger" onClick={() => {
            const rect = assigneeDropdownRef.current?.getBoundingClientRect() ?? null
            setAssigneeDropdownRect(rect)
            setAssigneeDropdownOpen(o => !o)
          }}>
            {filterAssignee ? (
              <>
                {avatarMap[filterAssignee]
                  ? <img src={avatarMap[filterAssignee]} alt={filterAssignee} className="filter-avatar-img" />
                  : <span className="filter-avatar-placeholder">{filterAssignee.charAt(0).toUpperCase()}</span>}
                <span className="filter-assignee-name">{filterAssignee.split(' ')[0]}</span>
              </>
            ) : (
              <><Users size={14} /><span>All Assignees</span></>
            )}
            <ChevronDown size={12} className={`dropdown-chevron ${assigneeDropdownOpen ? 'open' : ''}`} />
          </button>
          {assigneeDropdownOpen && assigneeDropdownRect && createPortal(
            <div className="pm-custom-dropdown-menu" style={{ position: 'fixed', top: assigneeDropdownRect.bottom + 4, left: assigneeDropdownRect.left, minWidth: assigneeDropdownRect.width, zIndex: 9999 }}>
              <button className={`pm-dropdown-item ${!filterAssignee ? 'active' : ''}`} onClick={() => { setFilterAssignee(''); setAssigneeDropdownOpen(false) }}>
                <Users size={14} /><span>All Assignees</span>
              </button>
              {allAssignees.map(a => (
                <button key={a} className={`pm-dropdown-item ${filterAssignee === a ? 'active' : ''}`} onClick={() => { setFilterAssignee(a); setAssigneeDropdownOpen(false) }}>
                  {avatarMap[a] ? <img src={avatarMap[a]} alt={a} className="filter-avatar-img" /> : <span className="filter-avatar-placeholder">{a.charAt(0).toUpperCase()}</span>}
                  <span>{a}</span>
                </button>
              ))}
            </div>,
            document.body
          )}
        </div>

        <div className="pm-priority-chips">
          {['P0','P1','P2','P3'].map(p => (
            <button key={p} className={`priority-chip ${filterPriorities.includes(p) ? 'active' : ''} ${priorityBadgeClass(p)}`}
              onClick={() => setFilterPriorities(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}>
              {p}
            </button>
          ))}
        </div>

        {getColumnHierarchy().length > 0 && (
          <div className="pm-column-role-chips">
            {getColumnHierarchy().filter(c => c.role).map(col => (
              <button
                key={col.state}
                className={`column-role-chip${filterColumnRoles.includes(col.role) ? ' active' : ''}`}
                onClick={() => setFilterColumnRoles(prev =>
                  prev.includes(col.role) ? prev.filter(x => x !== col.role) : [...prev, col.role]
                )}
              >
                {col.state}
              </button>
            ))}
          </div>
        )}

        {mode === 'logbook' && (
          <div className="pm-custom-dropdown">
            <button ref={sortDropdownRef} className="pm-custom-dropdown-trigger" onClick={() => {
              const rect = sortDropdownRef.current?.getBoundingClientRect() ?? null
              setSortDropdownRect(rect)
              setSortDropdownOpen(o => !o)
            }}>
              {sortKey === 'entered_at'  && <><ArrowDownUp size={14} /><span>Newest First</span></>}
              {sortKey === 'time_asc'    && <><ArrowUpNarrowWide size={14} /><span>Time ↑</span></>}
              {sortKey === 'time_desc'   && <><ArrowDownNarrowWide size={14} /><span>Time ↓</span></>}
              {sortKey === 'priority'    && <><Star size={14} /><span>Priority</span></>}
              {sortKey === 'status'      && <><Activity size={14} /><span>Status</span></>}
              <ChevronDown size={12} className={`dropdown-chevron ${sortDropdownOpen ? 'open' : ''}`} />
            </button>
            {sortDropdownOpen && sortDropdownRect && createPortal(
              <div className="pm-custom-dropdown-menu" style={{ position: 'fixed', top: sortDropdownRect.bottom + 4, left: sortDropdownRect.left, minWidth: sortDropdownRect.width, zIndex: 9999 }}>
                {([
                  { key: 'entered_at', label: 'Newest First',              Icon: ArrowDownUp },
                  { key: 'status',     label: 'Status (Overdue→Live→Done)', Icon: Activity },
                  { key: 'time_asc',   label: 'Time ↑ (low→high)',         Icon: ArrowUpNarrowWide },
                  { key: 'time_desc',  label: 'Time ↓ (high→low)',         Icon: ArrowDownNarrowWide },
                  { key: 'priority',   label: 'Priority',                   Icon: Star },
                ] as { key: SortKey; label: string; Icon: React.ElementType }[]).map(({ key, label, Icon }) => (
                  <button key={key} className={`pm-dropdown-item ${sortKey === key ? 'active' : ''}`}
                    onClick={() => { setSortKey(key); setSortDropdownOpen(false) }}>
                    <Icon size={14} /><span>{label}</span>
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>
        )}

        <div className="pm-toggle-filters">
          {activeLiveCount > 0 && (
            <button className={`btn-sm ${filterLive ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilterLive(f => !f)}>
              <Timer size={13} /> Live ({activeLiveCount})
            </button>
          )}
          {activeDelayedCount > 0 && (
            <button className={`btn-sm ${filterDelayed ? 'btn-danger-active' : 'btn-secondary'}`} onClick={() => setFilterDelayed(f => !f)}>
              <Zap size={13} /> Delayed ({activeDelayedCount})
            </button>
          )}
          {activeOverdueCount > 0 && (
            <button className={`btn-sm ${filterOverdue ? 'btn-danger-active' : 'btn-secondary'}`} onClick={() => setFilterOverdue(f => !f)}>
              <AlertTriangle size={13} /> Overdue ({activeOverdueCount})
            </button>
          )}
          {mode === 'logbook' && mismatchCount > 0 && (
            <button className={`btn-sm ${filterMismatch ? 'btn-warning-active' : 'btn-secondary'}`} onClick={() => setFilterMismatch(f => !f)}>
              <AlertTriangle size={13} /> Mismatch ({mismatchCount})
            </button>
          )}
          {activeMovedBackCount > 0 && (
            <button className={`btn-sm ${filterMovedBack ? 'btn-warning-active' : 'btn-secondary'}`} onClick={() => setFilterMovedBack(f => !f)}>
              <RotateCcw size={13} /> Moved Back ({activeMovedBackCount})
            </button>
          )}
          {activePinnedCount > 0 && (
            <button className={`btn-sm ${filterPinned ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilterPinned(f => !f)}>
              <Pin size={13} /> Pinned ({activePinnedCount})
            </button>
          )}
          {activeFilterCount > 0 && (
            <button className="btn-sm btn-ghost tl-clear-filters" onClick={() => {
              setFilterOverdue(false); setFilterMismatch(false); setFilterMovedBack(false)
              setFilterLive(false); setFilterDelayed(false); setFilterPinned(false)
              setFilterAssignee(''); setFilterPriorities([]); setFilterColumnRoles([]); setSearchIssue('')
            }}>
              <X size={12} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── List ───────────────────────────────────────────────────────────── */}
      {mode === 'logbook' ? (
        loading && rows.length === 0 ? (
          <div className="pm-loading-state"><Loader2 size={32} className="animate-spin" /><span>Loading…</span></div>
        ) : rows.length === 0 ? (
          <div className="pm-empty-state">
            <Clock size={40} />
            <p>No time tracking data for this week.</p>
            <p style={{ fontSize: '0.8rem' }}>Try <strong>All Time</strong> view or click <strong>Sync History</strong>.</p>
          </div>
        ) : (
          <div className="pm-card-list glass-card">
            <div className="pm-list-summary">
              <span>{groupedIssues.length} issues · {displayed.length} transitions</span>
              {overdueCount > 0 && <span className="overdue-summary-badge"><AlertTriangle size={12} /> {overdueCount} overdue</span>}
              {mismatchCount > 0 && <span className="mismatch-summary-badge"><AlertTriangle size={12} /> {mismatchCount} mismatch</span>}
              {lbMovedBack > 0 && <span className="moved-back-summary-badge"><RotateCcw size={12} /> {lbMovedBack} moved back</span>}
            </div>
            <div className="pm-col-header">
              <span className="tt-col-pin" />
              <span className="tt-col-issue">Issue</span>
              <span className="tt-col-regression">Regression</span>
              <span className="tt-col-priority">Priority</span>
              <span className="tt-col-status">Status</span>
              <span className="tt-col-time">{isAsana ? 'Time / Due Date' : 'Time / Threshold'}</span>
              <span className="tt-col-assignee">Assignee</span>
              <span className="tt-col-chevron" />
            </div>
            <div className="pm-rows-scroll">
              {groupedIssues.map(({ rep: row, all: transitions }) => {
                const isLive    = row.to_state.toLowerCase() === 'in progress'
                const isBlocked = row.to_state.toLowerCase() === 'blocked'
                const movedBack = isMovedBack(row.from_state, row.to_state)
                const isExpanded = expandedRows.has(row.issue_id)
                const isDone    = ['dev','done','mobile done','stage','prod'].includes(row.to_state.toLowerCase())
                const showOverdue = row.overdue && !isDone && !isBlocked
                const hasRegression = transitions.some(t => isMovedBack(t.from_state, t.to_state))
                const ratio = isAsana
                  ? (row.overdue ? 1 : row.duration_in_prev_state_hours != null ? 0.5 : 0)
                  : (row.duration_in_prev_state_hours != null && row.threshold_hours > 0
                      ? Math.min(row.duration_in_prev_state_hours / row.threshold_hours, 1) : 0)
                const barColor = row.overdue ? '#ef4444' : isLive ? '#22c55e' : '#6366f1'
                return (
                  <div key={row.issue_id} className={['pm-row', showOverdue ? 'pm-row-overdue' : '', row.pinned ? 'pm-row-pinned' : '', movedBack ? 'pm-row-movedback' : ''].filter(Boolean).join(' ')}>
                    <div className="pm-row-main" onClick={() => toggleRow(row.issue_id)}>
                      <button className={`tt-pin-btn ${row.pinned ? 'pinned' : ''}`} onClick={e => { e.stopPropagation(); togglePin(row) }} disabled={togglingPin === row.issue_id} title={row.pinned ? 'Unpin' : 'Pin'}>
                        {togglingPin === row.issue_id ? <Loader2 size={12} className="animate-spin" /> : row.pinned ? <Pin size={12} /> : <PinOff size={12} />}
                      </button>
                      <div className="tt-issue">
                        {row.pinned && <Pin size={10} className="tt-pin-indicator" />}
                        <span className="tt-issue-id">{row.issue_id}</span>
                        <span className="tt-issue-summary">{row.issue_summary}</span>
                        {transitions.length > 1 && <span className="tt-transition-count" title={`${transitions.length} transitions`}>{transitions.length}</span>}
                        {blockerIssueIds?.has(row.issue_id) && <span className="do-overdue-chip">⚠ Blocked</span>}
                      </div>
                      <span className="tt-col-regression">
                        {hasRegression && <span className="tt-regression-chip" title="Regression">↩R</span>}
                      </span>
                      <span className={`tt-priority ${priorityBadgeClass(row.priority)}`}>{row.priority || '—'}</span>
                      <span className="tt-col-status">
                        {isBlocked && <span className="tt-badge tt-badge-blocked">⊘ Blocked</span>}
                        {isLive && !showOverdue && !isBlocked && <span className="tt-badge tt-badge-live"><span className="live-dot-pulse" />Live</span>}
                        {showOverdue && <span className="tt-badge tt-badge-overdue"><AlertTriangle size={11} /> Overdue</span>}
                        {movedBack && !showOverdue && !isBlocked && <span className="tt-badge tt-badge-mb"><RotateCcw size={11} /> Back</span>}
                        {!isLive && !isBlocked && !showOverdue && !movedBack && <span className="tt-badge tt-badge-done">✓ Done</span>}
                      </span>
                      <div className="tt-time-bar-wrap">
                        <div className="tt-time-bar">
                          <div className="tt-time-bar-fill" style={{ width: `${ratio * 100}%`, background: barColor }} />
                        </div>
                        <span className="tt-time-label">{formatHours(row.duration_in_prev_state_hours)}
                          {isAsana
                            ? <span className="tt-threshold"> / {row.due_date ? new Date(row.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</span>
                            : <span className="tt-threshold"> / {row.threshold_hours}h</span>
                          }
                        </span>
                      </div>
                      <div className="tt-assignee">
                        {avatarMap[row.assignee] ? <img src={avatarMap[row.assignee]} alt={row.assignee} className="filter-avatar-img" /> : <span className="filter-avatar-placeholder">{(row.assignee || '?').charAt(0).toUpperCase()}</span>}
                        <span className="tt-assignee-name">{row.assignee ? row.assignee.split(' ')[0] : '—'}</span>
                      </div>
                      <ChevronDown size={13} className={`tt-chevron ${isExpanded ? 'open' : ''}`} />
                    </div>
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
        )
      ) : (
        tlLoading && timelines.length === 0 ? (
          <div className="pm-loading-state"><Loader2 size={32} className="animate-spin" /><span>Loading…</span></div>
        ) : tlDisplayed.length === 0 ? (
          <div className="pm-empty-state"><Activity size={40} /><p>No issues found.</p></div>
        ) : (
          <div className="pm-card-list glass-card">
            <div className="pm-list-summary">
              <span>{tlDisplayed.length} of {timelines.length} issues</span>
              {tlOverdueCount > 0 && <span className="overdue-summary-badge"><AlertTriangle size={12} /> {tlOverdueCount} overdue</span>}
              {tlMovedBackCount > 0 && <span className="moved-back-summary-badge"><RotateCcw size={12} /> {tlMovedBackCount} moved back</span>}
            </div>
            <div className="pm-col-header">
              <span className="pm-col-pin" />
              <span className="pm-col-issue">Issue</span>
              <span className="pm-col-priority">Priority</span>
              <span className="pm-col-status">Status</span>
              <span className="pm-col-time">{isAsana ? 'Time / Due Date' : 'Time / Threshold'}</span>
              <span className="pm-col-stints">Stints</span>
              <span className="pm-col-assignee">Assignee</span>
              <span className="pm-col-chevron" />
            </div>
            <div className="pm-rows-scroll">
              {tlDisplayed.map(t => {
                const isExpanded = expandedIssues.has(t.issue_id)
                const lastMovedBackStint = [...t.stints].reverse().find(s => s.moved_back)
                const ratio = isAsana
                  ? (t.is_overdue ? 1 : t.is_live ? 0.5 : 0)
                  : (t.threshold_hours > 0 ? Math.min(t.total_hours / t.threshold_hours, 1) : 0)
                const barColor = t.is_overdue ? '#ef4444' : t.total_hours > t.threshold_hours ? '#f97316' : t.is_live ? '#22c55e' : '#6366f1'
                return (
                  <div key={t.issue_id} className={['pm-row', t.is_overdue ? 'pm-row-overdue' : '', t.is_live ? 'pm-row-live' : '', t.pinned ? 'pm-row-pinned' : ''].filter(Boolean).join(' ')}>
                    <div className="pm-row-main" onClick={() => toggleExpand(t.issue_id)}>
                      <span className="pm-col-pin">
                        {t.pinned && <Pin size={10} className="tt-pin-indicator" />}
                      </span>
                      <div className="pm-col-issue pm-issue-cell">
                        <span className="pm-issue-id">{t.issue_id}</span>
                        <span className="pm-issue-summary">{t.issue_summary}</span>
                        {t.moved_back_count > 0 && <span className="tt-regression-chip" title={`Moved back ${t.moved_back_count}×`}>↩{t.moved_back_count}</span>}
                        {blockerIssueIds?.has(t.issue_id) && <span className="do-overdue-chip">⚠ Blocked</span>}
                      </div>
                      <span className={`pm-col-priority tt-priority ${priorityBadgeClass(t.priority)}`}>{t.priority || '—'}</span>
                      <span className="pm-col-status">
                        {t.is_live && !t.is_overdue && <span className="tt-badge tt-badge-live"><span className="live-dot-pulse" />Live</span>}
                        {t.is_overdue && <span className="tt-badge tt-badge-overdue"><AlertTriangle size={11} /> Overdue</span>}
                        {!t.is_live && !t.is_overdue && <span className="tt-badge tt-badge-done">✓ Done</span>}
                      </span>
                      <div className="pm-col-time tt-time-bar-wrap">
                        <div className="tt-time-bar">
                          <div className="tt-time-bar-fill" style={{ width: `${ratio * 100}%`, background: barColor }} />
                        </div>
                        <span className="tt-time-label">{formatHoursDetailed(t.total_hours)}
                          {isAsana
                            ? <span className="tt-threshold"> / {t.due_date ? new Date(t.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</span>
                            : <span className="tt-threshold"> / {t.threshold_hours}h</span>
                          }
                        </span>
                      </div>
                      <span className="pm-col-stints">
                        {t.total_stints > 1 && <span className="tt-transition-count" title={`${t.total_stints} stints`}>{t.total_stints}</span>}
                      </span>
                      <div className="pm-col-assignee tt-assignee">
                        {t.assignee && (avatarMap[t.assignee] ? <img src={avatarMap[t.assignee]} alt={t.assignee} className="filter-avatar-img" /> : <span className="filter-avatar-placeholder">{t.assignee.charAt(0).toUpperCase()}</span>)}
                        <span className="tt-assignee-name">{t.assignee ? t.assignee.split(' ')[0] : '—'}</span>
                      </div>
                      <ChevronDown size={13} className={`tt-chevron ${isExpanded ? 'open' : ''}`} />
                    </div>
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
                          {isAsana
                            ? <span>Due Date: <strong>{t.due_date ? new Date(t.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</strong></span>
                            : <span>Threshold: <strong>{t.threshold_hours}h</strong></span>
                          }
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
        )
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Deployment Report Tab ───────────────────────────────────────────────────

function YouTrackStageReport() {
  const [columns, setColumns] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [issueCount, setIssueCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingCols, setLoadingCols] = useState(true)

  const fetchColumns = useCallback(async () => {
    setLoadingCols(true)
    try {
      const res = await getStageReportColumns()
      if ((res as any).success && (res as any).data) setColumns((res as any).data)
    } catch {
      setError('Failed to load columns. Check YouTrack connection.')
    } finally {
      setLoadingCols(false)
    }
  }, [])

  useEffect(() => { fetchColumns() }, [fetchColumns])

  const toggleColumn = (col: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })
  }

  const handleGenerate = async () => {
    if (selected.size === 0) return
    setGenerating(true)
    setError(null)
    setReport(null)
    try {
      const res = await generateStageReport([...selected])
      if ((res as any).success && (res as any).data) {
        setReport((res as any).data.report)
        setIssueCount((res as any).data.issue_count)
      } else {
        setError('Generation failed. Try again.')
      }
    } catch {
      setError('Generation failed. Try again.')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = () => {
    if (!report) return
    navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="pm-tab-header">
        <h3 className="pm-section-title"><Rocket size={18} /> Deployment Report</h3>
        <p className="sr-subtitle">Select YouTrack columns, generate a Slack-ready list of fixes for your stage deployment.</p>
      </div>

      <div className="sr-section">
        <div className="sr-section-header">
          <span className="sr-section-title">Select Columns</span>
          <span className="sr-section-hint">Pick one or more columns to include</span>
        </div>
        {loadingCols ? (
          <div className="sr-loading">
            <div className="loading-spinner" />
            <span>Loading columns...</span>
          </div>
        ) : columns.length === 0 ? (
          <div className="sr-empty">No columns found. Ensure YouTrack is connected in Integrations.</div>
        ) : (
          <div className="sr-columns">
            {columns.map(col => (
              <button
                key={col}
                className={`sr-column-pill${selected.has(col) ? ' selected' : ''}`}
                onClick={() => toggleColumn(col)}
              >
                {selected.has(col) && <Check size={12} />}
                {col}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sr-actions">
        <button
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={selected.size === 0 || generating}
        >
          {generating ? <RefreshCw size={15} className="sr-spin" /> : <Rocket size={15} />}
          {generating ? 'Generating...' : 'Generate Report'}
        </button>
        {selected.size > 0 && (
          <span className="sr-selected-hint">{selected.size} column{selected.size > 1 ? 's' : ''} selected</span>
        )}
      </div>

      {error && <div className="sr-error">{error}</div>}

      {report !== null && (
        <div className="sr-result">
          <div className="sr-result-header">
            <span className="sr-result-meta">{issueCount} ticket{issueCount !== 1 ? 's' : ''} included</span>
            <button className="sr-copy-btn" onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {report === '' ? (
            <div className="sr-empty">No tickets found in the selected columns.</div>
          ) : (
            <pre className="sr-report-box">{report}</pre>
          )}
        </div>
      )}
    </>
  )
}

const DEFAULT_SECTIONS: DeploymentSectionConfig[] = [
  { platform: 'UI', header: 'UI', enabled: true },
  { platform: 'Studio', header: 'Studio', enabled: true },
  { platform: 'Mission Control', header: 'Mission Control', enabled: true },
  { platform: 'Backend', header: 'Backend / Platform', enabled: true },
  { platform: 'Uncategorized', header: 'Other', enabled: true },
]

const DR_PAGE_SIZE = 8

function AsanaDeploymentReport() {
  const [activeView, setActiveView] = useState<'report' | 'config'>('report')
  const [tickets, setTickets] = useState<DeploymentTicket[]>([])
  const [botConfig, setBotConfig] = useState<DeploymentBotConfig>({ systemPrompt: '', sections: DEFAULT_SECTIONS })
  const [isFetching, setIsFetching] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [reportReady, setReportReady] = useState(false)
  const [fetchProgress, setFetchProgress] = useState<{ done: number; total: number } | null>(null)
  const [genProgress, setGenProgress] = useState<{ current: number; total: number; retryCountdown: number } | null>(null)
  const [preloadTickets, setPreloadTickets] = useState<LoadedDeploymentTicket[]>([])

  const readyCount = useMemo(() => tickets.filter(t => t.status === 'ready').length, [tickets])
  const sections = botConfig.sections?.length ? botConfig.sections : DEFAULT_SECTIONS

  // ── Fetch tickets (matches DR App.tsx handleFetchTickets exactly) ───────────
  const handleFetch = async (lines: TicketLine[]) => {
    if (!lines.length) return
    setIsFetching(true)
    setReportReady(false)

    // Count lines that need an Asana API call
    const total = lines.filter(l => !(l.title !== null && l.manualDesc !== null)).length
    let done = 0
    setFetchProgress(total > 0 ? { done: 0, total } : null)

    // Add placeholders immediately (status: fetching)
    const placeholders: DeploymentTicket[] = lines.map(({ url, title, manualDesc, gid }) => ({
      url, gid: gid || '', name: title ?? '',
      notes: '', manualDescription: false,
      platform: title ? detectPlatform(title) : ('Uncategorized' as Platform),
      priority: title ? extractPriority(title) : null,
      cleanName: title ? stripPrefix(title) : '',
      fixStatement: null, status: 'fetching' as const,
    }))
    setTickets(prev => {
      const existing = new Set(prev.map(t => t.url))
      return [...prev, ...placeholders.filter(p => !existing.has(p.url))]
    })

    // Fire all fetches concurrently — increment counter as each settles
    const results = await Promise.allSettled(
      lines.map(async ({ url, title, manualDesc, gid }) => {
        // Immediate: title + manualDesc both known — no Asana call needed
        if (title !== null && manualDesc !== null) {
          return { gid: gid || url, name: title, notes: manualDesc, manualDescription: true }
        }

        const afterFetch = () => { done++; setFetchProgress({ done, total }) }

        try {
          const res = await api.getAsanaDeploymentTask(url)
          afterFetch()
          if (!res.success || !res.data) throw new Error('Fetch failed')
          return {
            gid: res.data.gid,
            name: title ?? res.data.name,
            notes: manualDesc ?? res.data.notes,
            manualDescription: !!manualDesc,
          }
        } catch (e) {
          afterFetch()
          throw e
        }
      })
    )

    // Apply results back to tickets array
    setTickets(prev => {
      const updated = [...prev]
      results.forEach((result, i) => {
        const idx = updated.findIndex(t => t.url === lines[i].url)
        if (idx === -1) return
        if (result.status === 'fulfilled') {
          const { gid, name, notes, manualDescription } = result.value
          updated[idx] = {
            ...updated[idx], gid, name, notes, manualDescription,
            platform: detectPlatform(name), priority: extractPriority(name),
            cleanName: stripPrefix(name), fixStatement: null, status: 'ready' as const,
          }
        } else {
          updated[idx] = { ...updated[idx], status: 'error' as const, error: 'Failed to fetch ticket' }
        }
      })
      return updated
    })

    setIsFetching(false)
    setFetchProgress(null)
  }

  // Load from ProjectBrowser → populate textarea only; user edits then clicks Fetch Tickets
  const handleProjectLoad = (loaded: LoadedDeploymentTicket[]) => {
    setTickets([])
    setReportReady(false)
    setPreloadTickets(loaded)
  }

  // ── Generate fix statements (matches DR App.tsx handleGenerateReport) ───────
  const handleGenerate = async () => {
    const toGenerate = tickets.filter(t => t.status === 'ready' && t.gid)
    if (!toGenerate.length) return

    setIsGenerating(true)
    setReportReady(false)

    const makeBatches = (list: typeof toGenerate) => {
      const batches: typeof toGenerate[] = []
      for (let i = 0; i < list.length; i += DR_PAGE_SIZE) batches.push(list.slice(i, i + DR_PAGE_SIZE))
      return batches
    }
    const pages = makeBatches(toGenerate)
    setGenProgress({ current: 0, total: pages.length, retryCountdown: 0 })

    // Mark all as generating
    setTickets(prev => prev.map(t =>
      toGenerate.find(g => g.gid === t.gid) ? { ...t, status: 'generating' as const } : t
    ))

    // Local set — never read React state mid-async
    const resolvedGids = new Set<string>()

    const countdown = async (secs: number, pageIdx: number, total: number) => {
      for (let s = secs; s > 0; s--) {
        setGenProgress({ current: pageIdx, total, retryCountdown: s })
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    const runBatch = async (batch: typeof toGenerate, pageIdx: number, total: number) => {
      setGenProgress({ current: pageIdx, total, retryCountdown: 0 })
      const inputs = batch.map(t => ({
        gid: t.gid, name: t.name, notes: t.notes, manualDescription: t.manualDescription,
      }))
      try {
        const res = await api.generateAsanaDeploymentReport(inputs)
        if (res.success && res.data) {
          res.data.results.forEach(r => { if (r.fixStatement) resolvedGids.add(r.gid) })
          setTickets(prev => prev.map(t => {
            const result = res.data!.results.find(r => r.gid === t.gid)
            if (!result?.fixStatement) return t
            return { ...t, fixStatement: result.fixStatement, status: 'ready' as const }
          }))
          const waitSecs = (res.data as any).retryAfter ?? 0
          if (waitSecs > 0 && pageIdx < total - 1) {
            await countdown(waitSecs, pageIdx + 1, total)
          }
        } else if (pageIdx < total - 1) {
          await countdown(5, pageIdx + 1, total)
        }
      } catch (err: any) {
        const is429 = err?.response?.status === 429 || err?.status === 429
        if (pageIdx < total - 1) {
          await countdown(is429 ? 10 : 5, pageIdx + 1, total)
        }
      }
      setGenProgress({ current: pageIdx + 1, total, retryCountdown: 0 })
    }

    for (const [i, batch] of pages.entries()) {
      await runBatch(batch, i, pages.length)
    }

    // Auto-retry unresolved (up to 3 passes)
    const MAX_RETRIES = 3
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const remaining = toGenerate.filter(t => !resolvedGids.has(t.gid))
      if (remaining.length === 0) break
      await countdown(8, 0, Math.ceil(remaining.length / DR_PAGE_SIZE))
      for (const [i, batch] of makeBatches(remaining).entries()) {
        await runBatch(batch, i, Math.ceil(remaining.length / DR_PAGE_SIZE))
      }
    }

    // Revert any still-generating tickets back to 'ready' (never show error)
    setTickets(prev => prev.map(t =>
      t.status === 'generating' ? { ...t, status: 'ready' as const } : t
    ))

    setIsGenerating(false)
    setGenProgress(null)
    setReportReady(true)
  }

  const handleClearAll = () => {
    setTickets([])
    setReportReady(false)
    setPreloadTickets([])
  }

  const genButtonLabel = () => {
    if (!isGenerating) return <><Rocket size={14} /> Generate Report ({readyCount} tickets)</>
    if (genProgress) {
      if (genProgress.retryCountdown > 0) {
        return <><Loader2 size={14} className="animate-spin" /> Rate limited — resuming in {genProgress.retryCountdown}s…</>
      }
      return <><Loader2 size={14} className="animate-spin" /> Batch {genProgress.current + 1} of {genProgress.total}…</>
    }
    return <><Loader2 size={14} className="animate-spin" /> Generating…</>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <nav className="dr-tab-bar">
        <button className={`dr-tab${activeView === 'report' ? ' dr-tab--active' : ''}`} onClick={() => setActiveView('report')}>Report</button>
        <button className={`dr-tab${activeView === 'config' ? ' dr-tab--active' : ''}`} onClick={() => setActiveView('config')}>Bot Config</button>
      </nav>

      {activeView === 'config' ? (
        <DeploymentBotConfigPanel onConfigChange={setBotConfig} />
      ) : (
        <>
          {/* Step 1: ProjectBrowser + TicketInput (combined, like DR) */}
          <div className="dr-card">
            <div className="dr-step-label"><span className="dr-step-num">1</span>Paste Asana ticket URLs</div>
            <DeploymentProjectBrowser onLoad={handleProjectLoad} isLoading={isFetching} />
            <hr className="dr-divider" />
            <DeploymentTicketInput onFetch={handleFetch} isLoading={isFetching} preloadTickets={preloadTickets} />
            {isFetching && fetchProgress && (
              <div className="dr-gen-progress" style={{ marginTop: '0.6rem' }}>
                <div className="dr-progress-track">
                  <div className="dr-progress-fill" style={{ width: `${Math.round((fetchProgress.done / fetchProgress.total) * 100)}%` }} />
                </div>
                <span className="dr-progress-label">Fetching tickets… {fetchProgress.done}/{fetchProgress.total}</span>
              </div>
            )}
          </div>

          {/* Step 2: Ticket list + Generate (like DR) */}
          {tickets.length > 0 && (
            <div className="dr-card">
              <div className="dr-step-label"><span className="dr-step-num">2</span>Review fetched tickets</div>
              <DeploymentTicketList tickets={tickets} />

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleGenerate}
                  disabled={isGenerating || readyCount === 0}
                >
                  {genButtonLabel()}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={handleClearAll} disabled={isGenerating}>
                  Clear All
                </button>
              </div>

              {isGenerating && genProgress && (
                <div className="dr-gen-progress" style={{ marginTop: '0.6rem' }}>
                  <div className="dr-progress-track">
                    <div className="dr-progress-fill" style={{ width: `${Math.round((genProgress.current / genProgress.total) * 100)}%` }} />
                  </div>
                  {genProgress.retryCountdown > 0
                    ? <span className="dr-progress-countdown">Rate limit reached — resuming in {genProgress.retryCountdown}s</span>
                    : <span className="dr-progress-label">Batch {genProgress.current + 1} of {genProgress.total} · {DR_PAGE_SIZE} tickets per batch</span>
                  }
                </div>
              )}
            </div>
          )}

          {/* Step 3: Report preview + export (like DR) */}
          {reportReady && (
            <div className="dr-card">
              <div className="dr-step-label"><span className="dr-step-num">3</span>Export deployment report</div>
              <DeploymentExportButtons tickets={tickets} sections={sections} disabled={!reportReady} />
              <hr className="dr-divider" />
              <DeploymentReportPreview tickets={tickets} sections={sections} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DeploymentReportTab() {
  const isAsana = getActiveSource() === 'asana'

  return (
    <div className="pm-tab-content sr-panel">
      {isAsana ? (
        <>
          <div className="pm-tab-header">
            <h3 className="pm-section-title"><Rocket size={18} /> Deployment Report</h3>
            <p className="sr-subtitle">Generate a client-ready deployment report from Asana tickets with AI-polished fix statements.</p>
          </div>
          <AsanaDeploymentReport />
        </>
      ) : (
        <YouTrackStageReport />
      )}
    </div>
  )
}

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

  useEffect(() => { setActiveTab(initialTab) }, [initialTab])

  return (
    <div className="pm-reports-page">
      <div className="pm-reports-container">
        <div className="pm-tab-bar glass-card">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button key={tab.id} className={`pm-tab-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => handleTabChange(tab.id)}>
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
        <div className={`pm-tab-panel glass-card${activeTab === 'daily' ? ' pm-tab-panel--daily' : ''}`}>
          {activeTab === 'daily'      && <DailyReportTab />}
          {activeTab === 'assignees'  && <AssigneeStatsTab />}
          {activeTab === 'tracking'   && <TrackingTab blockerIssueIds={blockerIssueIds} />}
          {activeTab === 'dailyops'   && <DailyOpsTab onBlockersChange={setBlockerIssueIds} />}
          {activeTab === 'deployment' && <DeploymentReportTab />}
        </div>
      </div>
    </div>
  )
}
