import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import DeploymentProjectBrowser from '../components/deployment/DeploymentProjectBrowser'
import DeploymentTicketInput from '../components/deployment/DeploymentTicketInput'
import DeploymentTicketList from '../components/deployment/DeploymentTicketList'
import DeploymentReportPreview from '../components/deployment/DeploymentReportPreview'
import DeploymentExportButtons from '../components/deployment/DeploymentExportButtons'
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
import type { IssueTimeline, IssueStint, YouTrackSprint, SprintBoardColumn, SprintBoardIssue } from '../services/api'
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

    const activeSprintId = localStorage.getItem('pm_active_sprint_id') || undefined
    const activeSprintName = localStorage.getItem('pm_active_sprint_name') || undefined
    const doQuery = () => pmAssistantQuery(text, historyWithoutLast, activeSprintId, activeSprintName)

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

function DailyReportTab({ sprintId, sprintName }: {
  sprintId?: string
  sprintName?: string
}) {
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
  const [ytPrioritiesList, setYtPrioritiesList] = useState<{ name: string; background?: string; foreground?: string }[]>([])
  const [cfgSprintId, setCfgSprintId] = useState<string | undefined>(sprintId)
  const [cfgSprintName, setCfgSprintName] = useState<string | undefined>(sprintName)
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
    // Priorities
    import('../services/pmDataService').then(({ getPMPriorities }) => {
      getPMPriorities().then(res => {
        if ((res as any).success && (res as any).data) {
          const data = (res as any).data as Array<{ name: string; background?: string; foreground?: string }>
          if (Array.isArray(data) && data.length > 0)
            setYtPrioritiesList(data.map(p => ({ name: p.name, background: p.background, foreground: p.foreground })))
        }
      }).catch(() => {})
    })
  }, [])

  // Sync page-level sprint prop into cfg state
  useEffect(() => {
    setCfgSprintId(sprintId)
    setCfgSprintName(sprintName)
  }, [sprintId, sprintName])

  // Load Open States dynamically — board columns when sprint selected, all states otherwise
  useEffect(() => {
    setCfgOpenStates([])
    if (cfgSprintId) {
      import('../services/pmDataService').then(({ getPMDefaultBoardColumns }) => {
        getPMDefaultBoardColumns().then(res => {
          if ((res as any).success && (res as any).data) {
            const cols = (res as any).data as Array<{ name: string; fieldValues: string[] }>
            const seen = new Set<string>()
            const states: string[] = []
            cols.forEach(col => col.fieldValues.forEach(v => {
              if (!seen.has(v)) { seen.add(v); states.push(v) }
            }))
            setYtStatesList(states)
          }
        }).catch(() => {})
      })
    } else {
      import('../services/pmDataService').then(({ getPMStates }) => {
        getPMStates().then(res => {
          if ((res as any).success && (res as any).data)
            setYtStatesList(((res as any).data as Array<{ name: string }>).map((s: { name: string }) => s.name))
        }).catch(() => {})
      })
    }
  }, [cfgSprintId])

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
        ? await generatePMReport(date, reportScope, overrides, cfgSprintId, cfgSprintName)
        : await generateWeeklyPMReport(weekStart as any, reportScope, overrides, cfgSprintId, cfgSprintName)
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
              // Build priority list: use YouTrack colors if available, fall back to workflow config
              const wfColorMap: Record<string, string> = {}
              ;(wfConfig?.priority_tags ?? []).forEach(t => { wfColorMap[t.label] = t.color })
              const fallbackColors: Record<string, string> = { P0:'#ef4444', P1:'#f97316', P2:'#eab308', P3:'#6366f1', A0:'#8b5cf6', A1:'#06b6d4' }
              const basePriorities: { label: string; color: string }[] = ytPrioritiesList.length > 0
                ? ytPrioritiesList.map(p => ({ label: p.name, color: p.background ?? wfColorMap[p.name] ?? fallbackColors[p.name] ?? '#94a3b8' }))
                : (wfConfig?.priority_tags ?? [{label:'P0',color:'#ef4444'},{label:'P1',color:'#f97316'},{label:'P2',color:'#eab308'},{label:'P3',color:'#6366f1'}])
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
                          <div className="pm-config-chips pm-config-chips--scroll">
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

function AssigneeStatsTab({ sprintId }: { sprintId?: string }) {
  const [stats, setStats] = useState<AssigneeStat[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({})

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getAssigneeStats(sprintId)
      setStats((res as any).data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [sprintId])

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

      {loading && stats.length === 0 ? (() => {
        const sk = (w: number | string, h: number, r = 5) => <div className="skeleton" style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }} />
        const nameW = ['72%','58%','80%','65%','50%','75%','62%','70%','55%','68%']
        const barW  = [72, 45, 88, 55, 63, 78, 40, 95, 50, 67]
        return (
          <div className="pm-card-list glass-card">
            <div className="pm-list-summary">{sk(110, 13, 4)}</div>
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
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="pm-row">
                  <div className="pm-row-main" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 0.75rem', cursor: 'default' }}>
                    <div className="pm-col-as-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {sk(28, 28, '50%')}{sk(nameW[i % nameW.length], 12, 4)}
                    </div>
                    <span className="pm-col-as-stat">{sk(22, 18, 10)}</span>
                    <span className="pm-col-as-stat">{sk(22, 18, 10)}</span>
                    <span className="pm-col-as-stat">{sk(22, 18, 10)}</span>
                    <span className="pm-col-as-stat">{sk(22, 18, 10)}</span>
                    <span className="pm-col-as-avg">{sk(50, 12, 4)}</span>
                    <span className="pm-col-as-workload">
                      <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.06)', width: '100%', overflow: 'hidden' }}>
                        <div className="skeleton" style={{ height: '100%', width: `${barW[i % barW.length]}%`, borderRadius: 4 }} />
                      </div>
                    </span>
                    <span className="pm-col-chevron" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()
      : stats.length === 0 ? (
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

// ─── Tab: Tracking (Sprint Column-Section View) ──────────────────────────────

function fmtHoursCompact(h: number): string {
  if (h <= 0) return '0h'
  const d = Math.floor(h / 24)
  const hrs = Math.floor(h % 24)
  if (d > 0) return `${d}d ${hrs}h`
  return `${hrs}h`
}

function getInitialsFromName(name: string): string {
  return (name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function ttPriorityClass(p: string): string {
  const s = (p || '').toLowerCase()
  if (s === 'p0' || s.includes('critical') || s.includes('show-stopper')) return 'tt-pri tt-pri-p0'
  if (s === 'p1' || s.includes('major')) return 'tt-pri tt-pri-p1'
  if (s === 'p2' || s.includes('normal') || s.includes('medium')) return 'tt-pri tt-pri-p2'
  return 'tt-pri tt-pri-p3'
}

function TrackingTab({ blockerIssueIds, sprintId }: { blockerIssueIds?: Set<string>; sprintId?: string }) {
  const [boardColumns, setBoardColumns] = useState<SprintBoardColumn[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [filterAssignee, setFilterAssignee] = useState('')
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({})
  const assigneeRef = useRef<HTMLDivElement>(null)

  // ── Data fetching ─────────────────────────────────────────────────────────

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchBoardStatus = useCallback(async () => {
    if (!sprintId) { setBoardColumns([]); return }
    setLoading(true)
    setError(null)
    try {
      const res = await api.getSprintBoardStatus({ sprint_id: sprintId })
      setBoardColumns((res as any).data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sprint board status')
    } finally {
      setLoading(false)
    }
  }, [sprintId])

  useEffect(() => { fetchBoardStatus() }, [fetchBoardStatus])
  useEffect(() => { getAvatarMap().then(setAvatarMap) }, [])

  // ── Close assignee dropdown on outside click ──────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node))
        setAssigneeOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Action handlers ───────────────────────────────────────────────────────
  const runReconcile = async () => {
    setReconciling(true); setStatusMsg(null)
    try {
      const res = await api.reconcileStateLog()
      const d = res.data
      setStatusMsg(`Reconcile: ${d?.reconciled ?? 0} exit rows inserted, ${d?.skipped ?? 0} up-to-date.`)
    } catch (err) { setStatusMsg(`Reconcile failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally { setReconciling(false) }
  }
  const runImportHistory = async () => {
    setImporting(true); setStatusMsg(null)
    try {
      const res = await api.importHistory()
      const d = res.data
      setStatusMsg(`Sync done: ${d?.inserted ?? 0} transitions inserted. ${d?.skipped ?? 0} already existed.`)
      fetchBoardStatus()
    } catch (err) { setStatusMsg(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally { setImporting(false) }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const allAssignees = useMemo(() => {
    const s = new Set<string>()
    boardColumns.forEach(col => col.issues.forEach(i => { if (i.assignee) s.add(i.assignee) }))
    return Array.from(s).sort()
  }, [boardColumns])

  const filteredColumns = useMemo(() => {
    if (!filterAssignee) return boardColumns
    return boardColumns
      .map(col => ({ ...col, issues: col.issues.filter(i => i.assignee === filterAssignee) }))
      .filter(col => col.issues.length > 0)
  }, [boardColumns, filterAssignee])

  return (
    <div className="pm-tab-content pm-tracking-tab">
      {/* ── Header ── */}
      <div className="pm-tracking-header">
        <h3 className="pm-section-title"><Activity size={16} /> Tracking</h3>
        <div className="pm-tracking-controls">
          {/* Assignee filter */}
          {allAssignees.length > 0 && (
            <div className="pm-custom-dropdown" ref={assigneeRef}>
              <button className="pm-custom-dropdown-trigger" onClick={() => setAssigneeOpen(o => !o)}>
                <span>{filterAssignee || 'All Assignees'}</span>
                <ChevronDown size={11} className={`dropdown-chevron ${assigneeOpen ? 'open' : ''}`} />
              </button>
              {assigneeOpen && (
                <div className="pm-custom-dropdown-menu">
                  <button className={`pm-dropdown-item ${!filterAssignee ? 'active' : ''}`}
                    onClick={() => { setFilterAssignee(''); setAssigneeOpen(false) }}>All Assignees</button>
                  {allAssignees.map(a => (
                    <button key={a} className={`pm-dropdown-item ${filterAssignee === a ? 'active' : ''}`}
                      onClick={() => { setFilterAssignee(a); setAssigneeOpen(false) }}>{a}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="btn-secondary btn-sm" onClick={runReconcile} disabled={reconciling || loading}
            title="Reconcile: close any In Progress entries whose ticket has since moved">
            {reconciling ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            {reconciling ? 'Reconciling…' : 'Reconcile'}
          </button>
          <button className="btn-primary btn-sm" onClick={runImportHistory} disabled={importing || loading}>
            {importing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {importing ? 'Syncing…' : 'Import History'}
          </button>
          <button className="btn-secondary btn-sm" onClick={fetchBoardStatus} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="pm-backfill-msg">{statusMsg}</div>
      )}
      {error && <div className="pm-report-error"><AlertTriangle size={14} />{error}</div>}

      {!sprintId && (
        <div className="pm-empty-state">
          <Activity size={36} />
          <p>Select a sprint to view board status</p>
        </div>
      )}

      {sprintId && loading && (
        <div className="pm-empty-state">
          <Loader2 size={28} className="animate-spin" />
          <p>Loading board status…</p>
        </div>
      )}

      {sprintId && !loading && filteredColumns.length === 0 && !error && (
        <div className="pm-empty-state">
          <Activity size={36} />
          <p>No issues found for this sprint.</p>
          <p style={{ fontSize: '0.8rem' }}>Try clicking <strong>Import History</strong> to sync transitions.</p>
        </div>
      )}

      {/* ── Column sections ── */}
      <div className="pm-tracking-board">
        {filteredColumns.map(col => (
          <div key={col.name} className="pm-tracking-column-section">
            <div className="pm-tracking-col-header">
              <span className="pm-tracking-col-name">{col.name}</span>
              <span className="pm-tracking-col-count">{col.issues.length}</span>
              {col.issues.filter(i => i.is_delayed).length > 0 && (
                <span className="pm-tracking-col-delayed">
                  <AlertTriangle size={11} /> {col.issues.filter(i => i.is_delayed).length} delayed
                </span>
              )}
            </div>
            {col.issues.map(issue => {
              const avatarUrl = avatarMap[issue.assignee]
              return (
                <div key={issue.id} className={`pm-tracking-issue-row${issue.is_delayed ? ' pm-tracking-issue-row--delayed' : ''}${blockerIssueIds?.has(issue.idReadable) ? ' pm-tracking-issue-row--blocked' : ''}`}>
                  <span className="pm-tracking-issue-id">{issue.idReadable || issue.id}</span>
                  <span className={ttPriorityClass(issue.priority)}>{issue.priority}</span>
                  <span className="pm-tracking-issue-summary" title={issue.summary}>{issue.summary}</span>
                  <span className={`pm-tracking-time${issue.is_delayed ? ' pm-tracking-time--overdue' : ''}`}>
                    {fmtHoursCompact(issue.hours_in_state)}
                    {issue.is_delayed && <AlertTriangle size={10} style={{ marginLeft: 3 }} />}
                  </span>
                  {issue.assignee && (
                    <div className="pm-tracking-assignee" title={issue.assignee}>
                      {avatarUrl
                        ? <img className="pm-tracking-avatar" src={avatarUrl} alt={issue.assignee} />
                        : <div className="pm-tracking-avatar pm-tracking-avatar--initials">{getInitialsFromName(issue.assignee)}</div>
                      }
                    </div>
                  )}
                  {issue.issue_type && (
                    <span className={`pm-tracking-type-badge pm-tracking-type-badge--${issue.issue_type.toLowerCase()}`}>
                      {issue.issue_type}
                    </span>
                  )}
                  {issue.move_type === 'qa_rejected' && (
                    <span className="pm-tracking-move-badge pm-tracking-move-badge--qa">QA Rejected</span>
                  )}
                  {issue.move_type === 'dev_stalled' && (
                    <span className="pm-tracking-move-badge pm-tracking-move-badge--dev">Dev Stalled</span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
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
        {loadingCols ? (() => {
          const sk = (w: number, h: number, r = 5) => <div className="skeleton" style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }} />
          const pillW = [88, 110, 72, 95, 80, 65, 105, 78, 92, 60, 85, 70]
          return (
            <div className="sr-columns" style={{ pointerEvents: 'none' }}>
              {pillW.map((w, i) => sk(w, 32, 20))}
            </div>
          )
        })()
        : columns.length === 0 ? (
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

async function drRequestNotificationPermission(): Promise<void> {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') await Notification.requestPermission()
}

function drShowCompletionNotification(succeeded: number, failed: number) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const body = failed > 0
    ? `${succeeded} fix statements generated, ${failed} failed.`
    : `All ${succeeded} fix statements generated successfully.`
  new Notification('Deployment Report Ready', { body, icon: '/favicon.ico', tag: 'deployment-report-done' })
}

function AsanaDeploymentReport() {
  const [tickets, setTickets] = useState<DeploymentTicket[]>([])
  const [botConfig, setBotConfig] = useState<DeploymentBotConfig>({ systemPrompt: '', sections: DEFAULT_SECTIONS })
  const [isFetching, setIsFetching] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [reportReady, setReportReady] = useState(false)

  const [fetchProgress, setFetchProgress] = useState<{ done: number; total: number } | null>(null)
  const [genProgress, setGenProgress] = useState<{ current: number; total: number; retryCountdown: number } | null>(null)
  const [preloadTickets, setPreloadTickets] = useState<LoadedDeploymentTicket[]>([])

  useEffect(() => {
    api.getAsanaDeploymentConfig().then(res => {
      if (res.success && res.data) setBotConfig(res.data)
    }).catch(() => {})
  }, [])

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

    // Request notification permission inside user gesture (required by browsers)
    drRequestNotificationPermission()

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

    let totalSucceeded = 0
    let totalFailed = 0

    const retriedPages = new Set<number>()

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const page = pages[pageIdx]
      setGenProgress({ current: pageIdx, total: pages.length, retryCountdown: 0 })

      try {
        const res = await api.generateAsanaDeploymentReport(
          page.map(t => ({ gid: t.gid, name: t.name, notes: t.notes, manualDescription: t.manualDescription }))
        )

        if (res.success && res.data) {
          setTickets(prev => prev.map(t => {
            const result = res.data!.results.find(r => r.gid === t.gid)
            if (!result) return t
            if (result.fixStatement) {
              totalSucceeded++
              return { ...t, fixStatement: result.fixStatement, status: 'ready' as const }
            }
            totalFailed++
            return { ...t, status: 'ready' as const }
          }))

          const waitSecs = res.data.retryAfter ?? 0
          if (waitSecs > 0 && !retriedPages.has(pageIdx)) {
            // Rate limited — countdown then retry this batch once
            retriedPages.add(pageIdx)
            for (let s = waitSecs; s > 0; s--) {
              setGenProgress({ current: pageIdx, total: pages.length, retryCountdown: s })
              await new Promise(r => setTimeout(r, 1000))
            }
            pageIdx-- // re-run this page in the next iteration
          }
        }
      } catch (err: any) {
        const is429 = err?.response?.status === 429 || err?.status === 429
        const pageGids = new Set(page.map(t => t.gid))
        setTickets(prev => prev.map(t =>
          pageGids.has(t.gid) && t.status === 'generating' ? { ...t, status: 'ready' as const } : t
        ))
        totalFailed += page.length
        if (is429 && !retriedPages.has(pageIdx)) {
          retriedPages.add(pageIdx)
          for (let s = 10; s > 0; s--) {
            setGenProgress({ current: pageIdx, total: pages.length, retryCountdown: s })
            await new Promise(r => setTimeout(r, 1000))
          }
          pageIdx--
        }
      }

      setGenProgress({ current: pageIdx + 1, total: pages.length, retryCountdown: 0 })
    }

    // Revert any still-generating tickets back to 'ready' (never show error)
    setTickets(prev => prev.map(t =>
      t.status === 'generating' ? { ...t, status: 'ready' as const } : t
    ))

    setIsGenerating(false)
    setGenProgress(null)
    setReportReady(true)
    drShowCompletionNotification(totalSucceeded, totalFailed)
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
        return <><Loader2 size={14} className="animate-spin" /> Cooking up brilliance… resuming in {genProgress.retryCountdown}s</>
      }
      return <><Loader2 size={14} className="animate-spin" /> Batch {genProgress.current + 1} of {genProgress.total}…</>
    }
    return <><Loader2 size={14} className="animate-spin" /> Generating…</>
  }


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
                    ? <span className="dr-progress-countdown">✦ Hang tight — crafting your report… resuming in {genProgress.retryCountdown}s</span>
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

const SPRINT_ID_KEY = 'pm_active_sprint_id'
const SPRINT_NAME_KEY = 'pm_active_sprint_name'

function fmtSprintDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function PMReportsPage({ initialTab = 'tracking', onTabChange }: PMReportsPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const [blockerIssueIds, setBlockerIssueIds] = useState<Set<string>>(new Set())

  // ── Sprint state ────────────────────────────────────────────────────────────
  const [sprints, setSprints] = useState<YouTrackSprint[]>([])
  const [activeSprint, setActiveSprint] = useState<YouTrackSprint | null>(null)
  const [sprintDropdownOpen, setSprintDropdownOpen] = useState(false)
  const sprintDropdownRef = useRef<HTMLDivElement>(null)
  const sprintMenuRef = useRef<HTMLDivElement>(null)
  const isYouTrack = getActiveSource() === 'youtrack'

  useEffect(() => {
    if (!isYouTrack) return
    api.getYouTrackSprints().then(res => {
      const list = ((res as any).data as YouTrackSprint[]) ?? []
      setSprints(list)
      const now = Date.now()
      const active = list
        .filter(s => !s.isCompleted && s.finish > now)
        .sort((a, b) => a.finish - b.finish)[0] ?? null
      setActiveSprint(active)
      localStorage.setItem(SPRINT_ID_KEY, active?.id ?? '')
      localStorage.setItem(SPRINT_NAME_KEY, active?.name ?? '')
    }).catch(() => {})
  }, [isYouTrack])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      const insideTrigger = sprintDropdownRef.current?.contains(target)
      const insideMenu = sprintMenuRef.current?.contains(target)
      if (!insideTrigger && !insideMenu) setSprintDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSprintChange = (sprint: YouTrackSprint | null) => {
    setActiveSprint(sprint)
    setSprintDropdownOpen(false)
    localStorage.setItem(SPRINT_ID_KEY, sprint?.id ?? '')
    localStorage.setItem(SPRINT_NAME_KEY, sprint?.name ?? '')
  }

  const sortedSprints = [...sprints].sort((a, b) => b.finish - a.finish)

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab)
    onTabChange?.(tab)
  }

  useEffect(() => { setActiveTab(initialTab) }, [initialTab])

  return (
    <div className="pm-reports-page">
      <div className="pm-reports-container">
        <div style={{ display: 'flex', alignItems: 'flex-end', overflow: 'visible' }}>
          <div className="pm-tab-bar glass-card" style={{ flex: 1, marginBottom: 0 }}>
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
          {isYouTrack && (
            <div ref={sprintDropdownRef} style={{ position: 'relative', paddingBottom: '0.5rem', paddingLeft: 8, flexShrink: 0 }}>
              <button
                onClick={() => setSprintDropdownOpen(o => !o)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}
              >
                <GitBranch size={13} />
                {activeSprint
                  ? <>{activeSprint.name} <span style={{ opacity: 0.55, fontWeight: 400, marginLeft: 3 }}>{fmtSprintDate(activeSprint.start)}–{fmtSprintDate(activeSprint.finish)}</span></>
                  : <span>All sprints</span>
                }
                <ChevronDown size={12} style={{ opacity: 0.5 }} />
              </button>
              {sprintDropdownOpen && createPortal(
                <div
                  ref={sprintMenuRef}
                  className="pm-custom-dropdown-menu"
                  style={{
                    position: 'fixed',
                    top: (sprintDropdownRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                    left: (sprintDropdownRef.current?.getBoundingClientRect().right ?? 0) - 220,
                    minWidth: 220,
                    zIndex: 9999,
                  }}
                >
                  <button className={`pm-dropdown-item${!activeSprint ? ' active' : ''}`} onClick={() => handleSprintChange(null)}>
                    <span style={{ width: 13, display: 'inline-flex', alignItems: 'center' }}>{!activeSprint && <Check size={12} />}</span>
                    All sprints
                  </button>
                  {sortedSprints.length === 0 && (
                    <div style={{ padding: '9px 14px', fontSize: 13, opacity: 0.5 }}>No sprints found</div>
                  )}
                  {sortedSprints.map(s => (
                    <button
                      key={s.id}
                      className={`pm-dropdown-item${activeSprint?.id === s.id ? ' active' : ''}`}
                      onClick={() => handleSprintChange(s)}
                      style={{ opacity: s.isCompleted ? 0.6 : 1 }}
                    >
                      <span style={{ width: 13, display: 'inline-flex', alignItems: 'center' }}>{activeSprint?.id === s.id && <Check size={12} />}</span>
                      <span style={{ flex: 1 }}>{s.name}</span>
                      <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 8 }}>{fmtSprintDate(s.start)}–{fmtSprintDate(s.finish)}</span>
                      {s.isCompleted && <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 4 }}>✓</span>}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>
          )}
        </div>
        <div className={`pm-tab-panel glass-card${activeTab === 'daily' ? ' pm-tab-panel--daily' : ''}`}>
          {activeTab === 'daily'      && <DailyReportTab sprintId={activeSprint?.id} sprintName={activeSprint?.name} />}
          {activeTab === 'assignees'  && <AssigneeStatsTab sprintId={activeSprint?.id} />}
          {activeTab === 'tracking'   && <TrackingTab blockerIssueIds={blockerIssueIds} sprintId={activeSprint?.id} />}
          {activeTab === 'dailyops'   && <DailyOpsTab onBlockersChange={setBlockerIssueIds} sprintId={activeSprint?.id} />}
          {activeTab === 'deployment' && <DeploymentReportTab />}
        </div>
      </div>
    </div>
  )
}
