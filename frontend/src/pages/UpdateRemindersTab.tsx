import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, X, ChevronDown, Send, Clock, Users, Calendar,
  Play, Eye, History, Trash2, AlertTriangle, CheckCircle,
  ToggleLeft, ToggleRight, Zap,
} from 'lucide-react'
import api from '../services/api'
import type {
  UpdateReminderRule, UpdateReminderRosterMember, UpdateReminderRun,
  UpdateReminderRunResult, SlackWorkspaceUser, ChannelRef,
} from '../services/api'
import { CustomDropdown } from '../components/CustomDropdown'
import { TimePicker } from '../components/TimePicker'
import { ConfirmModal } from '../components/ConfirmModal'
import '../styles/pages/slack-update-reminders.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PLACEHOLDERS = ['{names}', '{mentions}', '{date}', '{count}', '{on_leave_names}']

const DEFAULT_RULE: Partial<UpdateReminderRule> = {
  name: 'New Reminder',
  enabled: true,
  schedule_time: '11:00',
  schedule_days: [1, 2, 3, 4, 5],
  timezone: 'Asia/Kolkata',
  source_channel_ids: [],
  detection_mode: 'any_message',
  detection_value: '',
  check_day_offset: -1,
  check_window_start: '09:00',
  check_window_end: '18:00',
  leave_channel_id: '',
  leave_channel_name: '',
  leave_keywords: ['leave', 'wfh', 'sick', 'holiday', 'off', 'vacation', 'pto'],
  leave_action: 'exclude',
  delivery_channel: true,
  delivery_dm: false,
  delivery_channel_id: '',
  delivery_channel_name: '',
  channel_template: "Hey team! The following members haven't posted their update yet: {mentions}. Please share your update when you get a chance.",
  dm_template: 'Hi! Just a reminder to post your daily update in the team channel.',
}

// ── Shared portal channel menu ────────────────────────────────────────────────
// Used by both SourceChannelPicker (multi) and SearchableChannelDd (single).

function useChannelMenuPos(triggerRef: React.RefObject<HTMLButtonElement>, open: boolean) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    if (!open) return
    const pos = () => {
      if (!triggerRef.current) return
      const r = triggerRef.current.getBoundingClientRect()
      setStyle({ position: 'fixed', top: r.bottom + 4, left: r.left, width: r.width, zIndex: 9999 })
    }
    pos()
    window.addEventListener('scroll', pos, true)
    window.addEventListener('resize', pos)
    return () => { window.removeEventListener('scroll', pos, true); window.removeEventListener('resize', pos) }
  }, [open, triggerRef])
  return style
}

function ChannelMenu({ style, search, onSearch, items, activeId, onPick, manualId, onManualId, onManualAdd }: {
  style: React.CSSProperties
  search: string
  onSearch: (v: string) => void
  items: ChannelRef[]
  activeId?: string
  onPick: (c: ChannelRef) => void
  manualId: string
  onManualId: (v: string) => void
  onManualAdd: () => void
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { requestAnimationFrame(() => searchRef.current?.focus()) }, [])

  return createPortal(
    <div className="cd-portal-menu ur-ch-picker-menu" style={style}>
      <div className="cd-search-row">
        <input ref={searchRef} className="cd-search-input" placeholder="Search channels…" value={search} onChange={e => onSearch(e.target.value)} />
      </div>
      <div className="cd-option-list" style={{ maxHeight: 180 }}>
        {items.length === 0
          ? <div className="cd-no-results">No channels found</div>
          : items.map(c => (
            <button key={c.id} type="button" className={`pm-dropdown-item${activeId === c.id ? ' active' : ''}`} onClick={() => onPick(c)}>
              #{c.name}
            </button>
          ))
        }
      </div>
      <div className="ur-ch-picker-manual">
        <div className="ur-ch-picker-manual-label">Enter channel ID manually</div>
        <div className="ur-ch-picker-manual-row">
          <input
            className="ur-ch-picker-manual-input"
            placeholder="e.g. C0123456789"
            value={manualId}
            onChange={e => onManualId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onManualAdd() } }}
          />
          <button type="button" className="ur-ch-picker-add-btn" onClick={onManualAdd} disabled={!manualId.trim()}>Add</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Multi-select (source channels)
function SourceChannelPicker({ channels, selected, onAdd }: {
  channels: ChannelRef[]
  selected: ChannelRef[]
  onAdd: (ch: ChannelRef) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [manualId, setManualId] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuPos = useChannelMenuPos(triggerRef, open)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      const menu = document.querySelector('.ur-ch-picker-menu')
      if (menu?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const available = useMemo(() =>
    channels.filter(c => !selected.find(s => s.id === c.id) && (!search || c.name.toLowerCase().includes(search.toLowerCase()))),
    [channels, selected, search]
  )

  const addManual = () => {
    const id = manualId.trim()
    if (!id || selected.find(s => s.id === id)) { setManualId(''); return }
    onAdd({ id, name: id }); setManualId(''); setOpen(false)
  }

  return (
    <div className="pm-custom-dropdown ur-channel-dd">
      <button ref={triggerRef} type="button" className="pm-custom-dropdown-trigger" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setOpen(o => !o)}>
        <span style={{ color: 'var(--text-muted)' }}>Add channel…</span>
        <ChevronDown size={11} className={`dropdown-chevron${open ? ' open' : ''}`} />
      </button>
      {open && <ChannelMenu style={menuPos} search={search} onSearch={setSearch} items={available} onPick={c => { onAdd(c); setSearch(''); setOpen(false) }} manualId={manualId} onManualId={setManualId} onManualAdd={addManual} />}
    </div>
  )
}

// Single-select (leave channel, delivery channel, quick send)
function SearchableChannelDd({ channels, value, onChange, placeholder = 'Select channel…' }: {
  channels: ChannelRef[]
  value: string
  onChange: (id: string, name: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [manualId, setManualId] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuPos = useChannelMenuPos(triggerRef, open)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      const menu = document.querySelector('.ur-ch-picker-menu')
      if (menu?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const filtered = useMemo(() =>
    channels.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase())),
    [channels, search]
  )

  const selectedName = channels.find(c => c.id === value)?.name
  const triggerLabel = selectedName ? `#${selectedName}` : (value || placeholder)

  const pick = (id: string, name: string) => { onChange(id, name); setSearch(''); setOpen(false) }
  const addManual = () => { const id = manualId.trim(); if (!id) return; pick(id, id); setManualId('') }

  return (
    <div className="pm-custom-dropdown ur-channel-dd">
      <button ref={triggerRef} type="button" className="pm-custom-dropdown-trigger" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setOpen(o => !o)}>
        <span style={{ color: value ? 'var(--text-primary)' : 'var(--text-muted)' }}>{triggerLabel}</span>
        <ChevronDown size={11} className={`dropdown-chevron${open ? ' open' : ''}`} />
      </button>
      {open && <ChannelMenu style={menuPos} search={search} onSearch={setSearch} items={filtered} activeId={value} onPick={c => pick(c.id, c.name)} manualId={manualId} onManualId={setManualId} onManualAdd={addManual} />}
    </div>
  )
}

// ── Quick Send card ───────────────────────────────────────────────────────────

function QuickSendCard({ channels }: { channels: ChannelRef[] }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'channel' | 'dm'>('channel')
  const [channelId, setChannelId] = useState('')
  const [dmUserId, setDmUserId] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [users, setUsers] = useState<SlackWorkspaceUser[]>([])
  const [dmSearch, setDmSearch] = useState('')
  const [showDmDrop, setShowDmDrop] = useState(false)
  const [history, setHistory] = useState<Array<{ channel: string; msg: string; ts: string }>>([])
  const dmRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode === 'dm' && users.length === 0) {
      api.getWorkspaceUsers().then(r => { if (Array.isArray(r)) setUsers(r as SlackWorkspaceUser[]) }).catch(() => {})
    }
  }, [mode, users.length])

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (dmRef.current && !dmRef.current.contains(e.target as Node)) setShowDmDrop(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filteredUsers = users.filter(u =>
    !u.is_bot && !u.deleted &&
    ((u.profile.display_name || u.real_name).toLowerCase().includes(dmSearch.toLowerCase()))
  )

  const selectedUser = users.find(u => u.id === dmUserId)
  const selectedChannel = channels.find(c => c.id === channelId)

  const handleSend = async () => {
    if (!message.trim()) return
    setSending(true)
    try {
      const payload = mode === 'dm'
        ? { message, dm_user_id: dmUserId }
        : { message, channel_id: channelId }
      await api.quickSend(payload)
      const label = mode === 'dm' ? (selectedUser?.profile.display_name || selectedUser?.real_name || dmUserId) : (selectedChannel?.name || channelId)
      setHistory(h => [{ channel: label, msg: message, ts: new Date().toLocaleTimeString() }, ...h.slice(0, 9)])
      setMessage('')
      setSent(true)
      setTimeout(() => setSent(false), 2500)
    } catch {
      // error shown inline
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="ur-quick-send">
      <div className={`ur-qs-header${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)}>
        <Zap size={14} />
        Quick Send
        <ChevronDown size={13} className="ur-qs-caret" />
      </div>
      {open && (
        <div className="ur-qs-body">
          <div className="ur-qs-target">
            <button className={`ur-qs-mode-btn${mode === 'channel' ? ' active' : ''}`} onClick={() => setMode('channel')}># Channel</button>
            <button className={`ur-qs-mode-btn${mode === 'dm' ? ' active' : ''}`} onClick={() => setMode('dm')}>@ DM</button>
          </div>

          {mode === 'channel' ? (
            <SearchableChannelDd channels={channels} value={channelId} onChange={id => setChannelId(id)} />
          ) : (
            <div className="ur-user-search" ref={dmRef}>
              <input
                className="ur-user-search-input"
                placeholder="Search workspace member…"
                value={selectedUser ? (selectedUser.profile.display_name || selectedUser.real_name) : dmSearch}
                onChange={e => { setDmSearch(e.target.value); setDmUserId(''); setShowDmDrop(true) }}
                onFocus={() => setShowDmDrop(true)}
              />
              {showDmDrop && filteredUsers.length > 0 && (
                <div className="ur-user-dropdown">
                  {filteredUsers.slice(0, 20).map(u => (
                    <div key={u.id} className="ur-user-option" onMouseDown={() => { setDmUserId(u.id); setDmSearch(''); setShowDmDrop(false) }}>
                      {u.profile.image_48 && <img src={u.profile.image_48} className="ur-user-avatar" alt="" />}
                      <div className="ur-user-meta">
                        <span className="ur-user-name">{u.profile.display_name || u.real_name}</span>
                        <span className="ur-user-handle">@{u.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="ur-qs-row">
            <textarea
              className="ur-qs-textarea"
              placeholder="Type your message…"
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="ur-qs-send-btn"
              onClick={handleSend}
              disabled={sending || !message.trim() || (mode === 'channel' ? !channelId : !dmUserId)}
            >
              {sent ? <CheckCircle size={13} /> : <Send size={13} />}
              {sent ? 'Sent!' : sending ? 'Sending…' : 'Send Now'}
            </button>
          </div>

          {history.length > 0 && (
            <div className="ur-qs-history">
              {history.map((h, i) => (
                <div key={i} className="ur-qs-history-item">
                  <span className="ur-qs-history-ch">{h.channel}</span>
                  <span className="ur-qs-history-msg">{h.msg}</span>
                  <span>{h.ts}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Chip keyword input ────────────────────────────────────────────────────────

function ChipInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')
  const addChip = () => {
    const t = input.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setInput('')
  }
  return (
    <div className="ur-chip-input" onClick={e => { const inp = (e.currentTarget as HTMLElement).querySelector('input'); inp?.focus() }}>
      {value.map(v => (
        <span key={v} className="ur-chip">
          {v}
          <button type="button" onClick={() => onChange(value.filter(x => x !== v))}>×</button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip() } if (e.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1)) }}
        onBlur={addChip}
        placeholder={placeholder}
      />
    </div>
  )
}

// ── Roster member picker ──────────────────────────────────────────────────────

function RosterManager({ ruleId, members, onChange, workspaceUsers }: {
  ruleId: string
  members: UpdateReminderRosterMember[]
  onChange: () => void
  workspaceUsers: SlackWorkspaceUser[]
}) {
  const [search, setSearch] = useState('')
  const [showDrop, setShowDrop] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShowDrop(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = workspaceUsers.filter(u =>
    !u.is_bot && !u.deleted &&
    !members.find(m => m.slack_user_id === u.id) &&
    (u.profile.display_name || u.real_name).toLowerCase().includes(search.toLowerCase())
  )

  const addMember = async (u: SlackWorkspaceUser) => {
    await api.addUpdateReminderRosterMember(ruleId, {
      display_name: u.profile.display_name || u.real_name,
      slack_user_id: u.id,
      enabled: true,
    })
    setSearch('')
    setShowDrop(false)
    onChange()
  }

  const removeMember = async (m: UpdateReminderRosterMember) => {
    await api.deleteUpdateReminderRosterMember(ruleId, m.id)
    onChange()
  }

  const toggleMember = async (m: UpdateReminderRosterMember) => {
    await api.updateUpdateReminderRosterMember(ruleId, m.id, { enabled: !m.enabled })
    onChange()
  }

  return (
    <div>
      <div className="ur-roster-list">
        {members.map(m => (
          <div key={m.id} className="ur-roster-item">
            <span className="ur-roster-name" style={{ opacity: m.enabled ? 1 : 0.45 }}>{m.display_name}</span>
            <span className="ur-roster-id">@{m.slack_user_id}</span>
            <label className="ur-toggle" title={m.enabled ? 'Disable' : 'Enable'}>
              <input type="checkbox" checked={m.enabled} onChange={() => toggleMember(m)} />
              <span className="ur-toggle-slider" />
            </label>
            <button className="ur-roster-remove" onClick={() => removeMember(m)}><X size={12} /></button>
          </div>
        ))}
        {members.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No members yet — add from workspace below.</div>}
      </div>
      <div className="ur-add-member">
        <div className="ur-user-search" style={{ flex: 1 }} ref={ref}>
          <input
            className="ur-user-search-input"
            placeholder="Add workspace member…"
            value={search}
            onChange={e => { setSearch(e.target.value); setShowDrop(true) }}
            onFocus={() => setShowDrop(true)}
          />
          {showDrop && filtered.length > 0 && (
            <div className="ur-user-dropdown">
              {filtered.slice(0, 15).map(u => (
                <div key={u.id} className="ur-user-option" onMouseDown={() => addMember(u)}>
                  {u.profile.image_48 && <img src={u.profile.image_48} className="ur-user-avatar" alt="" />}
                  <div className="ur-user-meta">
                    <span className="ur-user-name">{u.profile.display_name || u.real_name}</span>
                    <span className="ur-user-handle">@{u.name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Rule editor panel ─────────────────────────────────────────────────────────

function RuleEditor({
  rule,
  channels,
  workspaceUsers,
  onClose,
  onSaved,
}: {
  rule: Partial<UpdateReminderRule> | null
  channels: ChannelRef[]
  workspaceUsers: SlackWorkspaceUser[]
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !rule?.id
  const [form, setForm] = useState<Partial<UpdateReminderRule>>(rule ?? DEFAULT_RULE)
  const [saving, setSaving] = useState(false)
  const [roster, setRoster] = useState<UpdateReminderRosterMember[]>([])
  const [templateTab, setTemplateTab] = useState<'channel' | 'dm'>('channel')

  useEffect(() => {
    if (rule?.id) {
      api.listUpdateReminderRoster(rule.id).then(r => { if (Array.isArray(r)) setRoster(r as UpdateReminderRosterMember[]) }).catch(() => {})
    }
  }, [rule?.id])

  const set = (patch: Partial<UpdateReminderRule>) => setForm(f => ({ ...f, ...patch }))

  const toggleDay = (d: number) => {
    const days = form.schedule_days ?? []
    set({ schedule_days: days.includes(d) ? days.filter(x => x !== d) : [...days, d] })
  }

  const previewMsg = (tmpl: string) => {
    const m: Record<string, string> = {
      '{names}': 'Alice, Bob', '{mentions}': '@Alice @Bob',
      '{date}': new Date().toLocaleDateString('en-IN'), '{count}': '2', '{on_leave_names}': 'Carol',
    }
    return tmpl.replace(/\{[^}]+\}/g, tag => m[tag] ?? tag)
  }

  const insertPlaceholder = (ph: string) => {
    const field = templateTab === 'channel' ? 'channel_template' : 'dm_template'
    set({ [field]: ((form[field] as string) ?? '') + ph })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (isNew) {
        await api.createUpdateReminderRule(form)
      } else {
        await api.updateUpdateReminderRule(rule!.id!, form)
      }
      onSaved()
      onClose()
    } catch {
      // error shown inline
    } finally {
      setSaving(false)
    }
  }

  const curTemplate = templateTab === 'channel' ? (form.channel_template ?? '') : (form.dm_template ?? '')

  return (
    <div className="ur-editor-overlay" onClick={onClose}>
      <div className="ur-editor-panel" onClick={e => e.stopPropagation()}>
        <div className="ur-editor-header">
          <div className="ur-editor-title">{isNew ? 'New Reminder Rule' : `Edit: ${form.name}`}</div>
          <button className="ur-editor-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="ur-editor-body">

          {/* Basics */}
          <div>
            <div className="ur-section-title">Basics</div>
            <div className="ur-field">
              <label className="ur-label">Rule name</label>
              <input className="ur-input" value={form.name ?? ''} onChange={e => set({ name: e.target.value })} placeholder="e.g. Morning Standup Check" />
            </div>
          </div>

          {/* Schedule */}
          <div>
            <div className="ur-section-title">Schedule</div>
            <div className="ur-field" style={{ marginBottom: 10 }}>
              <label className="ur-label">Fire at time</label>
              <TimePicker value={form.schedule_time ?? '11:00'} onChange={v => set({ schedule_time: v })} />
            </div>
            <div className="ur-field" style={{ marginBottom: 10 }}>
              <label className="ur-label">Timezone</label>
              <CustomDropdown
                value={(form.timezone ?? 'Asia/Kolkata') as string}
                options={[
                  { value: 'Asia/Kolkata',       label: 'Asia/Kolkata (IST)' },
                  { value: 'UTC',                label: 'UTC' },
                  { value: 'America/New_York',   label: 'America/New_York (ET)' },
                  { value: 'America/Los_Angeles',label: 'America/Los_Angeles (PT)' },
                  { value: 'Europe/London',      label: 'Europe/London (GMT)' },
                ]}
                onChange={v => set({ timezone: v })}
                className="ur-channel-dd"
              />
            </div>
            <div className="ur-field">
              <label className="ur-label">Days</label>
              <div className="ur-day-pills">
                {DAYS.map((d, i) => (
                  <button key={d} type="button" className={`ur-day-pill${(form.schedule_days ?? []).includes(i) ? ' active' : ''}`} onClick={() => toggleDay(i)}>{d}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Channels to watch */}
          <div>
            <div className="ur-section-title">Channels to watch</div>
            <div className="ur-field" style={{ marginBottom: 10 }}>
              <label className="ur-label">Source channels (posting ANY one counts)</label>
              <SourceChannelPicker
                channels={channels}
                selected={form.source_channel_ids ?? []}
                onAdd={ch => set({ source_channel_ids: [...(form.source_channel_ids ?? []), ch] })}
              />
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                {(form.source_channel_ids ?? []).map(c => (
                  <span key={c.id} className="ur-chip">#{c.name}<button type="button" onClick={() => set({ source_channel_ids: (form.source_channel_ids ?? []).filter(x => x.id !== c.id) })}>×</button></span>
                ))}
              </div>
            </div>
            <div className="ur-input-row">
              <div className="ur-field" style={{ flex: 1 }}>
                <label className="ur-label">Check day offset</label>
                <CustomDropdown
                  value={String(form.check_day_offset ?? -1)}
                  options={[
                    { value: '0',  label: 'Today' },
                    { value: '-1', label: 'Yesterday' },
                    { value: '-2', label: '2 days ago' },
                    { value: '-3', label: '3 days ago' },
                  ]}
                  onChange={v => set({ check_day_offset: Number(v) })}
                  className="ur-channel-dd"
                />
              </div>
              <div className="ur-field" style={{ flex: 1 }}>
                <label className="ur-label">Window start</label>
                <TimePicker value={form.check_window_start ?? '09:00'} onChange={v => set({ check_window_start: v })} />
              </div>
              <div className="ur-field" style={{ flex: 1 }}>
                <label className="ur-label">Window end</label>
                <TimePicker value={form.check_window_end ?? '18:00'} onChange={v => set({ check_window_end: v })} />
              </div>
            </div>
          </div>

          {/* Detection */}
          <div>
            <div className="ur-section-title">What counts as "posted"</div>
            <div className="ur-radio-group" style={{ marginBottom: 10 }}>
              {(['any_message', 'keywords', 'pattern'] as const).map(m => (
                <label key={m} className="ur-radio">
                  <input type="radio" name="detection" value={m} checked={form.detection_mode === m} onChange={() => set({ detection_mode: m })} />
                  {m === 'any_message' ? 'Any message' : m === 'keywords' ? 'Contains keywords' : 'Matches pattern (regex)'}
                </label>
              ))}
            </div>
            {(form.detection_mode === 'keywords' || form.detection_mode === 'pattern') && (
              <div className="ur-field">
                <label className="ur-label">{form.detection_mode === 'keywords' ? 'Keywords (press Enter to add)' : 'Regex pattern'}</label>
                {form.detection_mode === 'keywords'
                  ? <ChipInput value={(form.detection_value ?? '').split(',').filter(Boolean)} onChange={chips => set({ detection_value: chips.join(',') })} placeholder="Add keyword…" />
                  : <input className="ur-input" value={form.detection_value ?? ''} onChange={e => set({ detection_value: e.target.value })} placeholder="e.g. (update|standup|eod)" />
                }
              </div>
            )}
          </div>

          {/* Roster */}
          {!isNew && (
            <div>
              <div className="ur-section-title">Team Roster</div>
              <RosterManager
                ruleId={rule!.id!}
                members={roster}
                workspaceUsers={workspaceUsers}
                onChange={() => api.listUpdateReminderRoster(rule!.id!).then(r => { if (Array.isArray(r)) setRoster(r as UpdateReminderRosterMember[]) })}
              />
            </div>
          )}
          {isNew && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Save the rule first, then add team members to the roster.</div>}

          {/* Leave handling */}
          <div>
            <div className="ur-section-title">Leave handling</div>
            <div className="ur-field" style={{ marginBottom: 10 }}>
              <label className="ur-label">Leave / availability channel (optional)</label>
              <SearchableChannelDd
                channels={channels}
                value={form.leave_channel_id ?? ''}
                onChange={(id, name) => set({ leave_channel_id: id, leave_channel_name: name })}
                placeholder="None"
              />
            </div>
            {(form.leave_channel_id ?? '') !== '' && (
              <>
                <div className="ur-field" style={{ marginBottom: 10 }}>
                  <label className="ur-label">Leave keywords</label>
                  <ChipInput value={form.leave_keywords ?? []} onChange={v => set({ leave_keywords: v })} placeholder="Add keyword…" />
                </div>
                <div className="ur-field">
                  <label className="ur-label">If someone is on leave…</label>
                  <div className="ur-radio-group">
                    <label className="ur-radio">
                      <input type="radio" name="leave_action" value="exclude" checked={form.leave_action === 'exclude'} onChange={() => set({ leave_action: 'exclude' })} />
                      Exclude from reminder entirely
                    </label>
                    <label className="ur-radio">
                      <input type="radio" name="leave_action" value="list_separately" checked={form.leave_action === 'list_separately'} onChange={() => set({ leave_action: 'list_separately' })} />
                      List separately as "on leave"
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Delivery */}
          <div>
            <div className="ur-section-title">Delivery</div>
            <div className="ur-field" style={{ marginBottom: 10 }}>
              <label className="ur-radio" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={form.delivery_channel ?? true} onChange={e => set({ delivery_channel: e.target.checked })} />
                Post to channel
              </label>
              {form.delivery_channel && (
                <div style={{ marginTop: 4 }}>
                  <SearchableChannelDd
                    channels={channels}
                    value={form.delivery_channel_id ?? ''}
                    onChange={(id, name) => set({ delivery_channel_id: id, delivery_channel_name: name })}
                    placeholder="Select channel…"
                  />
                </div>
              )}
            </div>
            <label className="ur-radio">
              <input type="checkbox" checked={form.delivery_dm ?? false} onChange={e => set({ delivery_dm: e.target.checked })} />
              DM each missing member individually
            </label>
          </div>

          {/* Templates */}
          <div>
            <div className="ur-section-title">Message Templates</div>
            <div className="ur-template-tabs">
              <button className={`ur-template-tab${templateTab === 'channel' ? ' active' : ''}`} onClick={() => setTemplateTab('channel')}>Channel</button>
              <button className={`ur-template-tab${templateTab === 'dm' ? ' active' : ''}`} onClick={() => setTemplateTab('dm')}>DM</button>
            </div>
            <textarea
              className="ur-textarea"
              value={curTemplate}
              onChange={e => set({ [templateTab === 'channel' ? 'channel_template' : 'dm_template']: e.target.value })}
              style={{ minHeight: 90 }}
            />
            <div className="ur-placeholder-chips">
              {PLACEHOLDERS.map(ph => <button key={ph} type="button" className="ur-ph-chip" onClick={() => insertPlaceholder(ph)}>{ph}</button>)}
            </div>
            <div style={{ marginTop: 8 }}>
              <div className="ur-label" style={{ marginBottom: 4 }}>Preview</div>
              <div className="ur-preview">{previewMsg(curTemplate)}</div>
            </div>
          </div>

        </div>

        <div className="ur-editor-footer">
          <button className="ur-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="ur-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create Rule' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Run result modal ──────────────────────────────────────────────────────────

function RunResultModal({ result, isDryRun, onSendOriginal, onSendUpdated, onClose }: {
  result: UpdateReminderRunResult
  isDryRun: boolean
  onSendOriginal: () => void
  onSendUpdated: () => void
  onClose: () => void
}) {
  const { snapshot, diff, rendered_msg } = result
  const hasChanges = diff?.has_changes

  return (
    <div className="ur-result-overlay" onClick={onClose}>
      <div className="ur-result-modal" onClick={e => e.stopPropagation()}>
        <div className="ur-result-header">
          <Eye size={16} style={{ color: 'var(--color-primary)' }} />
          <div className="ur-result-title">{isDryRun ? 'Dry Run Preview' : 'Run Result'}</div>
          <button className="ur-editor-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ur-result-body">
          {hasChanges && isDryRun && (
            <div className="ur-diff-banner">
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span>
                {diff.now_posted.length > 0 && `${diff.now_posted.map(m => m.display_name).join(', ')} posted since last snapshot. `}
                {diff.now_missing.length > 0 && `${diff.now_missing.map(m => m.display_name).join(', ')} newly missing. `}
                Sending will use the fresh snapshot.
              </span>
            </div>
          )}

          {snapshot.missing.length > 0 && (
            <div className="ur-names-group">
              <div className="ur-names-label">Missing ({snapshot.missing.length})</div>
              <div>{snapshot.missing.map(m => <span key={m.slack_user_id} className="ur-name-pill missing">{m.display_name}</span>)}</div>
            </div>
          )}
          {snapshot.posted.length > 0 && (
            <div className="ur-names-group">
              <div className="ur-names-label">Posted ({snapshot.posted.length})</div>
              <div>{snapshot.posted.map(m => <span key={m.slack_user_id} className="ur-name-pill">{m.display_name}</span>)}</div>
            </div>
          )}
          {snapshot.on_leave.length > 0 && (
            <div className="ur-names-group">
              <div className="ur-names-label">On leave ({snapshot.on_leave.length})</div>
              <div>{snapshot.on_leave.map(m => <span key={m.slack_user_id} className="ur-name-pill on-leave">{m.display_name}</span>)}</div>
            </div>
          )}

          <div>
            <div className="ur-names-label" style={{ marginBottom: 6 }}>Rendered message</div>
            <div className="ur-preview">{rendered_msg}</div>
          </div>
        </div>
        <div className="ur-result-footer">
          <button className="ur-btn-secondary" onClick={onClose}>Close</button>
          {isDryRun && hasChanges && (
            <>
              <button className="ur-btn-secondary" onClick={onSendOriginal}>Send Original Snapshot</button>
              <button className="ur-btn-primary" onClick={onSendUpdated}>Send Updated</button>
            </>
          )}
          {isDryRun && !hasChanges && (
            <button className="ur-btn-primary" onClick={onSendUpdated}>Send Now</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── History modal ─────────────────────────────────────────────────────────────

function HistoryModal({ ruleId, ruleName, onClose }: { ruleId: string; ruleName: string; onClose: () => void }) {
  const [runs, setRuns] = useState<UpdateReminderRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getUpdateReminderHistory(ruleId).then(r => { if (Array.isArray(r)) setRuns(r as UpdateReminderRun[]) }).catch(() => {}).finally(() => setLoading(false))
  }, [ruleId])

  return (
    <div className="ur-result-overlay" onClick={onClose}>
      <div className="ur-result-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="ur-result-header">
          <History size={16} style={{ color: 'var(--color-primary)' }} />
          <div className="ur-result-title">Run History — {ruleName}</div>
          <button className="ur-editor-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ur-result-body">
          {loading ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
          : runs.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No runs yet.</div>
          : runs.map(run => (
            <div key={run.id} className="ur-history-row">
              <div className="ur-history-date">{new Date(run.ran_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</div>
              <span className="ur-history-by">{run.triggered_by}</span>
              <div className="ur-history-counts">
                <span className="ur-history-count-item" style={{ color: 'var(--color-success)' }}><CheckCircle size={11} />{run.posted_names.length} posted</span>
                <span className="ur-history-count-item" style={{ color: 'var(--color-danger)' }}><AlertTriangle size={11} />{run.skipped_names.length} missing</span>
              </div>
              {run.error && <div className="ur-history-error">{run.error}</div>}
            </div>
          ))}
        </div>
        <div className="ur-result-footer">
          <button className="ur-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Rule card ─────────────────────────────────────────────────────────────────

const RuleCard = function RuleCard({ rule, channels, workspaceUsers, onRefresh }: {
  rule: UpdateReminderRule
  channels: ChannelRef[]
  workspaceUsers: SlackWorkspaceUser[]
  onRefresh: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<UpdateReminderRunResult | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [running, setRunning] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await api.toggleUpdateReminderRule(rule.id, e.target.checked).catch(() => {})
    onRefresh()
  }

  const handleDelete = async () => {
    await api.deleteUpdateReminderRule(rule.id).catch(() => {})
    setConfirmDelete(false)
    onRefresh()
  }

  const handleDryRun = async () => {
    setRunning(true)
    try {
      const r = await api.dryRunUpdateReminder(rule.id)
      if (r && typeof r === 'object' && 'snapshot' in r) setDryRunResult(r as unknown as UpdateReminderRunResult)
    } finally {
      setRunning(false)
    }
  }

  const handleRunNow = async (forceSnapshot: boolean) => {
    setDryRunResult(null)
    setRunning(true)
    try {
      await api.runNowUpdateReminder(rule.id, forceSnapshot)
      onRefresh()
    } finally {
      setRunning(false)
    }
  }

  const schedLabel = (() => {
    const days = (rule.schedule_days ?? []).sort().map(d => DAYS[d]).join(' ')
    return `${days} at ${rule.schedule_time} ${rule.timezone.split('/')[1] ?? rule.timezone}`
  })()

  const srcLabel = (rule.source_channel_ids ?? []).map(c => `#${c.name}`).join(', ') || 'No channels'

  return (
    <>
      <div className="ur-card">
        <div className="ur-card-top">
          <label className="ur-toggle">
            <input type="checkbox" checked={rule.enabled} onChange={handleToggle} />
            <span className="ur-toggle-slider" />
          </label>
          <span className="ur-card-name">{rule.name}</span>
        </div>
        <div className="ur-card-meta">
          <span className="ur-card-meta-item"><Clock size={11} />{schedLabel}</span>
          <span className="ur-card-meta-item"><Users size={11} />{srcLabel}</span>
          {rule.last_snapshot_at && (
            <span className="ur-card-meta-item"><Calendar size={11} />Last: {new Date(rule.last_snapshot_at).toLocaleDateString('en-IN')}</span>
          )}
        </div>
        <div className="ur-card-actions">
          <button className="ur-action-btn" onClick={() => setEditing(true)}><Plus size={12} />Edit</button>
          <button className="ur-action-btn" onClick={handleDryRun} disabled={running}><Eye size={12} />Dry Run</button>
          <button className="ur-action-btn" onClick={() => handleRunNow(true)} disabled={running}><Play size={12} />Run Now</button>
          <button className="ur-action-btn" onClick={() => setShowHistory(true)}><History size={12} />History</button>
          <button className="ur-action-btn danger" onClick={() => setConfirmDelete(true)}><Trash2 size={12} />Delete</button>
        </div>
      </div>

      {editing && (
        <RuleEditor
          rule={rule}
          channels={channels}
          workspaceUsers={workspaceUsers}
          onClose={() => setEditing(false)}
          onSaved={onRefresh}
        />
      )}

      {dryRunResult && (
        <RunResultModal
          result={dryRunResult}
          isDryRun
          onSendOriginal={() => { setDryRunResult(null); handleRunNow(false) }}
          onSendUpdated={() => { setDryRunResult(null); handleRunNow(true) }}
          onClose={() => setDryRunResult(null)}
        />
      )}

      {showHistory && <HistoryModal ruleId={rule.id} ruleName={rule.name} onClose={() => setShowHistory(false)} />}

      {confirmDelete && (
        <ConfirmModal
          message={`Delete "${rule.name}"?`}
          detail="This will remove the rule and all its run history. This cannot be undone."
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

// ── Main tab component ────────────────────────────────────────────────────────

export function UpdateRemindersTab({ channels }: { channels: ChannelRef[] }) {
  const [rules, setRules] = useState<UpdateReminderRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [workspaceUsers, setWorkspaceUsers] = useState<SlackWorkspaceUser[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.listUpdateReminderRules()
      if (Array.isArray(r)) setRules(r as UpdateReminderRule[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.getWorkspaceUsers().then(r => { if (Array.isArray(r)) setWorkspaceUsers(r as SlackWorkspaceUser[]) }).catch(() => {})
  }, [])

  return (
    <div className="ur-root">
      <QuickSendCard channels={channels} />

      <div className="ur-list-header">
        <span className="ur-list-title">Reminder Rules</span>
        <button className="ur-new-btn" onClick={() => setShowNew(true)}>
          <Plus size={13} /> New Rule
        </button>
      </div>

      {loading ? (
        [0, 1, 2].map(i => (
          <div key={i} className="ur-skeleton-card">
            <div className="skeleton" style={{ width: '40%', height: 14, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: '65%', height: 11, borderRadius: 4 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              {[80, 70, 75, 70].map((w, j) => <div key={j} className="skeleton" style={{ width: w, height: 26, borderRadius: 6 }} />)}
            </div>
          </div>
        ))
      ) : rules.length === 0 ? (
        <div className="ur-empty">
          <ToggleLeft size={28} style={{ marginBottom: 8, color: 'var(--text-muted)' }} />
          <div>No reminder rules yet.</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Create your first rule to start automating update checks.</div>
        </div>
      ) : (
        rules.map(rule => (
          <RuleCard
            key={rule.id}
            rule={rule}
            channels={channels}
            workspaceUsers={workspaceUsers}
            onRefresh={load}
          />
        ))
      )}

      {showNew && (
        <RuleEditor
          rule={null}
          channels={channels}
          workspaceUsers={workspaceUsers}
          onClose={() => setShowNew(false)}
          onSaved={load}
        />
      )}
    </div>
  )
}
