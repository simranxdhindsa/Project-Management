import React, { useState, useEffect, useRef } from 'react'
import type { LoadedDeploymentTicket } from './DeploymentProjectBrowser'

export interface TicketLine {
  url: string
  title: string | null
  manualDesc: string | null
  gid?: string
}

interface Props {
  onFetch: (lines: TicketLine[]) => void
  isLoading: boolean
  preloadTickets: LoadedDeploymentTicket[]
}

type PreloadEntry = { url: string; gid: string }

// Split on first --> occurrence
function splitArrow(text: string): { base: string; manualDesc: string | null } {
  const idx = text.indexOf('-->')
  if (idx !== -1) {
    const base = text.slice(0, idx).trim()
    const desc = text.slice(idx + 3).trim()
    return { base, manualDesc: desc || null }
  }
  return { base: text.trim(), manualDesc: null }
}

// Parse Slack rich-paste HTML — extract Asana links with optional --> manual desc
function parseSlackHtml(html: string, preloadMap: Map<string, PreloadEntry>): TicketLine[] {
  const lines: TicketLine[] = []
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  doc.querySelectorAll('a[href]').forEach(el => {
    const a = el as HTMLAnchorElement
    if (!a.href.startsWith('https://app.asana.com/')) return
    const linkText = a.textContent?.trim() || ''
    const { base: title, manualDesc } = splitArrow(linkText)
    const entry = preloadMap.get(title)
    lines.push({ url: a.href, title: title || null, manualDesc, gid: entry?.gid })
  })
  return lines
}

// Parse plain-text area: each non-empty line is a title (from preload) or URL
function parsePlainLines(text: string, preloadMap: Map<string, PreloadEntry>): TicketLine[] {
  const result: TicketLine[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const { base, manualDesc } = splitArrow(line)
    if (base.startsWith('https://app.asana.com/')) {
      result.push({ url: base, title: null, manualDesc })
    } else {
      // Treat as ticket title — look up URL + GID from preload map
      const entry = preloadMap.get(base)
      if (entry) {
        result.push({ url: entry.url, title: base, manualDesc, gid: entry.gid })
      }
      // Unknown title with no preload mapping — skip silently
    }
  }
  return result
}

export default function DeploymentTicketInput({ onFetch, isLoading, preloadTickets }: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preloadMap = useRef<Map<string, PreloadEntry>>(new Map())

  useEffect(() => {
    preloadMap.current = new Map(
      preloadTickets.map(t => [t.title, { url: t.url, gid: t.gid }])
    )
    if (preloadTickets.length > 0) {
      // Show ticket titles in textarea (not URLs)
      setText(preloadTickets.map(t => t.title).join('\n'))
    }
  }, [preloadTickets])

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html')
    if (html && html.includes('app.asana.com')) {
      e.preventDefault()
      const lines = parseSlackHtml(html, preloadMap.current)
      if (lines.length > 0) {
        onFetch(lines)
        return
      }
    }
  }

  const handleFetch = () => {
    const lines = parsePlainLines(text, preloadMap.current)
    if (lines.length === 0) return
    onFetch(lines)
  }

  return (
    <div className="dr-ticket-input">
      <label className="dr-bot-config-label">Or paste Asana URLs / ticket titles</label>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        One ticket per line. Loaded tickets show as titles. Paste Slack links or plain Asana URLs.
        Add <code style={{ color: 'var(--color-accent)' }}>--&gt; your fix text</code> after any ticket to skip AI and use your text directly as the fix statement.
      </p>
      <textarea
        ref={textareaRef}
        className="dr-textarea"
        rows={6}
        value={text}
        onChange={e => setText(e.target.value)}
        onPaste={handlePaste}
        placeholder={`P1 FE UI: Button is broken\nhttps://app.asana.com/0/0/123456789\nP2 MC: Mic stays active --> The mic is now properly deactivated after use`}
        disabled={isLoading}
      />
      <button
        className="btn-primary btn-sm"
        style={{ marginTop: '0.5rem' }}
        onClick={handleFetch}
        disabled={isLoading || !text.trim()}
      >
        Fetch Tickets
      </button>
    </div>
  )
}
