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
      const response = await api.pmAssistantQuery(text) as any
      const data = response.data || response
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: data.response || 'No response received.',
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

  const renderMarkdown = (text: string) => {
    // Simple markdown rendering: bold, tables, bullet points, code
    let html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^### (.*$)/gm, '<h4>$1</h4>')
      .replace(/^## (.*$)/gm, '<h3>$1</h3>')
      .replace(/^# (.*$)/gm, '<h2>$1</h2>')
      .replace(/^- (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>')

    // Simple table rendering
    if (html.includes('|')) {
      const lines = text.split('\n')
      let inTable = false
      let tableHtml = ''
      let result = ''

      for (const line of lines) {
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
          if (line.includes('---')) continue // separator row
          if (!inTable) {
            inTable = true
            tableHtml = '<table class="pm-report-table"><thead><tr>'
            const cells = line.split('|').filter(c => c.trim())
            for (const cell of cells) {
              tableHtml += `<th>${cell.trim()}</th>`
            }
            tableHtml += '</tr></thead><tbody>'
          } else {
            tableHtml += '<tr>'
            const cells = line.split('|').filter(c => c.trim())
            for (const cell of cells) {
              tableHtml += `<td>${cell.trim()}</td>`
            }
            tableHtml += '</tr>'
          }
        } else {
          if (inTable) {
            tableHtml += '</tbody></table>'
            result += tableHtml
            inTable = false
            tableHtml = ''
          }
          result += line + '\n'
        }
      }
      if (inTable) {
        tableHtml += '</tbody></table>'
        result += tableHtml
      }

      html = result
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/^- (.*$)/gm, '<li>$1</li>')
        .replace(/\n\n/g, '<br/><br/>')
        .replace(/\n/g, '<br/>')
    }

    return html
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
              onChange={e => setInput(e.target.value)}
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
