import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown, Plus, X, RefreshCw, Send, Hash } from 'lucide-react'
import { standupApi, type StandupConfig, type PersonUpdate, type UpdateSection } from '@/services/api'
import '../styles/pages/standup-compiler.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
}

interface SlackChannel { id: string; name: string; is_member: boolean }

export function StandupCompilerPage() {
  const today = new Date().toISOString().slice(0, 10)

  // Config state
  const [configOpen, setConfigOpen] = useState(true)
  const [cfg, setCfg] = useState<StandupConfig>({
    source_channels: [],
    dest_channel_id: '',
    dest_channel_name: '',
    time_window_start: '18:00',
    time_window_end: '19:30',
  })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Available Slack channels
  const [allChannels, setAllChannels] = useState<SlackChannel[]>([])
  const [srcPickerOpen, setSrcPickerOpen] = useState(false)
  const [destPickerOpen, setDestPickerOpen] = useState(false)
  const srcRef = useRef<HTMLDivElement>(null)
  const destRef = useRef<HTMLDivElement>(null)

  // Compile state
  const [compileDate, setCompileDate] = useState(today)
  const [compiling, setCompiling] = useState(false)
  const [compileError, setCompileError] = useState('')
  const [updates, setUpdates] = useState<PersonUpdate[]>([])

  // Post state
  const [posting, setPosting] = useState(false)
  const [postMsg, setPostMsg] = useState('')

  // Load config + channels on mount
  useEffect(() => {
    standupApi.getConfig().then(r => {
      if (r.success) setCfg(r.config)
    }).catch(() => {})

    fetch(`${API_URL}/slack/channels`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.channels) setAllChannels(d.channels)
        else if (Array.isArray(d)) setAllChannels(d)
      })
      .catch(() => {})
  }, [])

  // Close pickers on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (srcRef.current && !srcRef.current.contains(e.target as Node)) setSrcPickerOpen(false)
      if (destRef.current && !destRef.current.contains(e.target as Node)) setDestPickerOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function addSourceChannel(ch: SlackChannel) {
    if (cfg.source_channels.some(s => s.id === ch.id)) return
    setCfg(c => ({ ...c, source_channels: [...c.source_channels, { id: ch.id, name: ch.name }] }))
    setSrcPickerOpen(false)
  }

  function removeSourceChannel(id: string) {
    setCfg(c => ({ ...c, source_channels: c.source_channels.filter(s => s.id !== id) }))
  }

  function setDestChannel(ch: SlackChannel) {
    setCfg(c => ({ ...c, dest_channel_id: ch.id, dest_channel_name: ch.name }))
    setDestPickerOpen(false)
  }

  async function saveConfig() {
    setSaving(true)
    setSaveMsg('')
    try {
      await standupApi.saveConfig(cfg)
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(''), 2000)
      setConfigOpen(false)
    } catch {
      setSaveMsg('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function compile() {
    setCompiling(true)
    setCompileError('')
    setUpdates([])
    setPostMsg('')
    try {
      const res = await standupApi.compile(compileDate !== today ? compileDate : undefined)
      if (res.success) setUpdates(res.updates)
    } catch (e: unknown) {
      setCompileError(e instanceof Error ? e.message : 'Compile failed')
    } finally {
      setCompiling(false)
    }
  }

  async function postToSlack() {
    if (!cfg.dest_channel_id) {
      setPostMsg('No destination channel selected')
      return
    }
    setPosting(true)
    setPostMsg('')
    try {
      await standupApi.post(updates, cfg.dest_channel_id)
      setPostMsg(`Posted to #${cfg.dest_channel_name || cfg.dest_channel_id}`)
    } catch (e: unknown) {
      setPostMsg(e instanceof Error ? e.message : 'Post failed')
    } finally {
      setPosting(false)
    }
  }

  function updateItem(personIdx: number, sectionIdx: number, itemIdx: number, value: string) {
    setUpdates(prev => prev.map((p, pi) => {
      if (pi !== personIdx) return p
      const sections: UpdateSection[] = p.sections.map((sec, si) => {
        if (si !== sectionIdx) return sec
        const items = [...sec.items]
        items[itemIdx] = value
        return { ...sec, items }
      })
      return { ...p, sections }
    }))
  }

  const availableSrcChannels = allChannels.filter(ch => !cfg.source_channels.some(s => s.id === ch.id))

  return (
    <div className="standup-compiler">
      <div className="standup-header">
        <h1>Daily Update Compiler</h1>
        <div className="standup-header-actions">
          {updates.length > 0 && (
            <button
              className="sc-btn sc-btn-success"
              onClick={postToSlack}
              disabled={posting || !cfg.dest_channel_id}
            >
              <Send size={15} />
              {posting ? 'Posting…' : `Post to #${cfg.dest_channel_name || 'channel'}`}
            </button>
          )}
        </div>
      </div>

      {/* Config Panel */}
      <div className="standup-config-panel">
        <div
          className={`standup-config-toggle ${configOpen ? 'open' : ''}`}
          onClick={() => setConfigOpen(o => !o)}
        >
          <span>Configuration</span>
          <ChevronDown size={16} />
        </div>
        {configOpen && (
          <div className="standup-config-body">
            {/* Source channels */}
            <div className="standup-field">
              <label>Source Channels (read updates from)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                {cfg.source_channels.map(ch => (
                  <div key={ch.id} className="standup-channel-chip">
                    <Hash size={11} />
                    {ch.name || ch.id}
                    <button onClick={() => removeSourceChannel(ch.id)}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <div className="standup-channel-picker" ref={srcRef}>
                  <button
                    className="standup-channel-picker-trigger"
                    onClick={() => setSrcPickerOpen(o => !o)}
                  >
                    <Plus size={12} />
                    Add channel
                  </button>
                  {srcPickerOpen && (
                    <div className="standup-channel-dropdown">
                      {availableSrcChannels.length === 0 && (
                        <div className="standup-channel-dropdown-item" style={{ opacity: 0.5 }}>
                          No more channels
                        </div>
                      )}
                      {availableSrcChannels.map(ch => (
                        <div
                          key={ch.id}
                          className="standup-channel-dropdown-item"
                          onClick={() => addSourceChannel(ch)}
                        >
                          #{ch.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Destination channel */}
            <div className="standup-field">
              <label>Destination Channel (post compiled update to)</label>
              <div className="standup-dest-row">
                <div className="standup-channel-picker" ref={destRef}>
                  <button
                    className="standup-channel-picker-trigger"
                    onClick={() => setDestPickerOpen(o => !o)}
                  >
                    <Hash size={12} />
                    {cfg.dest_channel_name || cfg.dest_channel_id || 'Select channel'}
                    <ChevronDown size={12} />
                  </button>
                  {destPickerOpen && (
                    <div className="standup-channel-dropdown">
                      {allChannels.map(ch => (
                        <div
                          key={ch.id}
                          className={`standup-channel-dropdown-item ${ch.id === cfg.dest_channel_id ? 'selected' : ''}`}
                          onClick={() => setDestChannel(ch)}
                        >
                          #{ch.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>or</span>
                <input
                  className="standup-manual-input"
                  placeholder="Enter channel ID manually"
                  value={cfg.dest_channel_id}
                  onChange={e => setCfg(c => ({ ...c, dest_channel_id: e.target.value, dest_channel_name: '' }))}
                />
              </div>
            </div>

            {/* Time window */}
            <div className="standup-field">
              <label>Time Window (24h, when developers post updates)</label>
              <div className="standup-time-row">
                <input
                  type="time"
                  className="standup-time-input"
                  value={cfg.time_window_start}
                  onChange={e => setCfg(c => ({ ...c, time_window_start: e.target.value }))}
                />
                <span>to</span>
                <input
                  type="time"
                  className="standup-time-input"
                  value={cfg.time_window_end}
                  onChange={e => setCfg(c => ({ ...c, time_window_end: e.target.value }))}
                />
              </div>
            </div>

            <div className="standup-config-actions">
              <button className="sc-btn sc-btn-primary" onClick={saveConfig} disabled={saving}>
                {saving ? 'Saving…' : saveMsg || 'Save Configuration'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Compile bar */}
      <div className="standup-compile-bar">
        <input
          type="date"
          className="standup-date-input"
          value={compileDate}
          onChange={e => setCompileDate(e.target.value)}
        />
        <button className="sc-btn sc-btn-primary" onClick={compile} disabled={compiling}>
          <RefreshCw size={15} className={compiling ? 'sc-spin-icon' : ''} />
          {compiling ? 'Compiling…' : 'Compile Today\'s Updates'}
        </button>
        {postMsg && (
          <span className="standup-status">{postMsg}</span>
        )}
      </div>

      {compileError && (
        <div className="standup-error">{compileError}</div>
      )}

      {/* Preview */}
      {compiling && (
        <div className="standup-loading">
          <div className="sc-spinner" />
          Fetching updates from {cfg.source_channels.length} channel{cfg.source_channels.length !== 1 ? 's' : ''} and running AI…
        </div>
      )}

      {!compiling && updates.length > 0 && (
        <div className="standup-preview">
          <div className="standup-preview-header">
            <h2>Preview — {updates.length} developer{updates.length !== 1 ? 's' : ''}</h2>
          </div>
          {updates.map((person, pi) => (
            <PersonCard
              key={person.slack_user_id || pi}
              person={person}
              personIdx={pi}
              onUpdateItem={updateItem}
            />
          ))}
        </div>
      )}

      {!compiling && updates.length === 0 && !compileError && (
        <div className="standup-empty">
          Configure the channels above and click "Compile Today's Updates" to get started.
        </div>
      )}
    </div>
  )
}

// ── PersonCard ────────────────────────────────────────────────────────────────

interface PersonCardProps {
  person: PersonUpdate
  personIdx: number
  onUpdateItem: (pi: number, si: number, ii: number, val: string) => void
}

function PersonCard({ person, personIdx, onUpdateItem }: PersonCardProps) {
  return (
    <div className={`standup-person-card ${person.is_owner ? 'is-owner' : ''}`}>
      <div className="standup-person-name">
        <span className={`standup-name-tag ${person.is_owner ? 'owner' : 'dev'}`}>
          {person.display_name}
        </span>
        {person.is_owner && (
          <span className="standup-daytrack-badge">from DayTrack</span>
        )}
      </div>

      {person.sections.length === 0 ? (
        <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.3)' }}>No update parsed</div>
      ) : (
        <div className="standup-sections">
          {person.sections.map((sec, si) => (
            sec.items.length > 0 && (
              <div key={si} className="standup-section">
                <div className="standup-section-label">{sec.label}</div>
                <div className="standup-items">
                  {sec.items.map((item, ii) => (
                    <div key={ii} className="standup-item">
                      <span className="standup-item-bullet">•</span>
                      <textarea
                        className="standup-item-text"
                        value={item}
                        rows={1}
                        onChange={e => onUpdateItem(personIdx, si, ii, e.target.value)}
                        onInput={e => {
                          const el = e.currentTarget
                          el.style.height = 'auto'
                          el.style.height = el.scrollHeight + 'px'
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  )
}
