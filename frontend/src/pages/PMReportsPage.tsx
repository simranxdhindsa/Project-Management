import { useState, useRef, useEffect } from 'react'
import { MessageSquare, Send, User, Bot, Loader2 } from 'lucide-react'
import api from '../services/api'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const SUGGESTED_QUERIES = [
  'Give me open issues',
  'P1-P3 issues by status',
  'Report by assignees',
  'Blocked tickets',
  'Issues in DEV',
  'Summary of all tickets',
]

export function PMReportsPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async (query?: string) => {
    const text = query || input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const response = await api.pmAssistantQuery(text)
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: response.data?.response || 'No response received.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const escapeHtml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n')
    const htmlParts: string[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      // Code blocks (triple backtick)
      if (line.trim().startsWith('```')) {
        const codeLines: string[] = []
        i++ // skip opening ```
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(escapeHtml(lines[i]))
          i++
        }
        i++ // skip closing ```
        htmlParts.push(`<pre class="pm-code-block"><code>${codeLines.join('\n')}</code></pre>`)
        continue
      }

      // Table detection: line starts and ends with |
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableRows: string[][] = []
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          const row = lines[i].trim()
          // Skip separator rows (|---|---|)
          if (/^\|[\s\-:|]+\|$/.test(row)) {
            i++
            continue
          }
          // Split cells: remove first/last empty from leading/trailing |
          const cells = row.slice(1, -1).split('|').map(c => c.trim())
          tableRows.push(cells)
          i++
        }
        if (tableRows.length > 0) {
          let tableHtml = '<table class="pm-report-table"><thead><tr>'
          for (const cell of tableRows[0]) {
            tableHtml += `<th>${escapeHtml(cell)}</th>`
          }
          tableHtml += '</tr></thead><tbody>'
          for (let r = 1; r < tableRows.length; r++) {
            tableHtml += '<tr>'
            for (const cell of tableRows[r]) {
              tableHtml += `<td>${renderInline(cell)}</td>`
            }
            tableHtml += '</tr>'
          }
          tableHtml += '</tbody></table>'
          htmlParts.push(tableHtml)
        }
        continue
      }

      // Headings
      const headingMatch = line.match(/^(#{1,4})\s+(.*)$/)
      if (headingMatch) {
        const level = headingMatch[1].length + 1 // h2, h3, h4, h5
        htmlParts.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`)
        i++
        continue
      }

      // Bullet list items
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        const listItems: string[] = []
        while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
          listItems.push(`<li>${renderInline(lines[i].trim().slice(2))}</li>`)
          i++
        }
        htmlParts.push(`<ul>${listItems.join('')}</ul>`)
        continue
      }

      // Numbered list items
      if (/^\d+\.\s/.test(line.trim())) {
        const listItems: string[] = []
        while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
          listItems.push(`<li>${renderInline(lines[i].trim().replace(/^\d+\.\s/, ''))}</li>`)
          i++
        }
        htmlParts.push(`<ol>${listItems.join('')}</ol>`)
        continue
      }

      // Empty line = paragraph break
      if (line.trim() === '') {
        htmlParts.push('<br/>')
        i++
        continue
      }

      // Regular paragraph
      htmlParts.push(`<p>${renderInline(line)}</p>`)
      i++
    }

    return htmlParts.join('')
  }

  const renderInline = (text: string) => {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
  }

  return (
    <div className="pm-reports-page">
      <div className="pm-reports-container glass-card">
        {/* Chat Messages */}
        <div className="pm-chat-messages">
          {messages.length === 0 && (
            <div className="pm-chat-empty">
              <MessageSquare size={48} />
              <h3>PM Reports</h3>
              <p>Ask questions about your YouTrack issues using natural language.</p>
              <div className="pm-suggested-queries">
                {SUGGESTED_QUERIES.map(q => (
                  <button
                    key={q}
                    className="pm-suggested-chip"
                    onClick={() => handleSend(q)}
                  >
                    {q}
                  </button>
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
                  <div
                    className="pm-chat-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                ) : (
                  <div className="pm-chat-content">{msg.content}</div>
                )}
                <span className="pm-chat-time">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="pm-chat-message pm-chat-assistant">
              <div className="pm-chat-avatar">
                <Bot size={16} />
              </div>
              <div className="pm-chat-bubble pm-chat-loading">
                <Loader2 size={16} className="animate-spin" />
                <span>Thinking...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="pm-chat-input-bar">
          {messages.length > 0 && (
            <div className="pm-suggested-queries pm-suggested-inline">
              {SUGGESTED_QUERIES.slice(0, 3).map(q => (
                <button
                  key={q}
                  className="pm-suggested-chip pm-suggested-sm"
                  onClick={() => handleSend(q)}
                  disabled={loading}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="pm-chat-input-row">
            <input
              ref={inputRef}
              type="text"
              className="pm-chat-input"
              placeholder="Ask about your issues..."
              value={input}
              onChange={e => setInput(e.target.value.slice(0, 500))}
              maxLength={500}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              disabled={loading}
            />
            <button
              className="pm-chat-send-btn"
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
