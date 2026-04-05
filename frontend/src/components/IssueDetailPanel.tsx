import { useState, useEffect, useRef } from 'react'
import { ExternalLink, X, Send, MessageSquare, Paperclip, Clock, User } from 'lucide-react'
import api from '@/services/api'
import type { YouTrackIssue, YouTrackComment } from '@/services/api'
import { getActiveSource } from '@/services/pmDataService'
import { AttachmentViewer } from '@/components/AttachmentViewer'

interface IssueDetailPanelProps {
  issue: YouTrackIssue
  onClose: () => void
  ytBaseUrl?: string
}

function getInitials(name?: string) {
  if (!name) return '?'
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function fmtDate(ms?: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(ms?: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatCommentTime(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return fmtDate(ms)
}

function priorityBadgeStyle(priority: string): { background: string; color: string } {
  const p = (priority || '').toLowerCase()
  if (p.includes('critical') || p.includes('show-stopper') || p.includes('blocker'))
    return { background: 'rgba(239,68,68,0.18)', color: '#f87171' }
  if (p.includes('major'))
    return { background: 'rgba(245,158,11,0.18)', color: '#fbbf24' }
  if (p.includes('minor') || p.includes('cosmetic'))
    return { background: 'rgba(99,102,241,0.18)', color: '#818cf8' }
  return { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }
}

function isImageAttachment(mimeType: string, url: string) {
  if (mimeType?.startsWith('image/')) return true
  const ext = url?.split('.').pop()?.toLowerCase()
  return ['png','jpg','jpeg','gif','webp','svg'].includes(ext || '')
}

export function IssueDetailPanel({ issue, onClose, ytBaseUrl }: IssueDetailPanelProps) {
  const [comments, setComments] = useState<YouTrackComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isYouTrack = getActiveSource() === 'youtrack'
  const allAttachments = issue.attachments || []

  useEffect(() => {
    if (!isYouTrack) return
    setCommentsLoading(true)
    api.getYouTrackIssueComments(issue.id)
      .then(res => {
        const r = res as { success: boolean; data: YouTrackComment[] }
        if (r.success && r.data) setComments(r.data)
      })
      .catch(() => {})
      .finally(() => setCommentsLoading(false))
  }, [issue.id, isYouTrack])

  const handlePostComment = async () => {
    const text = commentText.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      await api.addYouTrackIssueComment(issue.id, text)
      setCommentText('')
      // Reload comments
      const res = await api.getYouTrackIssueComments(issue.id)
      const r = res as { success: boolean; data: YouTrackComment[] }
      if (r.success && r.data) setComments(r.data)
    } catch { /* ignore */ }
    finally { setPosting(false) }
  }

  const issueUrl = isYouTrack
    ? `${ytBaseUrl || 'https://youtrack.jetbrains.com/issue'}/${issue.id}`
    : (issue.permalink || '#')

  const priStyle = priorityBadgeStyle(issue.priority || '')
  const imageAttachments = (issue.attachments || []).filter(a => isImageAttachment(a.mimeType, a.url))
  const fileAttachments  = (issue.attachments || []).filter(a => !isImageAttachment(a.mimeType, a.url))

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="idp-modal" onClick={e => e.stopPropagation()}>

        {/* ── Top bar: ID + close ── */}
        <div className="idp-topbar">
          <span className="idp-issue-id">{issue.id}</span>
          <div className="idp-topbar-actions">
            <a href={issueUrl} target="_blank" rel="noopener noreferrer" className="idp-ext-link">
              <ExternalLink size={13} />
              View in {isYouTrack ? 'YouTrack' : 'Asana'}
            </a>
            <button className="idp-close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {/* ── Two-column body ── */}
        <div className="idp-body">

          {/* ── Left: main content ── */}
          <div className="idp-main">
            <h2 className="idp-title">{issue.summary}</h2>

            {issue.description && (
              <div className="idp-section">
                <p className="idp-description">{issue.description}</p>
              </div>
            )}

            {/* Attachments */}
            {(issue.attachments?.length ?? 0) > 0 && (
              <div className="idp-section">
                <div className="idp-section-label">
                  <Paperclip size={13} />
                  Attachments · {issue.attachments!.length}
                </div>
                {imageAttachments.length > 0 && (
                  <div className="idp-attachments-grid">
                    {imageAttachments.map((a, i) => (
                      <div
                        key={a.id}
                        className="idp-attachment-thumb"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setViewerIndex(i)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && setViewerIndex(i)}
                        title={a.name}
                      >
                        <img src={api.buildProxyUrl(a.url)} alt={a.name}
                          onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3' }} />
                        <span className="idp-attachment-name">{a.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {fileAttachments.length > 0 && (
                  <div className="idp-file-attachments">
                    {fileAttachments.map((a, fi) => (
                      <button
                        key={a.id}
                        className="idp-file-pill"
                        onClick={() => setViewerIndex(imageAttachments.length + fi)}
                        title={a.name}
                      >
                        <Paperclip size={11} />
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Comments — only for YouTrack */}
            {isYouTrack && (
              <div className="idp-section idp-comments-section">
                <div className="idp-section-label">
                  <MessageSquare size={13} />
                  Comments{comments.length > 0 ? ` · ${comments.length}` : ''}
                </div>

                {commentsLoading ? (
                  <div className="idp-comments-loading">
                    {[80, 65, 90].map((w, i) => (
                      <div key={i} className="idp-comment-skeleton">
                        <div className="skeleton" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div className="skeleton" style={{ width: '40%', height: 10, borderRadius: 4 }} />
                          <div className="skeleton" style={{ width: `${w}%`, height: 10, borderRadius: 4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : comments.length === 0 ? (
                  <p className="idp-no-comments">No comments yet.</p>
                ) : (
                  <div className="idp-comments-list">
                    {comments.map(c => (
                      <div key={c.id} className="idp-comment">
                        <div className="idp-comment-avatar">
                          {c.author.avatarUrl
                            ? <img src={c.author.avatarUrl} alt={c.author.fullName} />
                            : <span>{getInitials(c.author.fullName || c.author.login)}</span>}
                        </div>
                        <div className="idp-comment-body">
                          <div className="idp-comment-header">
                            <span className="idp-comment-author">{c.author.fullName || c.author.login}</span>
                            <span className="idp-comment-time">{formatCommentTime(c.created)}</span>
                          </div>
                          <p className="idp-comment-text">{c.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Comment input */}
                <div className="idp-comment-input-wrap">
                  <textarea
                    ref={textareaRef}
                    className="idp-comment-input"
                    placeholder="Write a comment…"
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePostComment()
                    }}
                    rows={3}
                  />
                  <div className="idp-comment-actions">
                    <span className="idp-comment-hint">Ctrl+Enter to submit</span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handlePostComment}
                      disabled={!commentText.trim() || posting}
                    >
                      <Send size={13} />
                      {posting ? 'Posting…' : 'Add comment'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Right: metadata sidebar ── */}
          <div className="idp-sidebar">
            <div className="idp-meta-group">

              <div className="idp-meta-row">
                <span className="idp-meta-label">Status</span>
                <span className="idp-status-badge">{issue.status || '—'}</span>
              </div>

              <div className="idp-meta-row">
                <span className="idp-meta-label">Priority</span>
                {issue.priority
                  ? <span className="idp-priority-badge" style={priStyle}>{issue.priority}</span>
                  : <span className="idp-meta-value">—</span>}
              </div>

              <div className="idp-meta-row">
                <span className="idp-meta-label">
                  <User size={11} style={{ opacity: 0.6 }} /> Assignee
                </span>
                {issue.assignee ? (
                  <div className="idp-assignee">
                    <div className="idp-assignee-avatar">
                      {issue.assignee.avatarUrl
                        ? <img src={issue.assignee.avatarUrl} alt={issue.assignee.fullName} />
                        : <span>{getInitials(issue.assignee.fullName || issue.assignee.login)}</span>}
                    </div>
                    <span className="idp-assignee-name">{issue.assignee.fullName || issue.assignee.login}</span>
                  </div>
                ) : <span className="idp-meta-value">Unassigned</span>}
              </div>

              {issue.subsystem && (
                <div className="idp-meta-row">
                  <span className="idp-meta-label">Subsystem</span>
                  <span className="idp-meta-value">{issue.subsystem}</span>
                </div>
              )}

              <div className="idp-meta-row">
                <span className="idp-meta-label">
                  <Clock size={11} style={{ opacity: 0.6 }} /> Due date
                </span>
                <span className={`idp-meta-value ${issue.due_date && issue.due_date < Date.now() ? 'idp-overdue' : ''}`}>
                  {fmtDate(issue.due_date)}
                </span>
              </div>

              <div className="idp-meta-row">
                <span className="idp-meta-label">Created</span>
                <span className="idp-meta-value">{fmtDateTime(issue.created)}</span>
              </div>

              <div className="idp-meta-row">
                <span className="idp-meta-label">Updated</span>
                <span className="idp-meta-value">{fmtDateTime(issue.updated)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Attachment viewer overlay */}
    {viewerIndex !== null && allAttachments.length > 0 && (
      <AttachmentViewer
        attachments={allAttachments}
        initialIndex={viewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    )}
  </>
  )
}
