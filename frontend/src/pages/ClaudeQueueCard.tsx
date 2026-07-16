import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, ChevronDown, Copy, Check, RefreshCw, Trash2,
  Clock, Send, Pencil, X, AlertCircle, Zap,
  CheckCircle2, CircleDashed, Settings,
} from 'lucide-react'
import api from '../services/api'
import type { PendingSlackMessage } from '../services/api'
import { usePersistedState, PERSIST } from '../hooks/usePersistedState'
import { TimePicker } from '../components/TimePicker'
import { ConfirmModal } from '../components/ConfirmModal'
import '../styles/pages/claude-queue.css'

const MCP_BASE_URL = (() => {
  const apiUrl = import.meta.env.VITE_API_URL
  if (apiUrl) {
    const path = apiUrl.replace(/\/api$/, '/api/mcp')
    // VITE_API_URL may be a relative path (e.g. "/api") in production builds
    return path.startsWith('/') ? `${window.location.origin}${path}` : path
  }
  return `${window.location.origin}/api/mcp`
})()

// ── Compact connection status + manage panel ──────────────────────────────────

type TokenMeta = { exists: boolean; created_at?: string; last_used_at?: string; default_send_time?: string }

function ConnectionBar({ onDefaultTime }: { onDefaultTime: (t: string) => void }) {
  const [meta, setMeta] = useState<TokenMeta | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [plainToken, setPlainToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showRevoke, setShowRevoke] = useState(false)

  const load = useCallback(async () => {
    const r = await api.getMcpToken()
    const raw = r as any
    const m = raw?.exists !== undefined ? raw : raw?.data
    if (m) {
      setMeta(m)
      // Seed the default send time from what the backend has stored
      if (m.default_send_time) onDefaultTime(m.default_send_time)
    }
  }, [onDefaultTime])

  useEffect(() => { load() }, [load])

  const connectorUrl = plainToken ? `${MCP_BASE_URL}?token=${plainToken}` : ''
  const isConnected = meta?.exists === true

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const r = await api.generateMcpToken()
      const raw = r as any
      const token = raw?.token ?? raw?.data?.token
      if (token) {
        setPlainToken(token)
        setMeta({ exists: true, created_at: new Date().toISOString() })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async () => {
    await api.revokeMcpToken()
    setMeta({ exists: false })
    setPlainToken(null)
    setPanelOpen(false)
    setShowRevoke(false)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(connectorUrl)
    setCopied(true)
    // Copied → auto-close: URL is now in clipboard, nothing left to show
    setTimeout(() => {
      setCopied(false)
      setPlainToken(null)
      setPanelOpen(false)
    }, 1400)
  }

  const lastUsedLabel = meta?.last_used_at
    ? `last used ${new Date(meta.last_used_at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })}`
    : null

  return (
    <div className="cq-conn">
      {/* One-liner status — always compact */}
      <div className="cq-conn-row">
        {isConnected
          ? <CheckCircle2 size={12} className="cq-conn-icon cq-conn-icon--ok" />
          : <CircleDashed size={12} className="cq-conn-icon" />
        }
        <span className="cq-conn-label">
          {isConnected ? 'Connected' : 'Not connected'}
          {lastUsedLabel && <span className="cq-conn-sub"> · {lastUsedLabel}</span>}
        </span>
        <button className="cq-conn-action" onClick={() => setPanelOpen(o => !o)}>
          {isConnected ? <><Settings size={11} />Manage</> : 'Set up'}
        </button>
      </div>

      {/* Expandable panel — only when user asks */}
      <AnimatePresence initial={false}>
        {panelOpen && (
          <motion.div
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="cq-panel">
              {/* URL reveal — only shown immediately after generate/regenerate */}
              <AnimatePresence>
                {plainToken && (
                  <motion.div
                    key="url"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.14 }}
                    className="cq-url-reveal"
                  >
                    <div className="cq-url-label">
                      <AlertCircle size={11} />
                      Copy now — shown once only
                    </div>
                    <div className="cq-url-row">
                      <code className="cq-url-code">{connectorUrl}</code>
                      <button
                        className={`cq-copy-btn${copied ? ' cq-copy-btn--ok' : ''}`}
                        onClick={handleCopy}
                      >
                        {copied
                          ? <><Check size={11} />Copied!</>
                          : <><Copy size={11} />Copy</>
                        }
                      </button>
                    </div>
                    <div className="cq-url-hint">
                      Claude.ai → Settings → Connectors → Add custom connector
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="cq-panel-actions">
                <button className="cq-panel-btn" onClick={handleGenerate} disabled={loading}>
                  <RefreshCw size={12} className={loading ? 'cq-spin' : ''} />
                  {isConnected ? 'Regenerate token' : 'Generate token'}
                </button>
                {isConnected && (
                  <button
                    className="cq-panel-btn cq-panel-btn--danger"
                    onClick={() => setShowRevoke(true)}
                  >
                    <Trash2 size={12} />Revoke access
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showRevoke && (
        <ConfirmModal
          variant="danger"
          title="Revoke MCP token?"
          detail="Claude will lose access immediately. You'll need to regenerate and update the connector URL."
          confirmLabel="Revoke"
          onConfirm={handleRevoke}
          onCancel={() => setShowRevoke(false)}
        />
      )}
    </div>
  )
}

// ── Individual queued message card ─────────────────────────────────────────────

function QueuedMessageCard({
  msg, defaultTime, onUpdated, onDeleted, onSent,
}: {
  msg: PendingSlackMessage
  defaultTime: string
  onUpdated: (m: PendingSlackMessage) => void
  onDeleted: (id: string) => void
  onSent: (id: string, slackTs: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(msg.message)
  const [editTime, setEditTime] = useState(
    msg.scheduled_at
      ? new Date(msg.scheduled_at).toTimeString().slice(0, 5)
      : defaultTime
  )
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  const scheduledLabel = msg.scheduled_at
    ? new Date(msg.scheduled_at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : 'Manual only'

  const handleSave = async () => {
    setSaving(true)
    try {
      let scheduledAt: string | undefined
      if (editTime) {
        const base = msg.scheduled_at ? new Date(msg.scheduled_at) : new Date()
        const [hh, mm] = editTime.split(':').map(Number)
        base.setHours(hh, mm, 0, 0)
        scheduledAt = base.toISOString()
      }
      const r = await api.updateQueuedMessage(msg.id, editText, scheduledAt)
      const raw = r as any
      const updated = raw?.id ? raw : raw?.data
      if (updated) { onUpdated(updated as PendingSlackMessage); setEditing(false) }
    } finally {
      setSaving(false)
    }
  }

  const handleSendNow = async () => {
    setSending(true)
    try {
      const r = await api.sendQueuedMessageNow(msg.id)
      const raw = r as any
      const ts = raw?.slack_ts ?? raw?.data?.slack_ts ?? ''
      onSent(msg.id, ts)
    } finally {
      setSending(false)
    }
  }

  const isPending = msg.status === 'pending'
  const isSent = msg.status === 'sent'
  const isFailed = msg.status === 'failed'

  return (
    <div className={`cq-msg-card cq-msg-card--${msg.status}`}>
      <div className="cq-msg-meta">
        <span className="cq-msg-channel">{msg.channel_label || msg.channel_id}</span>
        <span className="cq-msg-time"><Clock size={10} />{scheduledLabel}</span>
        <span className={`cq-msg-badge cq-msg-badge--${msg.status}`}>
          {isSent
            ? <><CheckCircle2 size={10} />Sent</>
            : isFailed
            ? <><AlertCircle size={10} />Failed</>
            : <><Zap size={10} />Pending</>
          }
        </span>
      </div>

      {editing ? (
        <div className="cq-msg-edit">
          <textarea
            className="cq-msg-edit-input"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            rows={4}
            autoFocus
          />
          <div className="cq-msg-edit-footer">
            <div className="cq-msg-edit-time">
              <span className="cq-label">Send at</span>
              <TimePicker value={editTime} onChange={setEditTime} />
            </div>
            <div className="cq-msg-edit-actions">
              <button className="cq-btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button className="cq-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="cq-msg-text">{msg.message}</p>
          {isFailed && msg.error_message && (
            <div className="cq-msg-error"><AlertCircle size={11} />{msg.error_message}</div>
          )}
          {isPending && (
            <div className="cq-msg-actions">
              <button
                className="cq-msg-icon-btn"
                title="Edit"
                onClick={() => { setEditing(true); setEditText(msg.message) }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="cq-msg-icon-btn cq-msg-icon-btn--danger"
                title="Remove"
                onClick={() => { api.deleteQueuedMessage(msg.id); onDeleted(msg.id) }}
              >
                <X size={12} />
              </button>
              <button className="cq-btn-send" onClick={handleSendNow} disabled={sending}>
                <Send size={11} />{sending ? 'Sending…' : 'Send now'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main exported card ─────────────────────────────────────────────────────────

export function ClaudeQueueCard() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<PendingSlackMessage[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [defaultTime, setDefaultTime] = usePersistedState<string>(
    PERSIST.QUEUE_DEFAULT_TIME, '10:00'
  )

  const loadMessages = useCallback(async () => {
    setLoadingMsgs(true)
    try {
      const r = await api.listQueuedMessages()
      const list = Array.isArray(r) ? r : Array.isArray((r as any)?.data) ? (r as any).data : []
      setMessages(list as PendingSlackMessage[])
    } finally {
      setLoadingMsgs(false)
    }
  }, [])

  useEffect(() => {
    loadMessages()
    const id = setInterval(loadMessages, 15_000)
    return () => clearInterval(id)
  }, [loadMessages])

  const pendingMsgs = messages.filter(m => m.status === 'pending')
  const recentMsgs = messages.filter(m => m.status !== 'pending').slice(0, 5)
  const pendingCount = pendingMsgs.length

  return (
    <div className="cq-card">
      <button className={`cq-header${open ? ' cq-header--open' : ''}`} onClick={() => setOpen(o => !o)}>
        <div className="cq-header-left">
          <div className="cq-header-icon"><Bot size={14} /></div>
          <span className="cq-header-title">Claude Queue</span>
          {pendingCount > 0 && <span className="cq-header-badge">{pendingCount}</span>}
        </div>
        <ChevronDown size={14} className={`cq-caret${open ? ' cq-caret--open' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {/* Connection — compact one-liner; seeds defaultTime from backend */}
            <ConnectionBar onDefaultTime={setDefaultTime} />

            {/* Default time — one compact row; saves to backend on change */}
            <div className="cq-time-row">
              <span className="cq-label">Default send time</span>
              <TimePicker
                value={defaultTime}
                onChange={t => { setDefaultTime(t); api.updateMcpSettings(t) }}
              />
            </div>

            {/* Queue */}
            <div className="cq-queue">
              <div className="cq-queue-hd">
                <span className="cq-queue-title">
                  Queued
                  {pendingCount > 0 && <span className="cq-count-pill">{pendingCount}</span>}
                </span>
                <button
                  className="cq-refresh-btn"
                  onClick={loadMessages}
                  disabled={loadingMsgs}
                  title="Refresh"
                >
                  <RefreshCw size={12} className={loadingMsgs ? 'cq-spin' : ''} />
                </button>
              </div>

              {pendingMsgs.length === 0 ? (
                <div className="cq-empty">
                  <Bot size={18} className="cq-empty-icon" />
                  <span>No pending messages</span>
                </div>
              ) : (
                <div className="cq-msg-list">
                  {pendingMsgs.map(m => (
                    <QueuedMessageCard
                      key={m.id} msg={m} defaultTime={defaultTime}
                      onUpdated={u => setMessages(ms => ms.map(x => x.id === u.id ? u : x))}
                      onDeleted={id => setMessages(ms => ms.filter(x => x.id !== id))}
                      onSent={(id, ts) => setMessages(ms => ms.map(x =>
                        x.id === id ? { ...x, status: 'sent' as const, slack_ts: ts } : x
                      ))}
                    />
                  ))}
                </div>
              )}

              {recentMsgs.length > 0 && (
                <details className="cq-recent">
                  <summary className="cq-recent-toggle">Recent ({recentMsgs.length})</summary>
                  <div className="cq-msg-list cq-msg-list--recent">
                    {recentMsgs.map(m => (
                      <QueuedMessageCard
                        key={m.id} msg={m} defaultTime={defaultTime}
                        onUpdated={u => setMessages(ms => ms.map(x => x.id === u.id ? u : x))}
                        onDeleted={id => setMessages(ms => ms.filter(x => x.id !== id))}
                        onSent={(id, ts) => setMessages(ms => ms.map(x =>
                          x.id === id ? { ...x, status: 'sent' as const, slack_ts: ts } : x
                        ))}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
