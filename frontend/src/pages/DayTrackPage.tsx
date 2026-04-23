import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { dayTrackApi, type DayTrackEntry, type DayTrackPlanned } from '../services/api'
import '../styles/pages/daytrack.css'

// ── Helpers ────────────────────────────────────────────────────────────────────

const PALETTE = ['#6366f1','#10b981','#8b5cf6','#f59e0b','#06b6d4','#ec4899','#f97316','#ef4444','#84cc16','#14b8a6']
const DEFAULT_CATS = ['Development','Testing','Meetings','Breaks','Review','Research']

function catColor(cat: string, cats: string[]): string {
  const fixed: Record<string,string> = {
    Development: '#6366f1', Testing: '#10b981', Meetings: '#8b5cf6',
    Breaks: '#f59e0b', Review: '#06b6d4', Research: '#ec4899',
  }
  if (fixed[cat]) return fixed[cat]
  const idx = cats.indexOf(cat)
  return PALETTE[((idx < 0 ? 0 : idx)) % PALETTE.length]
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtDate(d: Date): string {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function to12h(hhmm: string): string {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return hhmm
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function to24h(time12: string): string {
  if (!time12) return ''
  const match = time12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return time12
  let h = parseInt(match[1])
  const m = match[2]
  const ampm = match[3].toUpperCase()
  if (ampm === 'AM' && h === 12) h = 0
  if (ampm === 'PM' && h !== 12) h += 12
  return `${String(h).padStart(2, '0')}:${m}`
}

function nowHHMM(): string {
  const n = new Date()
  return to12h(`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`)
}

function timeToMins(t: string): number {
  if (!t) return 0
  const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (match) {
    let h = parseInt(match[1])
    const m = parseInt(match[2])
    const ampm = match[3].toUpperCase()
    if (ampm === 'AM' && h === 12) h = 0
    if (ampm === 'PM' && h !== 12) h += 12
    return h * 60 + m
  }
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function addMinute(time12: string): string {
  const mins = timeToMins(time12)
  const total = mins + 1
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return to12h(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`)
}

function calcDuration(s: string, e: string): number | null {
  if (!s || !e) return null
  let diff = timeToMins(e) - timeToMins(s)
  if (diff < 0) diff += 24 * 60
  return diff > 0 ? diff : null
}

function minsLabel(m: number | null | undefined): string {
  if (m == null) return '—'
  const h = Math.floor(m / 60), min = m % 60
  return h > 0 ? `${h}h ${min}m` : `${min}m`
}

// ── Toast ──────────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'info' | 'warn'
interface Toast { id: number; msg: string; type: ToastType }

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  const icon = (t: ToastType) => {
    if (t === 'success') return <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
    if (t === 'warn')    return <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
    return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
  }
  return (
    <div className="dt-toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`dt-toast dt-toast--${t.type}`}>
          {icon(t.type)}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

// ── Month picker ──────────────────────────────────────────────────────────────

function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => value ? parseInt(value.slice(0, 4)) : new Date().getFullYear())
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !dropRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const fmtDisplay = (v: string) => {
    if (!v) return 'Select month'
    const [y, m] = v.split('-')
    return `${months[parseInt(m) - 1]} ${y}`
  }

  return (
    <div className="form-group">
      <label className="form-label">Select Month</label>
      <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
        <button ref={triggerRef} className="dr-cal-trigger" style={{ width: '100%', justifyContent: 'flex-start' }}
          onClick={() => {
            if (triggerRef.current) {
              const r = triggerRef.current.getBoundingClientRect()
              setPos({ top: r.bottom + 6, left: r.left })
            }
            if (value) setYear(parseInt(value.slice(0, 4)))
            setOpen(o => !o)
          }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <span>{fmtDisplay(value)}</span>
        </button>
        {open && pos && createPortal(
          <div ref={dropRef} className="dr-cal-dropdown glass-card"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: 240, padding: 12 }}>
            <div className="calendar-nav">
              <button onClick={() => setYear(y => y - 1)}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <span className="calendar-month-label">{year}</span>
              <button onClick={() => setYear(y => y + 1)}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
            <div className="dt-month-grid">
              {months.map((m, i) => {
                const val = `${year}-${String(i + 1).padStart(2, '0')}`
                const isSelected = val === value
                const isCurrent = val === toDateStr(new Date()).slice(0, 7)
                return (
                  <button key={m}
                    className={`dt-month-cell${isSelected ? ' selected' : ''}${isCurrent ? ' today' : ''}`}
                    onClick={() => { onChange(val); setOpen(false) }}>
                    {m}
                  </button>
                )
              })}
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}

// ── Reusable calendar date picker ────────────────────────────────────────────

function CalendarPicker({ value, onChange, label }: { value: string; onChange: (d: string) => void; label: string }) {
  const [open, setOpen] = useState(false)
  const [calDate, setCalDate] = useState(() => value ? new Date(value + 'T00:00:00') : new Date())
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !dropRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const todayStr = toDateStr(new Date())

  const fmtDisplay = (d: string) => {
    if (!d) return 'Select date'
    const obj = new Date(d + 'T00:00:00')
    return obj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
        <button ref={triggerRef} className="dr-cal-trigger" style={{ width: '100%', justifyContent: 'flex-start' }}
          onClick={() => {
            if (triggerRef.current) {
              const r = triggerRef.current.getBoundingClientRect()
              setPos({ top: r.bottom + 6, left: r.left })
            }
            if (value) setCalDate(new Date(value + 'T00:00:00'))
            setOpen(o => !o)
          }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <span>{fmtDisplay(value)}</span>
        </button>
        {open && pos && createPortal(
          <div ref={dropRef} className="dr-cal-dropdown glass-card"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: 240, padding: 12 }}>
            <div className="calendar-nav">
              <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <span className="calendar-month-label">{monthNames[calDate.getMonth()]} {calDate.getFullYear()}</span>
              <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
            <div className="calendar-grid">
              <div className="calendar-header-row">
                {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <span key={d}>{d}</span>)}
              </div>
              <div className="calendar-body">
                {Array.from({ length: new Date(calDate.getFullYear(), calDate.getMonth(), 1).getDay() }).map((_, i) => <span key={`e${i}`}/>)}
                {Array.from({ length: new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0).getDate() }).map((_, i) => {
                  const dayStr = `${calDate.getFullYear()}-${String(calDate.getMonth()+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`
                  return (
                    <button key={i}
                      className={`calendar-day${dayStr === value ? ' selected' : ''}${dayStr === todayStr ? ' today' : ''}`}
                      onClick={() => { onChange(dayStr); setOpen(false) }}>
                      {i + 1}
                    </button>
                  )
                })}
              </div>
            </div>
            <div style={{ textAlign: 'center', marginTop: 6 }}>
              <button className="dt-btn dt-btn-ghost dt-btn-sm" style={{ fontSize: 11 }}
                onClick={() => { onChange(todayStr); setOpen(false) }}>Today</button>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}

function CategoryChips({ value, onChange, categories }: {
  value: string
  onChange: (v: string) => void
  categories: string[]
}) {
  return (
    <div className="dt-chip-group">
      {categories.map(c => {
        const col = (() => {
          const fixed: Record<string,string> = {
            Development: '#6366f1', Testing: '#10b981', Meetings: '#8b5cf6',
            Breaks: '#f59e0b', Review: '#06b6d4', Research: '#ec4899',
          }
          if (fixed[c]) return fixed[c]
          const PALETTE = ['#6366f1','#10b981','#8b5cf6','#f59e0b','#06b6d4','#ec4899','#f97316','#ef4444','#84cc16','#14b8a6']
          const idx = categories.indexOf(c)
          return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length]
        })()
        const selected = value === c
        return (
          <button
            key={c}
            type="button"
            className={`dt-chip${selected ? ' dt-chip--selected' : ''}`}
            style={selected ? { background: col + '25', borderColor: col, color: col } : {}}
            onClick={() => onChange(c)}
          >
            <span className="dt-chip-dot" style={{ background: col }}/>
            {c}
          </button>
        )
      })}
    </div>
  )
}

function TaskNameInput({ value, onChange, suggestions, placeholder, onEnter }: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  onEnter?: () => void
}) {
  const ghost = value.trim().length > 0
    ? (suggestions.find(s => s.toLowerCase().startsWith(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase()) ?? '')
    : ''
  const ghostSuffix = ghost ? ghost.slice(value.length) : ''

  return (
    <div className="dt-suggest-wrap">
      {ghostSuffix && (
        <div className="dt-suggest-ghost" aria-hidden>
          <span className="dt-suggest-ghost-typed">{value}</span>
          <span className="dt-suggest-ghost-hint">{ghostSuffix}</span>
        </div>
      )}
      <input
        className="form-input dt-suggest-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={ghostSuffix ? '' : placeholder}
        autoComplete="off"
        onKeyDown={e => {
          if ((e.key === 'Tab') && ghostSuffix) { e.preventDefault(); onChange(ghost) }
          if (e.key === 'Enter') { onEnter?.() }
          if (e.key === 'Escape') onChange(value)
        }}
      />
    </div>
  )
}

export function DayTrackPage() {
  const [date, setDate] = useState<string>(toDateStr(new Date()))
  const [entries, setEntries] = useState<DayTrackEntry[]>([])
  const [planned, setPlanned] = useState<DayTrackPlanned[]>([])
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATS)
  const [loading, setLoading] = useState(true)

  // Active tab in left card: manual | timer | planned
  const [activeTab, setActiveTab] = useState<'manual'|'timer'|'plan'>('manual')

  // Manual form
  const [mName, setMName] = useState('')
  const [mCat, setMCat] = useState('')
  const [mStart, setMStart] = useState('')
  const [mEnd, setMEnd] = useState('')
  const [mNotes, setMNotes] = useState('')

  // Timer form
  const [tName, setTName] = useState('')
  const [tCat, setTCat] = useState('')
  const [tNotes, setTNotes] = useState('')
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerPaused, setTimerPaused] = useState(false)
  const [timerDisplay, setTimerDisplay] = useState('00:00:00')
  const [timerStatus, setTimerStatus] = useState<'idle'|'running'|'paused'>('idle')
  const timerStartRef = useRef<number>(0)
  const pausedMsRef = useRef<number>(0)
  const pauseStartRef = useRef<number>(0)
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Plan form
  const [pName, setPName] = useState('')
  const [pCat, setPCat] = useState('')
  const [pTime, setPTime] = useState('')
  const [pWhen, setPWhen] = useState<'today'|'tomorrow'>('today')
  const [pNotes, setPNotes] = useState('')

  // Export modal
  const [exportOpen, setExportOpen] = useState(false)
  const [exportMode, setExportMode] = useState<'month'|'custom'>('month')
  const [exportMonth, setExportMonth] = useState(() => date.slice(0, 7))
  const [exportStart, setExportStart] = useState(date)
  const [exportEnd, setExportEnd] = useState(date)
  const [exportLoading, setExportLoading] = useState(false)

  // Category manager
  const [newCat, setNewCat] = useState('')
  const [catMgrOpen, setCatMgrOpen] = useState(false)

  // Edit modal
  const [editEntry, setEditEntry] = useState<DayTrackEntry | null>(null)
  const [eName, setEName] = useState('')
  const [eCat, setECat] = useState('')
  const [eStart, setEStart] = useState('')
  const [eEnd, setEEnd] = useState('')
  const [eNotes, setENotes] = useState('')

  // Category dropdown open state (one at a time)
  const [openDrop, setOpenDrop] = useState<'mCat'|'tCat'|'pCat'|'eCat'|'stCat'|null>(null)
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const mCatRef = useRef<HTMLDivElement>(null)
  const tCatRef = useRef<HTMLDivElement>(null)
  const pCatRef = useRef<HTMLDivElement>(null)
  const eCatRef = useRef<HTMLDivElement>(null)
  const stCatRef = useRef<HTMLDivElement>(null)

  function openDropdown(key: 'mCat'|'tCat'|'pCat'|'eCat'|'stCat', ref: React.RefObject<HTMLDivElement | null>) {
    if (openDrop === key) { setOpenDrop(null); return }
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpenDrop(key)
  }

  // Subtask state
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set())
  const [subtaskParent, setSubtaskParent] = useState<DayTrackEntry | null>(null)
  const [stName, setStName] = useState('')
  const [stCat, setStCat] = useState('')
  const [stStart, setStStart] = useState('')
  const [stEnd, setStEnd] = useState('')
  const [stNotes, setStNotes] = useState('')

  // Calendar
  const [calOpen, setCalOpen] = useState(false)
  const [calDate, setCalDate] = useState(new Date())
  const calTriggerRef = useRef<HTMLButtonElement>(null)
  const calDropRef = useRef<HTMLDivElement>(null)
  // calRef kept for API compat but unused — portal approach used instead
  const [calPos, setCalPos] = useState<{ top: number; left: number } | null>(null)

  // Suggestions
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [mSuggest, setMSuggest] = useState<string[]>([])
  const [tSuggest, setTSuggest] = useState<string[]>([])

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  // Live clock
  const [clock, setClock] = useState('')

  // Close dropdowns / calendar on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      const inTrigger = [mCatRef, tCatRef, pCatRef, eCatRef, stCatRef].some(r => r.current?.contains(t))
      if (!inTrigger) setOpenDrop(null)
      if (!calTriggerRef.current?.contains(t) && !calDropRef.current?.contains(t)) setCalOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const tick = () => {
      const n = new Date()
      setClock(n.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const toast = useCallback((msg: string, type: ToastType = 'success') => {
    const id = ++toastId.current
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200)
  }, [])

  // Load data
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [e, p, c] = await Promise.all([
        dayTrackApi.getEntries(date),
        dayTrackApi.getPlanned(date),
        dayTrackApi.getCategories(),
      ])
      setEntries(e)
      setPlanned(p)
      // Always show defaults + any custom categories from DB (deduped)
      const custom = c.filter(cat => !DEFAULT_CATS.includes(cat))
      setCategories([...DEFAULT_CATS, ...custom])
    } catch {
      // silently ignore — show empty state
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    dayTrackApi.getSuggestions().then(setSuggestions).catch(() => {})
  }, [])

  // Default category to first in list
  useEffect(() => {
    if (categories.length > 0 && !mCat) setMCat(categories[0])
    if (categories.length > 0 && !tCat) setTCat(categories[0])
    if (categories.length > 0 && !pCat) setPCat(categories[0])
  }, [categories]) // eslint-disable-line react-hooks/exhaustive-deps

  // Timer tick
  useEffect(() => {
    if (timerRunning && !timerPaused) {
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - timerStartRef.current - pausedMsRef.current
        const s = Math.floor(elapsed / 1000)
        const h = Math.floor(s / 3600)
        const m = Math.floor((s % 3600) / 60)
        const sec = s % 60
        setTimerDisplay(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`)
      }, 1000)
    }
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current) }
  }, [timerRunning, timerPaused])

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function addManualEntry() {
    if (!mName.trim()) { toast('Enter a task name', 'warn'); return }
    const dur = calcDuration(mStart, mEnd)
    try {
      await dayTrackApi.createEntry({
        entry_date: date,
        name: mName.trim(),
        category: mCat || categories[0] || 'General',
        start_time: mStart,
        end_time: mEnd,
        duration_mins: dur,
        notes: mNotes,
        status: (mStart && mEnd) ? 'done' : 'active',
      })
      const nextStart = mEnd ? addMinute(mEnd) : ''
      setMName(''); setMStart(nextStart); setMEnd(''); setMNotes('')
      await loadAll()
      dayTrackApi.getSuggestions().then(setSuggestions).catch(() => {})
      toast(`"${mName.trim()}" logged`)
    } catch { toast('Failed to add entry', 'warn') }
  }

  function timerStart() {
    if (!tName.trim()) { toast('Enter a task name first', 'warn'); return }
    if (timerPaused) {
      pausedMsRef.current += Date.now() - pauseStartRef.current
      setTimerPaused(false)
      setTimerStatus('running')
      return
    }
    timerStartRef.current = Date.now()
    pausedMsRef.current = 0
    setTimerRunning(true)
    setTimerPaused(false)
    setTimerStatus('running')
    toast(`Timer started for "${tName.trim()}"`, 'info')
  }

  function timerPause() {
    if (!timerRunning || timerPaused) return
    clearInterval(timerIntervalRef.current!)
    pauseStartRef.current = Date.now()
    setTimerPaused(true)
    setTimerStatus('paused')
  }

  async function timerStop() {
    clearInterval(timerIntervalRef.current!)
    const elapsed = Date.now() - timerStartRef.current - pausedMsRef.current
    const mins = Math.round(elapsed / 60000)
    const now = new Date()
    const startD = new Date(timerStartRef.current)
    const fmt = (d: Date) => to12h(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)
    const name = tName.trim()
    try {
      await dayTrackApi.createEntry({
        entry_date: date,
        name,
        category: tCat || categories[0] || 'General',
        start_time: fmt(startD),
        end_time: fmt(now),
        duration_mins: mins,
        notes: tNotes,
        status: 'done',
      })
      await loadAll()
      toast(`"${name}" logged — ${minsLabel(mins)}`)
    } catch { toast('Failed to log entry', 'warn') }
    setTimerRunning(false); setTimerPaused(false); setTimerStatus('idle')
    setTimerDisplay('00:00:00')
    setTName(''); setTNotes('')
  }

  async function addPlanned() {
    if (!pName.trim()) { toast('Enter a task name', 'warn'); return }
    try {
      await dayTrackApi.createPlanned({
        entry_date: date,
        name: pName.trim(),
        category: pCat || categories[0] || 'General',
        scheduled_time: pTime,
        when_type: pWhen,
        notes: pNotes,
        status: 'planned',
      })
      setPName(''); setPTime(''); setPNotes('')
      await loadAll()
      toast(`"${pName.trim()}" scheduled for ${pWhen}`)
    } catch { toast('Failed to schedule task', 'warn') }
  }

  async function deleteEntry(id: string) {
    try {
      await dayTrackApi.deleteEntry(id)
      await loadAll()
      toast('Entry removed', 'info')
    } catch { toast('Failed to delete', 'warn') }
  }

  async function deletePlanned(id: string) {
    try {
      await dayTrackApi.deletePlanned(id)
      await loadAll()
    } catch { toast('Failed to delete', 'warn') }
  }

  async function carryEntry(entry: DayTrackEntry) {
    try {
      const subs = subtaskMap.get(entry.id) ?? []
      // Carry subtasks first (as separate planned items), then delete them individually
      for (const s of subs) {
        await dayTrackApi.createPlanned({
          entry_date: date,
          name: s.name,
          category: s.category,
          scheduled_time: s.start_time || '',
          start_time: s.start_time,
          end_time: s.end_time,
          when_type: 'tomorrow',
          notes: s.notes ? `[subtask of ${entry.name}] ${s.notes}` : `[subtask of ${entry.name}]`,
          status: 'carry',
        })
        await dayTrackApi.deleteEntry(s.id)
      }
      // Now carry parent (no subtasks remain to cascade-delete)
      await dayTrackApi.createPlanned({
        entry_date: date,
        name: entry.name,
        category: entry.category,
        scheduled_time: entry.start_time || '',
        start_time: entry.start_time,
        end_time: entry.end_time,
        when_type: 'tomorrow',
        notes: entry.notes,
        status: 'carry',
      })
      await dayTrackApi.deleteEntry(entry.id)
      await loadAll()
      toast(`"${entry.name}" carried to tomorrow${subs.length > 0 ? ` (+${subs.length} subtask${subs.length > 1 ? 's' : ''})` : ''}`)
    } catch { toast('Failed to carry entry', 'warn') }
  }

  async function startPlanned(item: DayTrackPlanned) {
    const now = nowHHMM()
    try {
      await dayTrackApi.createEntry({
        entry_date: date,
        name: item.name,
        category: item.category,
        start_time: now,
        end_time: '',
        duration_mins: null,
        notes: item.notes,
        status: 'active',
      })
      await dayTrackApi.deletePlanned(item.id)
      await loadAll()
      toast(`Started "${item.name}"`)
    } catch { toast('Failed to start task', 'warn') }
  }

  async function rollbackPlanned(item: DayTrackPlanned) {
    const s = item.start_time || item.scheduled_time || ''
    const e = item.end_time || ''
    const dur = calcDuration(s, e)
    try {
      await dayTrackApi.createEntry({
        entry_date: date,
        name: item.name,
        category: item.category,
        start_time: s,
        end_time: e,
        duration_mins: dur,
        notes: item.notes,
        status: (s && e) ? 'done' : 'active',
      })
      await dayTrackApi.deletePlanned(item.id)
      await loadAll()
      toast(`"${item.name}" rolled back to today's log`)
    } catch { toast('Failed to roll back task', 'warn') }
  }


  async function carryAllUnfinished() {
    const active = entries.filter(e => e.status === 'active' && !e.parent_entry_id)
    try {
      for (const e of active) {
        await carryEntry(e)
      }
      toast(`${active.length} task(s) carried to tomorrow`)
    } catch { toast('Failed to carry tasks', 'warn') }
  }

  function openEdit(entry: DayTrackEntry) {
    setEditEntry(entry)
    setEName(entry.name); setECat(entry.category)
    setEStart(entry.start_time); setEEnd(entry.end_time); setENotes(entry.notes)
  }

  async function saveEdit() {
    if (!editEntry) return
    const dur = calcDuration(eStart, eEnd)
    const newStatus = (eStart && eEnd) ? 'done' : editEntry.status
    try {
      await dayTrackApi.updateEntry(editEntry.id, {
        name: eName || editEntry.name,
        category: eCat,
        start_time: eStart, end_time: eEnd,
        duration_mins: dur, notes: eNotes,
        status: newStatus,
      })
      setEditEntry(null)
      await loadAll()
      toast('Entry updated')
    } catch { toast('Failed to update', 'warn') }
  }

  function openSubtask(parent: DayTrackEntry) {
    setSubtaskParent(parent)
    setStName('')
    setStCat(parent.category)
    // Default start = latest subtask end_time + 1 min, else parent start_time
    const subs = subtaskMap.get(parent.id) ?? []
    const latestEnd = subs
      .map(s => s.end_time)
      .filter(Boolean)
      .sort((a, b) => timeToMins(b) - timeToMins(a))[0]
    if (latestEnd) {
      const mins = timeToMins(latestEnd) + 1
      const h = Math.floor(mins / 60) % 24
      const m = mins % 60
      setStStart(to12h(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`))
    } else {
      setStStart(parent.start_time || '')
    }
    setStEnd('')
    setStNotes('')
  }

  async function saveSubtask() {
    if (!subtaskParent) return
    if (!stName.trim()) { toast('Enter a subtask name', 'warn'); return }
    if (stStart && subtaskParent.start_time && timeToMins(stStart) < timeToMins(subtaskParent.start_time)) {
      toast(`Start time must be ≥ parent start (${subtaskParent.start_time})`, 'warn'); return
    }
    const dur = calcDuration(stStart, stEnd)
    try {
      await dayTrackApi.createEntry({
        entry_date: date,
        name: stName.trim(),
        category: stCat || subtaskParent.category,
        start_time: stStart,
        end_time: stEnd,
        duration_mins: dur,
        notes: stNotes,
        status: (stStart && stEnd) ? 'done' : 'active',
        parent_entry_id: subtaskParent.id,
      })
      // Auto-update parent end_time if subtask end is later
      if (stEnd && (!subtaskParent.end_time || timeToMins(stEnd) > timeToMins(subtaskParent.end_time))) {
        const newDur = calcDuration(subtaskParent.start_time, stEnd)
        await dayTrackApi.updateEntry(subtaskParent.id, {
          name: subtaskParent.name,
          category: subtaskParent.category,
          start_time: subtaskParent.start_time,
          end_time: stEnd,
          duration_mins: newDur,
          notes: subtaskParent.notes,
          status: subtaskParent.status,
        })
      }
      setExpandedEntries(prev => { const s = new Set(prev); s.add(subtaskParent.id); return s })
      setSubtaskParent(null)
      await loadAll()
      toast(`Subtask "${stName.trim()}" added`)
    } catch { toast('Failed to add subtask', 'warn') }
  }

  async function addCategory() {
    const v = newCat.trim()
    if (!v) return
    if (categories.includes(v)) { toast('Category already exists', 'warn'); return }
    try {
      await dayTrackApi.addCategory(v)
      setNewCat('')
      setCategories(prev => [...prev, v])
      toast(`Category "${v}" added`)
    } catch { toast('Failed to add category', 'warn') }
  }

  async function removeCategory(name: string) {
    try {
      await dayTrackApi.deleteCategory(name)
      setCategories(prev => prev.filter(c => c !== name))
    } catch { toast('Failed to remove category', 'warn') }
  }

  function copyStandup() {
    const text = buildStandup()
    navigator.clipboard.writeText(text).then(() => toast('Standup copied!'))
  }

  async function runExport(format: 'pdf' | 'doc') {
    setExportLoading(true)
    try {
      let start: string, end: string
      if (exportMode === 'month') {
        start = `${exportMonth}-01`
        const [y, m] = exportMonth.split('-').map(Number)
        const last = new Date(y, m, 0).getDate()
        end = `${exportMonth}-${String(last).padStart(2, '0')}`
      } else {
        start = exportStart; end = exportEnd
      }

      const token = localStorage.getItem('token')
      const res = await fetch(`${import.meta.env.VITE_API_URL}/daytrack/entries/range?start=${start}&end=${end}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Failed to fetch range')
      const allEntries: DayTrackEntry[] = await res.json()

      // Group by date, then by parent/subtask
      const byDate = new Map<string, DayTrackEntry[]>()
      allEntries.forEach(e => {
        if (!byDate.has(e.entry_date)) byDate.set(e.entry_date, [])
        byDate.get(e.entry_date)!.push(e)
      })

      const fmtDateStr = (d: string) => {
        const obj = new Date(d + 'T00:00:00')
        return fmtDate(obj)
      }
      const renderExportRows = (dayEntries: DayTrackEntry[]) => {
        const dayParents = dayEntries.filter(e => !e.parent_entry_id)
        const daySubs = new Map<string, DayTrackEntry[]>()
        dayEntries.filter(e => e.parent_entry_id).forEach(e => {
          const l = daySubs.get(e.parent_entry_id!) ?? []; l.push(e); daySubs.set(e.parent_entry_id!, l)
        })
        return dayParents.flatMap(e => {
          const subs = daySubs.get(e.id) ?? []
          const rows = [`<tr>
    <td><strong>${e.name}</strong></td><td>${e.category}</td>
    <td>${e.start_time || '—'}</td><td>${e.end_time || '—'}</td>
    <td>${e.duration_mins != null ? minsLabel(e.duration_mins) : '—'}</td>
    <td><span class="${e.status === 'done' ? 'badge-done' : 'badge-active'}">${e.status}</span></td>
    <td>${e.notes || ''}</td>
  </tr>`]
          subs.forEach(s => rows.push(`<tr style="background:#f8fafc">
    <td style="padding-left:28px;border-left:3px solid #e2e8f0;color:#64748b">↳ ${s.name}</td>
    <td style="color:#64748b">${s.category}</td>
    <td style="color:#64748b">${s.start_time || '—'}</td><td style="color:#64748b">${s.end_time || '—'}</td>
    <td style="color:#64748b">${s.duration_mins != null ? minsLabel(s.duration_mins) : '—'}</td>
    <td><span class="${s.status === 'done' ? 'badge-done' : 'badge-active'}">${s.status}</span></td>
    <td style="color:#64748b">${s.notes || ''}</td>
  </tr>`))
          return rows
        }).join('')
      }
      const parentAllEntries = allEntries.filter(e => !e.parent_entry_id)
      const subMapExport = new Map<string, DayTrackEntry[]>()
      allEntries.filter(e => e.parent_entry_id).forEach(e => {
        const list = subMapExport.get(e.parent_entry_id!) ?? []; list.push(e)
        subMapExport.set(e.parent_entry_id!, list)
      })

      const totalAll = parentAllEntries.reduce((a, e) => a + (e.duration_mins ?? 0), 0)
      const doneAll = parentAllEntries.filter(e => e.status === 'done').length
      const focusAll = parentAllEntries.filter(e => !['Meetings','Breaks'].includes(e.category)).reduce((a, e) => a + (e.duration_mins ?? 0), 0)

      const catTotals: Record<string, number> = {}
      parentAllEntries.forEach(e => { if (e.duration_mins) catTotals[e.category] = (catTotals[e.category] || 0) + e.duration_mins })

      const rangeLabel = exportMode === 'month'
        ? new Date(start + 'T00:00:00').toLocaleString('en-US', { month: 'long', year: 'numeric' })
        : `${start} to ${end}`

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>DayTrack Export — ${rangeLabel}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 40px; font-size: 13px; }
  h1 { font-size: 22px; color: #4f46e5; margin-bottom: 4px; }
  .subtitle { color: #64748b; font-size: 13px; margin-bottom: 28px; }
  h2 { font-size: 15px; color: #1e293b; margin: 24px 0 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th { background: #f1f5f9; text-align: left; padding: 6px 10px; font-size: 11px; text-transform: uppercase; color: #64748b; border: 1px solid #e2e8f0; }
  td { padding: 6px 10px; border: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .day-total { font-size: 12px; color: #64748b; margin-bottom: 16px; }
  .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin-top: 28px; }
  .summary-box h3 { margin: 0 0 12px; font-size: 14px; color: #4f46e5; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .stat { text-align: center; }
  .stat-val { font-size: 20px; font-weight: 700; color: #1e293b; }
  .stat-lbl { font-size: 11px; color: #64748b; margin-top: 2px; }
  .cat-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
  .badge-done { background: #d1fae5; color: #065f46; padding: 1px 7px; border-radius: 10px; font-size: 11px; }
  .badge-active { background: #dbeafe; color: #1e40af; padding: 1px 7px; border-radius: 10px; font-size: 11px; }
  @media print { body { margin: 20px; } }
</style></head><body>
<h1>📋 DayTrack Export</h1>
<div class="subtitle">Period: ${rangeLabel} &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}</div>
${Array.from(byDate.entries()).map(([d, dayEntries]) => {
  const dayParents = dayEntries.filter(e => !e.parent_entry_id)
  const dayTotal = dayParents.reduce((a, e) => a + (e.duration_mins ?? 0), 0)
  return `<h2>${fmtDateStr(d)}</h2>
<table>
  <thead><tr><th>Task</th><th>Category</th><th>Start</th><th>End</th><th>Duration</th><th>Status</th><th>Notes</th></tr></thead>
  <tbody>${renderExportRows(dayEntries)}</tbody>
</table>
<div class="day-total">Daily total: <b>${minsLabel(dayTotal)}</b> &nbsp;·&nbsp; ${dayParents.length} task(s) &nbsp;·&nbsp; ${dayParents.filter(e => e.status === 'done').length} done</div>`
}).join('')}
<div class="summary-box">
  <h3>Overall Summary</h3>
  <div class="summary-grid">
    <div class="stat"><div class="stat-val">${minsLabel(totalAll)}</div><div class="stat-lbl">Total Logged</div></div>
    <div class="stat"><div class="stat-val">${allEntries.length}</div><div class="stat-lbl">Total Tasks</div></div>
    <div class="stat"><div class="stat-val">${doneAll}</div><div class="stat-lbl">Completed</div></div>
    <div class="stat"><div class="stat-val">${totalAll > 0 ? Math.round(focusAll / totalAll * 100) : 0}%</div><div class="stat-lbl">Focus Rate</div></div>
  </div>
  <div style="margin-top:16px"><b style="font-size:12px;color:#64748b">TIME BY CATEGORY</b>
    <div style="margin-top:6px">${Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).map(([cat,mins]) =>
      `<div class="cat-row"><span>${cat}</span><span><b>${minsLabel(mins)}</b></span></div>`
    ).join('')}</div>
  </div>
</div>
</body></html>`

      if (format === 'pdf') {
        const w = window.open('', '_blank')
        if (!w) { toast('Allow popups to export PDF', 'warn'); return }
        w.document.write(html)
        w.document.close()
        w.focus()
        setTimeout(() => { w.print(); }, 400)
      } else {
        const blob = new Blob([html], { type: 'application/msword' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `daytrack-${exportMode === 'month' ? exportMonth : `${exportStart}-to-${exportEnd}`}.doc`
        a.click()
      }
      setExportOpen(false)
      toast(`Export ready`, 'success')
    } catch { toast('Export failed', 'warn') }
    finally { setExportLoading(false) }
  }

  function exportCSV() {
    const rows = [['Task','Category','Start','End','Duration (min)','Status','Notes','Date']]
    entries.forEach(e => rows.push([
      e.name, e.category, e.start_time, e.end_time,
      String(e.duration_mins ?? ''), e.status, e.notes, e.entry_date
    ]))
    const csv = rows.map(r => r.map(v => `"${(v||'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `daytrack-${date}.csv`; a.click()
  }

  // ── Computed stats ────────────────────────────────────────────────────────────

  const totalMins = entries.reduce((a, e) => a + (e.duration_mins ?? 0), 0)
  const completedCount = entries.filter(e => e.status === 'done').length
  const pendingCount = planned.filter(p => p.when_type === 'today').length
  const focusMins = entries
    .filter(e => !['Meetings','Breaks'].includes(e.category))
    .reduce((a, e) => a + (e.duration_mins ?? 0), 0)
  const focusRate = totalMins > 0 ? Math.round(focusMins / totalMins * 100) : null

  const catMap: Record<string, number> = {}
  entries.forEach(e => { if (e.duration_mins) catMap[e.category] = (catMap[e.category] || 0) + e.duration_mins })
  const maxCatMins = Math.max(...Object.values(catMap), 1)

  // Latest end time across all entries (for auto-filling next start time)
  const latestEndTime = entries.reduce<string>((best, e) => {
    if (!e.end_time) return best
    if (!best) return e.end_time
    return timeToMins(e.end_time) > timeToMins(best) ? e.end_time : best
  }, '')

  // Subtask grouping
  const parentEntries = entries.filter(e => !e.parent_entry_id)
  const subtaskMap = new Map<string, DayTrackEntry[]>()
  entries.filter(e => e.parent_entry_id).forEach(e => {
    const list = subtaskMap.get(e.parent_entry_id!) ?? []
    list.push(e)
    subtaskMap.set(e.parent_entry_id!, list)
  })

  function buildStandup(): string {
    const today = fmtDate(new Date(date))
    const doneList = entries.filter(e => e.status === 'done')
      .map(e => `  ✅ ${e.name} (${e.category}) – ${minsLabel(e.duration_mins)}`).join('\n')
    const activeList = entries.filter(e => e.status === 'active')
      .map(e => `  🔄 ${e.name} (${e.category})`).join('\n')
    const planList = planned.filter(p => p.when_type === 'today')
      .map(p => `  📌 ${p.name} (${p.category})`).join('\n')
    let text = `📋 Daily Standup – ${today}\n`
    text += `⏱ Total: ${totalMins ? minsLabel(totalMins) : '—'} | Focus Rate: ${focusRate != null ? focusRate + '%' : '—'}\n\n`
    text += `✅ Done Today:\n${doneList || '  (none)'}\n\n`
    if (activeList) text += `🔄 In Progress:\n${activeList}\n\n`
    text += `📌 Planned / Upcoming:\n${planList || '  (none)'}\n\n`
    text += `🚧 Blockers:\n  None`
    return text
  }

  // ── Category pill renderer ────────────────────────────────────────────────────

  function CatPill({ cat }: { cat: string }) {
    const c = catColor(cat, categories)
    return <span className="dt-cat-pill" style={{ background: c + '20', color: c }}>{cat}</span>
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const dateObj = new Date(date + 'T00:00:00')

  return (
    <div className="dt-page">

      {/* Header */}
      <div className="dt-header">
        <div className="dt-header-left">
          <div className="dt-header-icon">
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg>
          </div>
          <div>
            <div className="dt-header-title">DayTrack</div>
            <div className="dt-header-sub">Daily Time Recording Sheet</div>
          </div>
        </div>

        <div className="dt-header-stats">
          <div className="dt-stat-pill">
            <span className="dt-stat-dot dt-stat-dot--green"/>Total: <b>{minsLabel(totalMins)}</b>
          </div>
          <div className="dt-stat-pill">
            <span className="dt-stat-dot dt-stat-dot--blue"/>Tasks: <b>{entries.length}</b>
          </div>
          <div className="dt-stat-pill">
            <span className="dt-stat-dot dt-stat-dot--amber"/>Pending: <b>{pendingCount}</b>
          </div>
        </div>

        <div className="dt-header-right">
          {/* Date navigation + calendar picker */}
          <div className="dt-date-nav">
            <div className="dr-cal-wrap">
              <button className="dr-cal-trigger" ref={calTriggerRef} onClick={() => {
                if (calTriggerRef.current) {
                  const r = calTriggerRef.current.getBoundingClientRect()
                  setCalPos({ top: r.bottom + 6, left: r.left })
                }
                setCalOpen(o => !o)
                setCalDate(new Date(date + 'T00:00:00'))
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
                <span>{fmtDate(dateObj)}</span>
              </button>
              {calOpen && calPos && createPortal((() => {
                const y = calDate.getFullYear(), m = calDate.getMonth()
                const firstDay = new Date(y, m, 1).getDay()
                const daysInMonth = new Date(y, m + 1, 0).getDate()
                const todayStr = toDateStr(new Date())
                const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
                return (
                  <div ref={calDropRef} className="dr-cal-dropdown glass-card"
                    style={{ position: 'fixed', top: calPos.top, left: calPos.left, zIndex: 9999, minWidth: 240, padding: 12 }}>
                    <div className="calendar-nav">
                      <button onClick={() => setCalDate(new Date(y, m - 1, 1))}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                      </button>
                      <span className="calendar-month-label">{monthNames[m]} {y}</span>
                      <button onClick={() => setCalDate(new Date(y, m + 1, 1))}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                      </button>
                    </div>
                    <div className="calendar-grid">
                      <div className="calendar-header-row">
                        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <span key={d}>{d}</span>)}
                      </div>
                      <div className="calendar-body">
                        {Array.from({ length: firstDay }).map((_, i) => <span key={`e${i}`}/>)}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                          const dayStr = `${y}-${String(m+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`
                          return (
                            <button key={i}
                              className={`calendar-day${dayStr === date ? ' selected' : ''}${dayStr === todayStr ? ' today' : ''}`}
                              onClick={() => { setDate(dayStr); setCalOpen(false) }}>
                              {i + 1}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 6 }}>
                      <button className="dt-btn dt-btn-ghost dt-btn-sm" style={{ fontSize: 11 }}
                        onClick={() => { setDate(todayStr); setCalOpen(false) }}>Today</button>
                    </div>
                  </div>
                )
              })(), document.body)}
            </div>
          </div>

          <div className="dt-clock">{clock}</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="dt-grid">

        {/* LEFT COLUMN */}
        <div>

          {/* Add Entry Card */}
          <div className="dt-card">
            <div className="dt-card-title">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
              Add Task / Entry
            </div>

            {/* Tab switcher */}
            <div className="dt-tabs">
              {(['manual','timer','plan'] as const).map((t, i) => (
                <button key={t} className={`dt-tab ${activeTab === t ? 'active' : ''}`}
                  onClick={() => setActiveTab(t)}>
                  {['Manual Entry','Live Timer','Plan Ahead'][i]}
                </button>
              ))}
            </div>

            {/* Manual */}
            <div className={`dt-tab-panel ${activeTab === 'manual' ? 'active' : ''}`}>
              <div className="form-group">
                <label className="form-label">Task Name *</label>
                <TaskNameInput value={mName} onChange={setMName} suggestions={suggestions}
                  placeholder="What did you work on?" onEnter={addManualEntry} />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <CategoryChips value={mCat} onChange={setMCat} categories={categories} />
              </div>
              <div className="dt-row2">
                <div className="form-group">
                  <label className="form-label">Start Time</label>
                  <div className="dt-time-wrap">
                    <input className="form-input" type="time" value={to24h(mStart)} onChange={e => setMStart(to12h(e.target.value))} />
                    <button className="dt-now-btn" onClick={() => setMStart(nowHHMM())}>Now</button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">End Time</label>
                  <div className="dt-time-wrap">
                    <input className="form-input" type="time" value={to24h(mEnd)} onChange={e => setMEnd(to12h(e.target.value))} />
                    <button className="dt-now-btn" onClick={() => setMEnd(nowHHMM())}>Now</button>
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <textarea className="form-input" value={mNotes} onChange={e => setMNotes(e.target.value)}
                  placeholder="Any context or blockers…" rows={2} />
              </div>
              <button className="dt-btn dt-btn-primary dt-btn-full" onClick={addManualEntry}>
                <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                Add to Timesheet
              </button>
            </div>

            {/* Timer */}
            <div className={`dt-tab-panel ${activeTab === 'timer' ? 'active' : ''}`}>
              <div className="dt-timer-widget">
                <div className="dt-timer-status">
                  {timerStatus === 'running' && <><span className="dt-timer-pulse"/><span style={{ color: 'var(--color-success)', fontWeight: 600 }}>Running</span></>}
                  {timerStatus === 'paused'  && <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>Paused</span>}
                  {timerStatus === 'idle'    && <span style={{ color: 'var(--text-muted)' }}>No active timer</span>}
                </div>
                <div className="dt-timer-display">{timerDisplay}</div>
                <div className="dt-timer-name">{timerStatus !== 'idle' ? tName : ''}</div>
                <div className="dt-timer-controls">
                  <button className="dt-btn dt-btn-success dt-btn-sm"
                    onClick={timerStart}
                    disabled={timerRunning && !timerPaused}>
                    <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    {timerPaused ? 'Resume' : 'Start'}
                  </button>
                  <button className="dt-btn dt-btn-ghost dt-btn-sm"
                    onClick={timerPause}
                    disabled={!timerRunning || timerPaused}>
                    <svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    Pause
                  </button>
                  <button className="dt-btn dt-btn-danger dt-btn-sm"
                    onClick={timerStop}
                    disabled={!timerRunning}>
                    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                    Stop
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Task Name *</label>
                <TaskNameInput value={tName} onChange={setTName} suggestions={suggestions}
                  placeholder="What are you working on?" />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <CategoryChips value={tCat} onChange={timerStatus === 'running' ? () => {} : setTCat} categories={categories} />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-input" value={tNotes} onChange={e => setTNotes(e.target.value)}
                  placeholder="Any notes…" rows={2} />
              </div>
            </div>

            {/* Plan Ahead */}
            <div className={`dt-tab-panel ${activeTab === 'plan' ? 'active' : ''}`}>
              <div className="form-group">
                <label className="form-label">Task Name *</label>
                <input className="form-input" value={pName} onChange={e => setPName(e.target.value)}
                  placeholder="Plan a task for today or tomorrow…" autoComplete="off"
                  onKeyDown={e => e.key === 'Enter' && addPlanned()} />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <CategoryChips value={pCat} onChange={setPCat} categories={categories} />
              </div>
              <div className="form-group">
                <label className="form-label">Scheduled Time (optional)</label>
                <div className="dt-time-wrap">
                  <input className="form-input" type="time" value={to24h(pTime)} onChange={e => setPTime(to12h(e.target.value))} />
                  <button className="dt-now-btn" onClick={() => setPTime(nowHHMM())}>Now</button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Schedule For</label>
                <select className="form-input" value={pWhen} onChange={e => setPWhen(e.target.value as 'today'|'tomorrow')}>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow (Carry Over)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-input" value={pNotes} onChange={e => setPNotes(e.target.value)}
                  placeholder="Description or priority…" rows={2} />
              </div>
              <button className="dt-btn dt-btn-warning dt-btn-full" onClick={addPlanned}>
                <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                Schedule Task
              </button>
            </div>
          </div>

          {/* Categories — collapsible */}
          <div className="dt-card dt-cat-mgr-card">
            <button className="dt-cat-mgr-toggle" onClick={() => setCatMgrOpen(o => !o)}>
              <div className="dt-card-title" style={{ margin: 0 }}>
                <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h7"/></svg>
                Manage Categories
                <span className="dt-sub-count">{categories.length}</span>
              </div>
              <svg className={`dt-cat-mgr-chevron${catMgrOpen ? ' open' : ''}`} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            {catMgrOpen && (
              <div className="dt-cat-mgr-body">
                <div className="dt-cats-wrap">
                  {categories.map(c => {
                    const col = catColor(c, categories)
                    const isDefault = ['Development','Testing','Meetings','Breaks','Review','Research'].includes(c)
                    return (
                      <span key={c} className="dt-cat-tag" style={{ background: col + '20', color: col }}>
                        {c}
                        {!isDefault && (
                          <button className="dt-cat-tag-remove" onClick={() => removeCategory(c)} title="Remove">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                          </button>
                        )}
                      </span>
                    )
                  })}
                </div>
                <div className="dt-add-cat-row">
                  <input className="form-input" value={newCat} onChange={e => setNewCat(e.target.value)}
                    placeholder="Add custom category…" autoComplete="off"
                    onKeyDown={e => e.key === 'Enter' && addCategory()} />
                  <button className="dt-btn dt-btn-primary dt-btn-sm" onClick={addCategory}>
                    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* RIGHT COLUMN */}
        <div>

          {/* Today's Log */}
          <div className="dt-card">
            <div className="dt-section-header">
              <h3 className="dt-section-title">
                <svg style={{ stroke: 'var(--color-success)' }} viewBox="0 0 24 24">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Today's Log
                <span className="dt-count-badge">{entries.length}</span>
              </h3>
            </div>

            {loading ? (
              <div className="dt-empty">Loading…</div>
            ) : (
              <div className="dt-table-wrap">
                <table className="dt-table">
                  <thead>
                    <tr>
                      <th>Task</th><th>Category</th><th>Start</th><th>End</th>
                      <th>Duration</th><th>Status</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parentEntries.length === 0 ? (
                      <tr><td colSpan={7}>
                        <div className="dt-empty">
                          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/>
                            <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
                          </svg>
                          No tasks recorded yet. Add your first entry!
                        </div>
                      </td></tr>
                    ) : parentEntries.map(e => {
                      const subs = subtaskMap.get(e.id) ?? []
                      const isExpanded = expandedEntries.has(e.id)
                      const subDurTotal = subs.reduce((a, s) => a + (s.duration_mins ?? 0), 0)
                      const displayDur = subs.length > 0 && subDurTotal > 0 ? subDurTotal : e.duration_mins
                      return (
                        <>
                          <tr key={e.id}>
                            <td className="dt-td-name">
                              <div className="dt-td-name-row">
                                <button
                                  className="dt-expand-btn"
                                  style={{ visibility: subs.length > 0 ? 'visible' : 'hidden' }}
                                  onClick={() => setExpandedEntries(prev => {
                                    const s = new Set(prev)
                                    if (s.has(e.id)) s.delete(e.id); else s.add(e.id)
                                    return s
                                  })}
                                  title={isExpanded ? 'Collapse subtasks' : 'Expand subtasks'}>
                                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    {isExpanded
                                      ? <path d="M6 9l6 6 6-6"/>
                                      : <path d="M9 18l6-6-6-6"/>}
                                  </svg>
                                </button>
                                <span>
                                  {e.name}
                                  {!isExpanded && subs.length > 0 && <span className="dt-sub-count">{subs.length} sub</span>}
                                  {e.notes && <span className="dt-td-note">{e.notes}</span>}
                                </span>
                              </div>
                            </td>
                            <td><CatPill cat={e.category} /></td>
                            <td className="dt-td-time">{e.start_time || '—'}</td>
                            <td className="dt-td-time">{e.end_time || '—'}</td>
                            <td>{displayDur != null
                              ? <span className="dt-td-dur">{minsLabel(displayDur)}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </td>
                            <td>
                              <span className={`dt-status dt-status--${e.status}`}>{e.status}</span>
                            </td>
                            <td>
                              <div className="dt-td-actions">
                                <button className="dt-icon-btn dt-icon-btn-edit" onClick={() => openEdit(e)} title="Edit">
                                  <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>
                                  </svg>
                                </button>
                                <button className="dt-sub-add-btn" onClick={() => openSubtask(e)} title="Add subtask">
                                  + Sub
                                </button>
                                <button className="dt-icon-btn dt-icon-btn-carry" onClick={() => carryEntry(e)} title="Carry to tomorrow">
                                  <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                </button>
                                <button className="dt-icon-btn dt-icon-btn-del" onClick={() => deleteEntry(e.id)} title="Delete">
                                  <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && subs.map(s => (
                            <tr key={s.id} className="dt-subtask-row">
                              <td className="dt-td-name">
                                <div className="dt-subtask-indent">
                                  ↳ {s.name}
                                  {s.notes && <span className="dt-td-note">{s.notes}</span>}
                                </div>
                              </td>
                              <td><CatPill cat={s.category} /></td>
                              <td className="dt-td-time">{s.start_time || '—'}</td>
                              <td className="dt-td-time">{s.end_time || '—'}</td>
                              <td>{s.duration_mins != null
                                ? <span className="dt-td-dur">{minsLabel(s.duration_mins)}</span>
                                : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td>
                                <span className={`dt-status dt-status--${s.status}`}>{s.status}</span>
                              </td>
                              <td>
                                <div className="dt-td-actions">
                                  <button className="dt-icon-btn dt-icon-btn-edit" onClick={() => openEdit(s)} title="Edit">
                                    <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>
                                    </svg>
                                  </button>
                                  <button className="dt-icon-btn dt-icon-btn-del" onClick={() => deleteEntry(s.id)} title="Delete">
                                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Planned / Carry Over */}
          <div className="dt-card">
            <div className="dt-section-header">
              <h3 className="dt-section-title">
                <svg style={{ stroke: 'var(--color-warning)' }} viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                Planned & Carry Over
                <span className="dt-count-badge">{planned.length}</span>
              </h3>
              <button className="dt-btn dt-btn-ghost dt-btn-sm" onClick={carryAllUnfinished}>
                <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                Carry All Unfinished
              </button>
            </div>
            <div className="dt-table-wrap">
              <table className="dt-table">
                <thead>
                  <tr>
                    <th>Task</th><th>Category</th><th>Scheduled</th><th>For</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {planned.length === 0 ? (
                    <tr><td colSpan={6}>
                      <div className="dt-empty">
                        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/>
                          <path d="M16 2v4M8 2v4M3 10h18"/>
                        </svg>
                        No planned tasks. Use "Plan Ahead" to schedule tasks.
                      </div>
                    </td></tr>
                  ) : planned.map(p => {
                    const whenColor = p.when_type === 'tomorrow' ? 'var(--color-warning)' : 'var(--color-primary-light)'
                    const whenLabel = p.when_type === 'tomorrow' ? 'Tomorrow' : 'Today'
                    return (
                      <tr key={p.id}>
                        <td className="dt-td-name">
                          {p.name}
                          {p.notes && <span className="dt-td-note">{p.notes}</span>}
                        </td>
                        <td><CatPill cat={p.category} /></td>
                        <td className="dt-td-time">{p.scheduled_time || '—'}</td>
                        <td>
                          <span className="dt-status" style={{ background: whenColor + '20', color: whenColor }}>
                            {whenLabel}
                          </span>
                        </td>
                        <td><span className="dt-status dt-status--planned">{p.status}</span></td>
                        <td>
                          <div className="dt-td-actions">
                            <button className="dt-icon-btn dt-icon-btn-start" onClick={() => startPlanned(p)} title="Start this task now">
                              <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            </button>
                            <button className="dt-icon-btn dt-icon-btn-rollback" onClick={() => rollbackPlanned(p)} title="Roll back to today's log">
                              <svg viewBox="0 0 24 24"><path d="M19 12H5M5 12l7-7M5 12l7 7"/></svg>
                            </button>
                            <button className="dt-icon-btn dt-icon-btn-del" onClick={() => deletePlanned(p.id)} title="Remove">
                              <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* End-of-Day Summary */}
          <div className="dt-card">
            <div className="dt-card-title">
              <svg viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
              End-of-Day Summary
            </div>

            <div className="dt-summary-grid">
              <div className="dt-summary-stat">
                <div className="dt-summary-val">{minsLabel(totalMins)}</div>
                <div className="dt-summary-lbl">Total Logged</div>
              </div>
              <div className="dt-summary-stat">
                <div className="dt-summary-val">{completedCount}</div>
                <div className="dt-summary-lbl">Completed</div>
              </div>
              <div className="dt-summary-stat">
                <div className="dt-summary-val">{pendingCount}</div>
                <div className="dt-summary-lbl">Pending</div>
              </div>
              <div className="dt-summary-stat">
                <div className="dt-summary-val">{focusRate != null ? focusRate + '%' : '—'}</div>
                <div className="dt-summary-lbl">Focus Rate</div>
              </div>
            </div>

            {Object.keys(catMap).length > 0 && (
              <div className="dt-cat-bars">
                {Object.entries(catMap).sort((a,b) => b[1]-a[1]).map(([cat, mins]) => {
                  const pct = Math.round(mins / maxCatMins * 100)
                  const col = catColor(cat, categories)
                  return (
                    <div key={cat} className="dt-cat-bar-row">
                      <div className="dt-cat-bar-label" title={cat}>{cat}</div>
                      <div className="dt-cat-bar-track">
                        <div className="dt-cat-bar-fill" style={{ width: pct + '%', background: col }} />
                      </div>
                      <div className="dt-cat-bar-val">{minsLabel(mins)}</div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="dt-divider" />

            <div className="dt-standup-box">
              <h4>Standup Summary – Copy to Clipboard</h4>
              <pre>{buildStandup()}</pre>
            </div>

            <div className="dt-summary-actions">
              <button className="dt-btn dt-btn-ghost dt-btn-sm" onClick={() => setExportOpen(true)}>
                <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                Export Report
              </button>
              <button className="dt-btn dt-btn-primary dt-btn-sm" onClick={copyStandup}>
                <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy Standup
              </button>
              <button className="dt-btn dt-btn-ghost dt-btn-sm" onClick={exportCSV}>
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export CSV
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Edit Modal */}
      {editEntry && (
        <div className="dt-modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setEditEntry(null) }}>
          <div className="dt-modal">
            <h3>Edit Entry</h3>
            <div className="form-group">
              <label className="form-label">Task Name</label>
              <input className="form-input" value={eName} onChange={e => setEName(e.target.value)} autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <CategoryChips value={eCat} onChange={setECat} categories={categories} />
            </div>
            <div className="dt-row2">
              <div className="form-group">
                <label className="form-label">Start Time</label>
                <div className="dt-time-wrap">
                  <input className="form-input" type="time" value={to24h(eStart)} onChange={e => setEStart(to12h(e.target.value))} />
                  <button className="dt-now-btn" onClick={() => setEStart(nowHHMM())}>Now</button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">End Time</label>
                <div className="dt-time-wrap">
                  <input className="form-input" type="time" value={to24h(eEnd)} onChange={e => setEEnd(to12h(e.target.value))} />
                  <button className="dt-now-btn" onClick={() => setEEnd(nowHHMM())}>Now</button>
                </div>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-input" value={eNotes} onChange={e => setENotes(e.target.value)} rows={2} />
            </div>
            <div className="dt-modal-footer">
              <button className="dt-btn dt-btn-ghost" onClick={() => setEditEntry(null)}>Cancel</button>
              <button className="dt-btn dt-btn-primary" onClick={saveEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Subtask Modal */}
      {subtaskParent && (
        <div className="dt-modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setSubtaskParent(null) }}>
          <div className="dt-modal">
            <h3>Add Subtask</h3>
            <div className="dt-subtask-parent-label">
              Parent: <strong>{subtaskParent.name}</strong>
              {subtaskParent.start_time && <span className="dt-subtask-parent-time"> · starts {subtaskParent.start_time}</span>}
            </div>
            <div className="form-group">
              <label className="form-label">Subtask Name *</label>
              <input className="form-input" value={stName} onChange={e => setStName(e.target.value)}
                placeholder="What's the subtask?" autoComplete="off"
                onKeyDown={e => e.key === 'Enter' && saveSubtask()} />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <CategoryChips value={stCat} onChange={setStCat} categories={categories} />
            </div>
            <div className="dt-row2">
              <div className="form-group">
                <label className="form-label">
                  Start Time
                  {subtaskParent.start_time && <span className="dt-subtask-time-hint"> (min: {subtaskParent.start_time})</span>}
                </label>
                <div className="dt-time-wrap">
                  <input className="form-input" type="time" value={to24h(stStart)} onChange={e => setStStart(to12h(e.target.value))} />
                  <button className="dt-now-btn" onClick={() => setStStart(nowHHMM())}>Now</button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">End Time</label>
                <div className="dt-time-wrap">
                  <input className="form-input" type="time" value={to24h(stEnd)} onChange={e => setStEnd(to12h(e.target.value))} />
                  <button className="dt-now-btn" onClick={() => setStEnd(nowHHMM())}>Now</button>
                </div>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-input" value={stNotes} onChange={e => setStNotes(e.target.value)} rows={2} />
            </div>
            <div className="dt-modal-footer">
              <button className="dt-btn dt-btn-ghost" onClick={() => setSubtaskParent(null)}>Cancel</button>
              <button className="dt-btn dt-btn-primary" onClick={saveSubtask}>Add Subtask</button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {exportOpen && (
        <div className="dt-modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setExportOpen(false) }}>
          <div className="dt-modal">
            <h3>Export Report</h3>

            {/* Mode toggle */}
            <div className="dt-tabs" style={{ marginBottom: 16 }}>
              <button className={`dt-tab ${exportMode === 'month' ? 'active' : ''}`} onClick={() => setExportMode('month')}>By Month</button>
              <button className={`dt-tab ${exportMode === 'custom' ? 'active' : ''}`} onClick={() => setExportMode('custom')}>Custom Range</button>
            </div>

            {exportMode === 'month' ? (
              <MonthPicker value={exportMonth} onChange={setExportMonth} />
            ) : (
              <div className="dt-row2">
                <CalendarPicker label="Start Date" value={exportStart} onChange={setExportStart} />
                <CalendarPicker label="End Date" value={exportEnd} onChange={setExportEnd} />
              </div>
            )}

            <div className="dt-modal-footer" style={{ marginTop: 20 }}>
              <button className="dt-btn dt-btn-ghost" onClick={() => setExportOpen(false)}>Cancel</button>
              <button className="dt-btn dt-btn-ghost dt-btn-sm" onClick={() => runExport('doc')} disabled={exportLoading}>
                <svg viewBox="0 0 24 24" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                {exportLoading ? 'Generating…' : 'Export DOC'}
              </button>
              <button className="dt-btn dt-btn-primary" onClick={() => runExport('pdf')} disabled={exportLoading}>
                <svg viewBox="0 0 24 24" width="14" height="14"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                {exportLoading ? 'Generating…' : 'Export PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portal category dropdown — renders above all stacking contexts */}
      {openDrop && dropPos && createPortal(
        <div
          className="pm-custom-dropdown-menu"
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: 'max-content', maxWidth: 260, zIndex: 9999 }}
          onMouseDown={e => e.stopPropagation()}
        >
          {categories.map(c => {
            const active =
              (openDrop === 'mCat' && mCat === c) ||
              (openDrop === 'tCat' && tCat === c) ||
              (openDrop === 'pCat' && pCat === c) ||
              (openDrop === 'eCat' && eCat === c) ||
              (openDrop === 'stCat' && stCat === c)
            const select = (v: string) => {
              if (openDrop === 'mCat') setMCat(v)
              else if (openDrop === 'tCat') setTCat(v)
              else if (openDrop === 'pCat') setPCat(v)
              else if (openDrop === 'eCat') setECat(v)
              else if (openDrop === 'stCat') setStCat(v)
              setOpenDrop(null)
            }
            return (
              <button key={c} className={`pm-dropdown-item${active ? ' active' : ''}`} onClick={() => select(c)}>
                <span className="dt-cat-dot" style={{ background: catColor(c, categories) }}/>{c}
              </button>
            )
          })}
        </div>,
        document.body
      )}

      <ToastContainer toasts={toasts} />
    </div>
  )
}
