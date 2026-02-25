import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Bold, Italic, Strikethrough, Code, Link2, List, MoreHorizontal,
  ChevronDown, Loader2, Check, Eye, FileCode2, Paperclip,
  Type, Hash,
} from 'lucide-react'
import api from '../services/api'
import type { YouTrackUser, YouTrackState } from '../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateIssueFormData {
  summary: string
  description: string
  state: string
  priority: string
  assignee_login: string
  assignee_name: string
  assignee_avatar: string
  subsystem: string
  due_date: string
  estimation: string
}

interface CreateIssueModalProps {
  onClose: () => void
  onCreated: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEstimation(raw: string): number | undefined {
  if (!raw.trim()) return undefined
  let total = 0
  const hMatch = raw.match(/(\d+)\s*h/i)
  const mMatch = raw.match(/(\d+)\s*m/i)
  if (hMatch) total += parseInt(hMatch[1]) * 60
  if (mMatch) total += parseInt(mMatch[1])
  return total > 0 ? total : undefined
}

const PRIORITIES = ['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor']
const PRIORITY_LETTER: Record<string, string> = {
  'Show-stopper': 'S',
  'Critical':     'C',
  'Major':        'M',
  'Normal':       'N',
  'Minor':        'n',
}
const PRIORITY_DOT_CLASS: Record<string, string> = {
  'Show-stopper': 'ci-priority-dot--showstopper',
  'Critical':     'ci-priority-dot--critical',
  'Major':        'ci-priority-dot--major',
  'Normal':       'ci-priority-dot--normal',
  'Minor':        'ci-priority-dot--minor',
}

const SUBSYSTEMS = ['mobile', 'backend', 'frontend', 'infra', 'design', 'qa']
const DEFAULT_STATES: YouTrackState[] = [
  { name: 'Backlog' }, { name: 'Open' }, { name: 'In Progress' },
  { name: 'Dev' }, { name: 'Stage' }, { name: 'Done' }, { name: 'Cancelled' },
]

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CreateIssueModal({ onClose, onCreated }: CreateIssueModalProps) {
  const [form, setForm] = useState<CreateIssueFormData>({
    summary: '',
    description: '',
    state: 'Backlog',
    priority: 'Normal',
    assignee_login: '',
    assignee_name: '',
    assignee_avatar: '',
    subsystem: '',
    due_date: '',
    estimation: '',
  })

  const [users, setUsers] = useState<YouTrackUser[]>([])
  const [states, setStates] = useState<YouTrackState[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<'state' | 'priority' | 'assignee' | 'subsystem' | 'textformat' | null>(null)
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [descMode, setDescMode] = useState<'visual' | 'markdown'>('visual')

  const summaryRef = useRef<HTMLInputElement>(null)
  const descRef    = useRef<HTMLTextAreaElement>(null)
  const modalRef   = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getYouTrackUsers().then(res => {
      const list = Array.isArray(res) ? res : (res as any).data ?? []
      setUsers(list)
    }).catch(() => {})
    api.getYouTrackStates().then(res => {
      const list = Array.isArray(res) ? res : (res as any).data ?? []
      setStates(list.length ? list : DEFAULT_STATES)
    }).catch(() => setStates(DEFAULT_STATES))
  }, [])

  useEffect(() => { summaryRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!modalRef.current?.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const set = (k: keyof CreateIssueFormData, v: string) =>
    setForm(f => ({ ...f, [k]: v }))

  const wrapText = useCallback((before: string, after = before) => {
    const ta = descRef.current
    if (!ta) return
    const s = ta.selectionStart, e = ta.selectionEnd
    const selected = ta.value.slice(s, e)
    set('description', ta.value.slice(0, s) + before + selected + after + ta.value.slice(e))
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(s + before.length, e + before.length)
    })
  }, [])

  const insertLine = useCallback((prefix: string) => {
    const ta = descRef.current
    if (!ta) return
    const s = ta.selectionStart
    const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1
    set('description', ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart))
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(s + prefix.length, s + prefix.length)
    })
  }, [])

  const handleCreate = async () => {
    if (!form.summary.trim()) return
    setCreating(true)
    setError(null)
    try {
      const dueDateMs      = form.due_date ? new Date(form.due_date).getTime() : undefined
      const estimationMins = parseEstimation(form.estimation)
      const res = await api.createYouTrackIssue({
        summary:            form.summary.trim(),
        description:        form.description || undefined,
        state:              form.state || undefined,
        priority:           form.priority || undefined,
        assignee_login:     form.assignee_login || undefined,
        subsystem:          form.subsystem || undefined,
        due_date:           dueDateMs,
        estimation_minutes: estimationMins,
      })
      if (res.success) {
        setCreated(true)
        setTimeout(() => { onCreated(); onClose() }, 700)
      } else {
        setError('Failed to create issue')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create issue')
    } finally {
      setCreating(false)
    }
  }

  const filteredUsers = users.filter(u =>
    !assigneeSearch ||
    u.fullName?.toLowerCase().includes(assigneeSearch.toLowerCase()) ||
    u.login?.toLowerCase().includes(assigneeSearch.toLowerCase())
  )

  const toggle = (name: typeof openDropdown) =>
    setOpenDropdown(o => o === name ? null : name)

  const canCreate = form.summary.trim().length > 0 && !creating && !created

  return (
    <div className="ci-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ci-modal" ref={modalRef}>
        <button className="ci-close-btn" onClick={onClose} title="Close"><X size={15} /></button>

        {/* ══ LEFT PANEL ═══════════════════════════════════════════════ */}
        <div className="ci-left">

          {/* Summary */}
          <input
            ref={summaryRef}
            className="ci-summary-input"
            placeholder="Summary"
            value={form.summary}
            onChange={e => set('summary', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); descRef.current?.focus() } }}
          />

          {/* Formatting toolbar */}
          <div className="ci-toolbar">
            <div className="ci-toolbar-left">
              {/* Text format dropdown */}
              <div style={{ position: 'relative' }}>
                <button
                  className="ci-tb-btn"
                  onClick={() => toggle('textformat')}
                  title="Text format"
                >
                  <Type size={13} />
                  <span style={{ fontSize: '12px', marginLeft: '3px' }}>Normal text</span>
                  <ChevronDown size={11} style={{ marginLeft: '2px' }} />
                </button>
                {openDropdown === 'textformat' && (
                  <div className="ci-dropdown-menu" style={{ left: 0, top: 'calc(100% + 4px)', minWidth: '140px' }} onClick={e => e.stopPropagation()}>
                    {['Normal text', 'Heading 1', 'Heading 2', 'Heading 3', 'Code block'].map(t => (
                      <button key={t} className="ci-dropdown-item" onClick={() => setOpenDropdown(null)}>{t}</button>
                    ))}
                  </div>
                )}
              </div>

              <div className="ci-tb-sep" />

              <button className="ci-tb-btn" title="Bold"          onClick={() => wrapText('**')}><Bold size={14} /></button>
              <button className="ci-tb-btn" title="Italic"        onClick={() => wrapText('*')}><Italic size={14} /></button>
              <button className="ci-tb-btn" title="Strikethrough" onClick={() => wrapText('~~')}><Strikethrough size={14} /></button>
              <button className="ci-tb-btn" title="Colour"><span style={{ fontWeight: 700, fontSize: '13px', textDecoration: 'underline', color: 'rgba(255,255,255,0.5)' }}>A</span></button>
              <button className="ci-tb-btn" title="Quote"         onClick={() => insertLine('> ')}><Hash size={14} /></button>
              <button className="ci-tb-btn" title="Code"          onClick={() => wrapText('`')}><Code size={14} /></button>
              <button className="ci-tb-btn" title="Link"          onClick={() => wrapText('[', '](url)')}><Link2 size={14} /></button>
              <button className="ci-tb-btn" title="List"          onClick={() => insertLine('- ')}><List size={14} /></button>
              <button className="ci-tb-btn" title="More"><MoreHorizontal size={14} /></button>
            </div>

            {/* Visual / Markdown toggle */}
            <div className="ci-mode-tabs">
              <button
                className={`ci-mode-tab ${descMode === 'visual' ? 'active' : ''}`}
                onClick={() => setDescMode('visual')}
              ><Eye size={12} /> Visual</button>
              <button
                className={`ci-mode-tab ${descMode === 'markdown' ? 'active' : ''}`}
                onClick={() => setDescMode('markdown')}
              ><FileCode2 size={12} /> Markdown</button>
            </div>
          </div>

          {/* Description — textarea in markdown mode, rendered preview in visual mode */}
          {descMode === 'markdown' ? (
            <textarea
              ref={descRef}
              className="ci-desc-input"
              placeholder="Type or paste description here"
              value={form.description}
              onChange={e => set('description', e.target.value)}
            />
          ) : (
            <div
              className="ci-desc-input ci-desc-preview"
              onClick={() => { setDescMode('markdown'); setTimeout(() => descRef.current?.focus(), 50) }}
            >
              {form.description
                ? <pre className="ci-desc-pre">{form.description}</pre>
                : <span className="ci-desc-placeholder">Type or paste description here</span>
              }
            </div>
          )}

          {/* Attach files */}
          <div className="ci-attach-row">
            <Paperclip size={14} />
            <span>Click to <span style={{ color: '#a78bfa', textDecoration: 'underline', cursor: 'pointer' }}>browse</span> or drag files here</span>
          </div>

          {/* Similar issues */}
          <div style={{ marginTop: '0.5rem' }}>
            <button className="ci-tb-btn" style={{ gap: '5px', fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>
              <ChevronDown size={13} /> Similar Issues and Articles
            </button>
          </div>

          {error && <div className="ci-error">{error}</div>}

          {/* Footer actions */}
          <div className="ci-actions">
            <button
              className="ci-btn-create"
              onClick={handleCreate}
              disabled={!canCreate}
            >
              {created ? (
                <><Check size={14} /> Created</>
              ) : creating ? (
                <><Loader2 size={14} className="animate-spin" /> Creating…</>
              ) : (
                'Create'
              )}
            </button>
            <button className="ci-btn-cancel" onClick={onClose}>Cancel</button>
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button className="ci-tb-btn" style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', gap: '4px' }}>
                <Eye size={13} /> Visible to issue readers
              </button>
              <button className="ci-tb-btn" style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', gap: '4px' }}>
                ↗ View in full page
              </button>
            </span>
          </div>
        </div>

        {/* ══ RIGHT SIDEBAR ════════════════════════════════════════════ */}
        <div className="ci-sidebar">

          {/* Project */}
          <div className="ci-sidebar-field">
            <span className="ci-sidebar-label">Project</span>
            <div className="ci-sidebar-value">
              <span className="ci-project-badge">ARD</span>
              <span className="ci-sidebar-val-text">ARD</span>
            </div>
          </div>

          {/* Priority */}
          <div className="ci-sidebar-field ci-dropdown-field" onClick={() => toggle('priority')}>
            <span className="ci-sidebar-label">Priority</span>
            <div className={`ci-sidebar-value ci-clickable`}>
              <span className={`ci-priority-dot ${PRIORITY_DOT_CLASS[form.priority] ?? 'ci-priority-dot--normal'}`} />
              <span className="ci-sidebar-val-text">{PRIORITY_LETTER[form.priority] ?? 'N'} {form.priority}</span>
              <ChevronDown size={13} className={`ci-chevron ${openDropdown === 'priority' ? 'open' : ''}`} />
            </div>
            {openDropdown === 'priority' && (
              <div className="ci-dropdown-menu" onClick={e => e.stopPropagation()}>
                {PRIORITIES.map(p => (
                  <button
                    key={p}
                    className={`ci-dropdown-item ${form.priority === p ? 'active' : ''}`}
                    onClick={() => { set('priority', p); setOpenDropdown(null) }}
                  >
                    <span className={`ci-priority-dot ${PRIORITY_DOT_CLASS[p]}`} />
                    <span>{PRIORITY_LETTER[p]} {p}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* State */}
          <div className="ci-sidebar-field ci-dropdown-field" onClick={() => toggle('state')}>
            <span className="ci-sidebar-label">State</span>
            <div className="ci-sidebar-value ci-clickable">
              <span className="ci-sidebar-val-text" style={{ color: '#a78bfa' }}>{form.state}</span>
              <ChevronDown size={13} className={`ci-chevron ${openDropdown === 'state' ? 'open' : ''}`} />
            </div>
            {openDropdown === 'state' && (
              <div className="ci-dropdown-menu" onClick={e => e.stopPropagation()}>
                {states.map(s => (
                  <button
                    key={s.name}
                    className={`ci-dropdown-item ${form.state === s.name ? 'active' : ''}`}
                    onClick={() => { set('state', s.name); setOpenDropdown(null) }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Assignee */}
          <div className="ci-sidebar-field ci-dropdown-field" onClick={() => { toggle('assignee'); setAssigneeSearch('') }}>
            <span className="ci-sidebar-label">Assignee</span>
            <div className="ci-sidebar-value ci-clickable">
              {form.assignee_login ? (
                <>
                  {form.assignee_avatar
                    ? <img src={form.assignee_avatar} alt="" className="ci-avatar-img" />
                    : <span className="ci-avatar-placeholder">{(form.assignee_name || form.assignee_login).charAt(0).toUpperCase()}</span>
                  }
                  <span className="ci-sidebar-val-text">{form.assignee_name || form.assignee_login}</span>
                </>
              ) : (
                <span className="ci-sidebar-val-placeholder">Unassigned</span>
              )}
              <ChevronDown size={13} className={`ci-chevron ${openDropdown === 'assignee' ? 'open' : ''}`} />
            </div>
            {openDropdown === 'assignee' && (
              <div className="ci-dropdown-menu ci-assignee-menu" onClick={e => e.stopPropagation()}>
                <input
                  className="ci-assignee-search"
                  placeholder="Search members…"
                  value={assigneeSearch}
                  onChange={e => setAssigneeSearch(e.target.value)}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
                <button
                  className={`ci-dropdown-item ${!form.assignee_login ? 'active' : ''}`}
                  onClick={() => { set('assignee_login', ''); set('assignee_name', ''); set('assignee_avatar', ''); setOpenDropdown(null) }}
                >
                  <span className="ci-avatar-placeholder">–</span>
                  <span>Unassigned</span>
                </button>
                {filteredUsers.map(u => (
                  <button
                    key={u.id}
                    className={`ci-dropdown-item ${form.assignee_login === u.login ? 'active' : ''}`}
                    onClick={() => {
                      set('assignee_login', u.login)
                      set('assignee_name', u.fullName || u.login)
                      set('assignee_avatar', u.avatarUrl || '')
                      setOpenDropdown(null)
                    }}
                  >
                    {u.avatarUrl
                      ? <img src={u.avatarUrl} alt={u.fullName} className="ci-avatar-img" />
                      : <span className="ci-avatar-placeholder">{(u.fullName || u.login).charAt(0).toUpperCase()}</span>
                    }
                    <span>{u.fullName || u.login}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Subsystem */}
          <div className="ci-sidebar-field ci-dropdown-field" onClick={() => toggle('subsystem')}>
            <span className="ci-sidebar-label">Subsystem</span>
            <div className="ci-sidebar-value ci-clickable">
              {form.subsystem
                ? <span className="ci-sidebar-val-text">{form.subsystem}</span>
                : <span className="ci-sidebar-val-placeholder">No subsystem</span>
              }
              <ChevronDown size={13} className={`ci-chevron ${openDropdown === 'subsystem' ? 'open' : ''}`} />
            </div>
            {openDropdown === 'subsystem' && (
              <div className="ci-dropdown-menu" onClick={e => e.stopPropagation()}>
                <button
                  className={`ci-dropdown-item ${!form.subsystem ? 'active' : ''}`}
                  onClick={() => { set('subsystem', ''); setOpenDropdown(null) }}
                >No subsystem</button>
                {SUBSYSTEMS.map(s => (
                  <button
                    key={s}
                    className={`ci-dropdown-item ${form.subsystem === s ? 'active' : ''}`}
                    onClick={() => { set('subsystem', s); setOpenDropdown(null) }}
                  >{s}</button>
                ))}
              </div>
            )}
          </div>

          {/* Estimation */}
          <div className="ci-sidebar-field">
            <span className="ci-sidebar-label">Estimation</span>
            <input
              className="ci-sidebar-input"
              placeholder="e.g. 2h 30m"
              value={form.estimation}
              onChange={e => set('estimation', e.target.value)}
              onClick={e => { e.stopPropagation(); setOpenDropdown(null) }}
            />
          </div>

          {/* Done (read-only) */}
          <div className="ci-sidebar-field">
            <span className="ci-sidebar-label">Done</span>
            <div className="ci-sidebar-value">
              <span className="ci-sidebar-val-placeholder">No done</span>
            </div>
          </div>

          {/* Spent time (read-only) */}
          <div className="ci-sidebar-field">
            <span className="ci-sidebar-label">Spent time</span>
            <div className="ci-sidebar-value">
              <span className="ci-sidebar-val-placeholder">—</span>
            </div>
          </div>

          {/* Due Date */}
          <div className="ci-sidebar-field">
            <span className="ci-sidebar-label">Due Date</span>
            <input
              type="date"
              className="ci-sidebar-input ci-date-input"
              value={form.due_date}
              onChange={e => set('due_date', e.target.value)}
              onClick={e => { e.stopPropagation(); setOpenDropdown(null) }}
            />
          </div>

        </div>
      </div>
    </div>
  )
}
