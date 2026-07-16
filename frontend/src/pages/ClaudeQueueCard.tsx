import React, { useState, useEffect, useCallback } from 'react'
import {
  Bot, ChevronDown, Copy, Check, RefreshCw, Trash2,
  Clock, Send, Pencil, X, AlertCircle,
} from 'lucide-react'
import api from '../services/api'
import type { PendingSlackMessage } from '../services/api'
import { usePersistedState, PERSIST } from '../hooks/usePersistedState'
import { TimePicker } from '../components/TimePicker'
import '../styles/pages/claude-queue.css'

const MCP_BASE_URL = (() => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/api$/, '/api/mcp')
  }
  return `${window.location.origin}/api/mcp`
})()

// ── MCP connector setup section ────────────────────────────────────────────────

function McpSetup() {
  const [tokenMeta, setTokenMeta] = useState<{ exists: boolean; created_at?: string; last_used_at?: string } | null>(null)
  const [plainToken, setPlainToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const r = await api.getMcpToken()
    if (r?.data) setTokenMeta(r.data)
  }, [])

  useEffect(() => { load() }, [load])

  const connectorUrl = plainToken ? `${MCP_BASE_URL}?token=${plainToken}` : ''

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const r = await api.generateMcpToken()
      if (r?.data?.token) {
        setPlainToken(r.data.token)
        setTokenMeta({ exists: true, created_at: new Date().toISOString() })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async () => {
    if (!confirm('Revoke your MCP token? Any Claude connector using it will stop working.')) return
    await api.revokeMcpToken()
    setTokenMeta({ exists: false })
    setPlainToken(null)
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="cq-setup">
      <div className="cq-setup-label">Claude Connector URL</div>
      <div className="cq-setup-desc">
        Paste this URL in Claude's Settings → Connectors → Add custom connector.
        Claude will be able to queue Slack messages directly into this tab.
      </div>

      {plainToken ? (
        <div className="cq-token-url">
          <code className="cq-token-code">{connectorUrl}</code>
          <button className="cq-icon-btn" title="Copy URL" onClick={() => copy(connectorUrl)}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      ) : (
        <div className="cq-token-placeholder">
          {tokenMeta?.exists
            ? 'Token exists — regenerate to reveal the URL (previous token will be invalidated)'
            : 'No token yet — generate one to get your connector URL'
          }
        </div>
      )}

      <div className="cq-token-actions">
        <button className="ur-btn-primary ur-btn-xs" onClick={handleGenerate} disabled={loading}>
          <RefreshCw size={11} /> {tokenMeta?.exists ? 'Regenerate' : 'Generate token'}
        </button>
        {tokenMeta?.exists && (
          <button className="ur-btn-danger ur-btn-xs" onClick={handleRevoke}>
            <Trash2 size={11} /> Revoke
          </button>
        )}
        {tokenMeta?.last_used_at && (
          <span className="cq-last-used">
            Last used: {new Date(tokenMeta.last_used_at).toLocaleString()}
          </span>
        )}
      </div>

      {plainToken && (
        <div className="cq-token-warning">
          Copy this URL now — the token will not be shown again after you close this card.
        </div>
      )}
    </div>
  )
}

// ── Pending messages queue ─────────────────────────────────────────────────────

function QueuedMessageCard({
  msg,
  defaultTime,
  onUpdated,
  onDeleted,
  onSent,
}: {
  msg: PendingSlackMessage
  defaultTime: string
  onUpdated: (m: PendingSlackMessage) => void
  onDeleted: (id: string) => void
  onSent: (id: string, slackTs: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(msg.message)
  const [editTime, setEditTime] = useState<string>(
    msg.scheduled_at ? new Date(msg.scheduled_at).toTimeString().slice(0, 5) : defaultTime
  )
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  const scheduledLabel = msg.scheduled_at
    ? new Date(msg.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Manual only'

  const handleSave = async () => {
    setSaving(true)
    try {
      // Build scheduled_at from the chosen time today (or keep existing date)
      let scheduledAt: string | undefined
      if (editTime) {
        const base = msg.scheduled_at ? new Date(msg.scheduled_at) : new Date()
        const [hh, mm] = editTime.split(':').map(Number)
        base.setHours(hh, mm, 0, 0)
        scheduledAt = base.toISOString()
      }
      const r = await api.updateQueuedMessage(msg.id, editText, scheduledAt)
      if (r?.data) { onUpdated(r.data); setEditing(false) }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    await api.deleteQueuedMessage(msg.id)
    onDeleted(msg.id)
  }

  const handleSendNow = async () => {
    setSending(true)
    try {
      const r = await api.sendQueuedMessageNow(msg.id)
      onSent(msg.id, r?.data?.slack_ts || '')
    } finally {
      setSending(false)
    }
  }

  const isPending = msg.status === 'pending'
  const isFailed = msg.status === 'failed'

  return (
    <div className={`cq-msg-card cq-msg-card--${msg.status}`}>
      <div className="cq-msg-meta">
        <span className="cq-msg-channel">{msg.channel_label || msg.channel_id}</span>
        <span className="cq-msg-time">
          <Clock size={11} /> {scheduledLabel}
        </span>
        <span className={`cq-msg-status cq-msg-status--${msg.status}`}>{msg.status}</span>
      </div>

      {editing ? (
        <div className="cq-msg-edit">
          <textarea
            className="cq-msg-edit-input"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            rows={4}
          />
          <div className="cq-msg-edit-time">
            <span className="cq-label">Send at</span>
            <TimePicker value={editTime} onChange={setEditTime} />
          </div>
          <div className="cq-msg-edit-actions">
            <button className="ur-btn-secondary ur-btn-xs" onClick={() => setEditing(false)}>Cancel</button>
            <button className="ur-btn-primary ur-btn-xs" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="cq-msg-text">{msg.message}</p>
          {isFailed && msg.error_message && (
            <div className="cq-msg-error"><AlertCircle size={12} /> {msg.error_message}</div>
          )}
          {isPending && (
            <div className="cq-msg-actions">
              <button className="cq-msg-action-btn" title="Edit" onClick={() => { setEditing(true); setEditText(msg.message) }}>
                <Pencil size={12} />
              </button>
              <button className="cq-msg-action-btn cq-msg-action-btn--danger" title="Remove" onClick={handleDelete}>
                <X size={12} />
              </button>
              <button className="ur-btn-primary ur-btn-xs cq-msg-send-btn" onClick={handleSendNow} disabled={sending}>
                <Send size={11} /> {sending ? 'Sending…' : 'Send now'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main card ──────────────────────────────────────────────────────────────────

export function ClaudeQueueCard() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<PendingSlackMessage[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [defaultTime, setDefaultTime] = usePersistedState<string>(PERSIST.QUEUE_DEFAULT_TIME, '10:00')

  const loadMessages = useCallback(async () => {
    setLoadingMsgs(true)
    try {
      const r = await api.listQueuedMessages()
      if (Array.isArray(r?.data)) setMessages(r.data!)
      else if (Array.isArray(r)) setMessages(r as unknown as PendingSlackMessage[])
    } finally {
      setLoadingMsgs(false)
    }
  }, [])

  useEffect(() => {
    loadMessages()
    const id = setInterval(loadMessages, 15_000)
    return () => clearInterval(id)
  }, [loadMessages])

  const pendingCount = messages.filter(m => m.status === 'pending').length

  const handleUpdated = (updated: PendingSlackMessage) =>
    setMessages(ms => ms.map(m => m.id === updated.id ? updated : m))

  const handleDeleted = (id: string) =>
    setMessages(ms => ms.filter(m => m.id !== id))

  const handleSent = (id: string, slackTs: string) =>
    setMessages(ms => ms.map(m => m.id === id ? { ...m, status: 'sent' as const, slack_ts: slackTs } : m))

  return (
    <div className="ur-quick-send cq-card">
      <div className={`ur-qs-header${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)}>
        <Bot size={14} />
        Claude Queue
        {pendingCount > 0 && <span className="cq-badge">{pendingCount}</span>}
        <ChevronDown size={13} className="ur-qs-caret" />
      </div>

      {open && (
        <div className="ur-qs-body cq-body">
          <McpSetup />

          <div className="cq-default-time">
            <span className="cq-label">Default send time</span>
            <TimePicker value={defaultTime} onChange={setDefaultTime} />
            <span className="cq-label-hint">Applied to messages Claude queues without a specific time</span>
          </div>

          <div className="cq-queue-section">
            <div className="cq-queue-header">
              <span>Queued Messages</span>
              <button className="cq-refresh-btn" onClick={loadMessages} disabled={loadingMsgs} title="Refresh">
                <RefreshCw size={12} className={loadingMsgs ? 'cq-spin' : ''} />
              </button>
            </div>

            {messages.length === 0 ? (
              <div className="cq-queue-empty">
                No messages queued yet. Connect Claude and ask it to queue a Slack message.
              </div>
            ) : (
              messages.map(m => (
                <QueuedMessageCard
                  key={m.id}
                  msg={m}
                  defaultTime={defaultTime}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                  onSent={handleSent}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
