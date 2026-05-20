import { useState, useEffect, useRef } from 'react'
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

interface SlackChannel { id: string; name: string }

export function StandupCompilerPage() {
  const today = new Date().toISOString().slice(0, 10)

  // Config
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

  // Slack channels list
  const [allChannels, setAllChannels] = useState<SlackChannel[]>([])
  const [srcPickerOpen, setSrcPickerOpen] = useState(false)
  const [destPickerOpen, setDestPickerOpen] = useState(false)
  const srcRef = useRef<HTMLDivElement>(null)
  const destRef = useRef<HTMLDivElement>(null)

  // Manual add for source channels
  const [manualSrcId, setManualSrcId] = useState('')
  const [manualSrcName, setManualSrcName] = useState('')

  // Compile
  const [compileDate, setCompileDate] = useState(today)
  const [compiling, setCompiling] = useState(false)
  const [compileError, setCompileError] = useState('')
  const [updates, setUpdates] = useState<PersonUpdate[]>([])

  // Post
  const [posting, setPosting] = useState(false)
  const [postMsg, setPostMsg] = useState('')

  useEffect(() => {
    standupApi.getConfig().then(r => { if (r.success) setCfg(r.config) }).catch(() => {})
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
    function onDown(e: MouseEvent) {
      if (srcRef.current && !srcRef.current.contains(e.target as Node)) setSrcPickerOpen(false)
      if (destRef.current && !destRef.current.contains(e.target as Node)) setDestPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function addSourceChannel(ch: SlackChannel) {
    if (!ch.id || cfg.source_channels.some(s => s.id === ch.id)) return
    setCfg(c => ({ ...c, source_channels: [...c.source_channels, { id: ch.id, name: ch.name }] }))
    setSrcPickerOpen(false)
  }

  function addManualSourceChannel() {
    const id = manualSrcId.trim()
    if (!id || cfg.source_channels.some(s => s.id === id)) return
    setCfg(c => ({ ...c, source_channels: [...c.source_channels, { id, name: manualSrcName.trim() || id }] }))
    setManualSrcId('')
    setManualSrcName('')
  }

  function removeSourceChannel(id: string) {
    setCfg(c => ({ ...c, source_channels: c.source_channels.filter(s => s.id !== id) }))
  }

  function setDestChannel(ch: SlackChannel) {
    setCfg(c => ({ ...c, dest_channel_id: ch.id, dest_channel_name: ch.name }))
    setDestPickerOpen(false)
  }

  async function saveConfig() {
    setSaving(true); setSaveMsg('')
    try {
      await standupApi.saveConfig(cfg)
      setSaveMsg('Saved ✓')
      setTimeout(() => setSaveMsg(''), 2500)
      setConfigOpen(false)
    } catch { setSaveMsg('Save failed') }
    finally { setSaving(false) }
  }

  async function compile() {
    setCompiling(true); setCompileError(''); setUpdates([]); setPostMsg('')
    try {
      const res = await standupApi.compile(compileDate !== today ? compileDate : undefined)
      if (res.success) setUpdates(res.updates)
    } catch (e: unknown) {
      setCompileError(e instanceof Error ? e.message : 'Compile failed')
    } finally { setCompiling(false) }
  }

  async function postToSlack() {
    if (!cfg.dest_channel_id) { setPostMsg('Select a destination channel first'); return }
    setPosting(true); setPostMsg('')
    try {
      await standupApi.post(updates, cfg.dest_channel_id)
      setPostMsg(`Posted to #${cfg.dest_channel_name || cfg.dest_channel_id}`)
    } catch (e: unknown) {
      setPostMsg(e instanceof Error ? e.message : 'Post failed')
    } finally { setPosting(false) }
  }

  function updateItem(pi: number, si: number, ii: number, val: string) {
    setUpdates(prev => prev.map((p, _pi) => {
      if (_pi !== pi) return p
      const sections: UpdateSection[] = p.sections.map((sec, _si) => {
        if (_si !== si) return sec
        const items = [...sec.items]; items[ii] = val
        return { ...sec, items }
      })
      return { ...p, sections }
    }))
  }

  const availableSrc = allChannels.filter(ch => !cfg.source_channels.some(s => s.id === ch.id))

  return (
    <div className="sc-page">
      {/* Header */}
      <div className="sc-header">
        <h2 className="sc-title"><Send size={16} /> Daily Update Compiler</h2>
        {updates.length > 0 && (
          <button
            className="btn btn-primary btn-sm"
            onClick={postToSlack}
            disabled={posting || !cfg.dest_channel_id}
          >
            <Send size={13} />
            {posting ? 'Posting…' : `Post to #${cfg.dest_channel_name || 'channel'}`}
          </button>
        )}
      </div>

      {/* Config panel */}
      <div className="sc-config-panel">
        <div
          className={`sc-config-toggle ${configOpen ? 'open' : ''}`}
          onClick={() => setConfigOpen(o => !o)}
        >
          <span className="sc-config-toggle-label">Configuration</span>
          <ChevronDown size={14} />
        </div>

        {configOpen && (
          <div className="sc-config-body">

            {/* Source channels */}
            <div className="sc-field">
              <label className="sc-label">Source Channels — pick from Slack</label>
              <div className="sc-chips-row">
                {cfg.source_channels.map(ch => (
                  <div key={ch.id} className="sc-chip">
                    <Hash size={10} />
                    {ch.name || ch.id}
                    <button className="sc-chip-remove" onClick={() => removeSourceChannel(ch.id)}>
                      <X size={10} />
                    </button>
                  </div>
                ))}

                {/* Dropdown picker */}
                <div className="sc-channel-picker" ref={srcRef}>
                  <button className="sc-picker-trigger" onClick={() => setSrcPickerOpen(o => !o)}>
                    <Plus size={11} /> Add from list
                  </button>
                  {srcPickerOpen && (
                    <div className="sc-picker-menu">
                      {availableSrc.length === 0
                        ? <div className="sc-picker-item" style={{ opacity: 0.5, cursor: 'default' }}>No more channels</div>
                        : availableSrc.map(ch => (
                          <button key={ch.id} className="sc-picker-item" onClick={() => addSourceChannel(ch)}>
                            <Hash size={11} />{ch.name}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Manual source channel add */}
            <div className="sc-field">
              <label className="sc-label">Or add source channel by ID</label>
              <div className="sc-manual-add-row">
                <input
                  className="sc-input"
                  placeholder="Channel ID (e.g. C08ABC123)"
                  value={manualSrcId}
                  onChange={e => setManualSrcId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addManualSourceChannel()}
                  style={{ width: 190 }}
                />
                <input
                  className="sc-input"
                  placeholder="Label (optional)"
                  value={manualSrcName}
                  onChange={e => setManualSrcName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addManualSourceChannel()}
                  style={{ width: 140 }}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={addManualSourceChannel}
                  disabled={!manualSrcId.trim()}
                >
                  <Plus size={13} /> Add
                </button>
              </div>
            </div>

            {/* Destination channel */}
            <div className="sc-field">
              <label className="sc-label">Destination Channel — post compiled update to</label>
              <div className="sc-dest-row">
                <div className="sc-channel-picker" ref={destRef}>
                  <button className="sc-picker-trigger" onClick={() => setDestPickerOpen(o => !o)}>
                    <Hash size={11} />
                    {cfg.dest_channel_name || cfg.dest_channel_id || 'Select channel'}
                    <ChevronDown size={11} />
                  </button>
                  {destPickerOpen && (
                    <div className="sc-picker-menu">
                      {allChannels.map(ch => (
                        <button
                          key={ch.id}
                          className={`sc-picker-item ${ch.id === cfg.dest_channel_id ? 'selected' : ''}`}
                          onClick={() => setDestChannel(ch)}
                        >
                          <Hash size={11} />{ch.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="sc-dest-sep">or</span>
                <input
                  className="sc-input"
                  placeholder="Enter channel ID manually"
                  value={cfg.dest_channel_id}
                  onChange={e => setCfg(c => ({ ...c, dest_channel_id: e.target.value, dest_channel_name: '' }))}
                  style={{ width: 200 }}
                />
              </div>
            </div>

            {/* Time window */}
            <div className="sc-field">
              <label className="sc-label">Time Window (24 h) — when developers post updates</label>
              <div className="sc-time-row">
                <input
                  type="time"
                  className="sc-input sc-time-input"
                  value={cfg.time_window_start}
                  onChange={e => setCfg(c => ({ ...c, time_window_start: e.target.value }))}
                />
                <span className="sc-time-sep">to</span>
                <input
                  type="time"
                  className="sc-input sc-time-input"
                  value={cfg.time_window_end}
                  onChange={e => setCfg(c => ({ ...c, time_window_end: e.target.value }))}
                />
              </div>
            </div>

            <div className="sc-config-actions">
              <button className="btn btn-primary btn-sm" onClick={saveConfig} disabled={saving}>
                {saving ? 'Saving…' : saveMsg || 'Save Configuration'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Compile bar */}
      <div className="sc-compile-bar">
        <input
          type="date"
          className="sc-input"
          value={compileDate}
          onChange={e => setCompileDate(e.target.value)}
        />
        <button className="btn btn-secondary btn-sm" onClick={compile} disabled={compiling}>
          <RefreshCw size={13} />
          {compiling ? 'Compiling…' : 'Compile Updates'}
        </button>
        {postMsg && <span className="sc-status-msg">{postMsg}</span>}
      </div>

      {compileError && <div className="sc-error">{compileError}</div>}

      {/* Loading */}
      {compiling && (
        <div className="sc-loading">
          <div className="sc-spinner" />
          Fetching from {cfg.source_channels.length} channel{cfg.source_channels.length !== 1 ? 's' : ''} and running AI…
        </div>
      )}

      {/* Preview */}
      {!compiling && updates.length > 0 && (
        <div className="sc-preview">
          <div className="sc-preview-header">
            <h3 className="sc-preview-title">Preview — {updates.length} developer{updates.length !== 1 ? 's' : ''}</h3>
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
        <div className="sc-empty">
          Configure channels above and click "Compile Updates" to get started.
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
    <div className={`sc-person-card ${person.is_owner ? 'is-owner' : ''}`}>
      <div className="sc-person-name-row">
        <span className={`sc-name-tag ${person.is_owner ? 'owner' : 'dev'}`}>
          {person.display_name}
        </span>
        {person.is_owner && <span className="sc-daytrack-badge">DayTrack</span>}
      </div>

      {person.sections.length === 0
        ? <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No update parsed</span>
        : (
          <div className="sc-sections">
            {person.sections.map((sec, si) =>
              sec.items.length > 0 && (
                <div key={si}>
                  <div className="sc-section-label">{sec.label}</div>
                  <div className="sc-items">
                    {sec.items.map((item, ii) => (
                      <div key={ii} className="sc-item">
                        <span className="sc-item-bullet">•</span>
                        <textarea
                          className="sc-item-text"
                          value={item}
                          rows={1}
                          onChange={e => {
                            onUpdateItem(personIdx, si, ii, e.target.value)
                            e.currentTarget.style.height = 'auto'
                            e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )
      }
    </div>
  )
}
