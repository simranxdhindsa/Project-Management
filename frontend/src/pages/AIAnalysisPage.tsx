import { useState } from 'react'
import { Brain, Sparkles, TrendingUp, AlertCircle, CheckCircle, Clock, XCircle, Save, Link2 } from 'lucide-react'
import api from '../services/api'
import { MatchConfirmationModal } from '../components/MatchConfirmationModal'

interface AnalysisResult {
  task_title: string
  detected_status: string
  confidence: number
  evidence: string[]
}

interface PersonBreakdown {
  name: string
  assigned: string[]
  completed: string[]
  pending: string[]
  blocked: string[]
  stats: {
    total: number
    completed: number
    pending: number
    blocked: number
  }
}

interface Summary {
  total_tasks: number
  completed: number
  in_progress: number
  blocked: number
  not_mentioned: number
}

interface AIAnalysisPageProps {
  onNavigateToDailyAnalysis?: () => void
}

export function AIAnalysisPage({ onNavigateToDailyAnalysis }: AIAnalysisPageProps) {
  const [morningAssignments, setMorningAssignments] = useState('')
  const [eveningUpdates, setEveningUpdates] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [analysisDate, setAnalysisDate] = useState(new Date().toISOString().split('T')[0]) // Today's date in YYYY-MM-DD

  const [results, setResults] = useState<{
    analysis: AnalysisResult[]
    person_breakdown: PersonBreakdown[]
    summary: Summary
  } | null>(null)

  // YouTrack matching state
  const [matching, setMatching] = useState(false)
  const [matchResults, setMatchResults] = useState<{
    matches: any[]
    unmatched_tasks: any[]
    unmatched_issues: any[]
  } | null>(null)

  const exampleMorning = `\`todays task list\`

\`@Rajvir Singh\`
• PDF page numbers deprecation (High)
• No confirmation modal for quit course
• Mic/audio playback conflict

\`@Harpinder Singh\`
• Report API first access issue
• AI display mode changes
• Skeleton loading on onboarding

\`@Vishal\`
• BE Studio: Evaluation Bot config
• FE MC: Duplicate user error message`

  const exampleEvening = `Updates for today:

@Rajvir: Completed the PDF deprecation task and the quit modal. Still working on the mic conflict.

@Harpinder: Fixed the Report API issue. The AI display and skeleton loading are done.

@Vishal: BE Bot config is complete. The FE duplicate error is blocked - waiting for design approval.`

  const handleAnalyze = async () => {
    if (!morningAssignments.trim() || !eveningUpdates.trim()) {
      setError('Please enter both morning assignments and evening updates')
      return
    }

    try {
      setAnalyzing(true)
      setError(null)
      console.log('Starting analysis...')
      const response = await api.analyzeManualInput(morningAssignments, eveningUpdates) as any
      console.log('API Response:', response)
      // Check both response shapes - wrapped in data or at root level
      const analysis = response.data?.analysis || response.analysis
      const person_breakdown = response.data?.person_breakdown || response.person_breakdown
      const summary = response.data?.summary || response.summary

      if (response.success && analysis) {
        setResults({
          analysis,
          person_breakdown,
          summary,
        })
      } else {
        console.error('No analysis in response:', response)
      }
    } catch (err) {
      console.error('Analysis error:', err)
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const loadExample = () => {
    setMorningAssignments(exampleMorning)
    setEveningUpdates(exampleEvening)
    setResults(null)
    setSuccessMessage(null)
  }

  const handleSaveAnalysis = async () => {
    if (!results) {
      setError('No analysis to save. Please run analysis first.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      setSuccessMessage(null)

      const response = await api.saveAnalysis(
        analysisDate,
        morningAssignments,
        eveningUpdates,
        {
          analysis: results.analysis,
          person_breakdown: results.person_breakdown,
          summary: results.summary
        }
      )

      if (response.success) {
        setSuccessMessage(`Analysis saved successfully for ${analysisDate}!`)
        // Redirect to Daily Analysis page after 1.5 seconds
        setTimeout(() => {
          setSuccessMessage(null)
          if (onNavigateToDailyAnalysis) {
            onNavigateToDailyAnalysis()
          }
        }, 1500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save analysis')
    } finally {
      setSaving(false)
    }
  }

  const handleMatchWithYouTrack = async () => {
    if (!results) return
    try {
      setMatching(true)
      setError(null)
      const response = await api.matchAnalysisWithYouTrack(
        results.person_breakdown,
        results.analysis
      ) as any
      const data = response.data || response
      setMatchResults({
        matches: data.matches || [],
        unmatched_tasks: data.unmatched_tasks || [],
        unmatched_issues: data.unmatched_issues || [],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to match with YouTrack')
    } finally {
      setMatching(false)
    }
  }

  const getStatusColor = (status: string) => {
    const normalized = status.toLowerCase()
    if (normalized.includes('complete') || normalized.includes('done')) return 'var(--color-success)'
    if (normalized.includes('progress') || normalized.includes('working')) return 'var(--color-warning)'
    if (normalized.includes('block')) return 'var(--color-danger)'
    return 'var(--color-secondary)'
  }

  const getStatusIcon = (status: string) => {
    const normalized = status.toLowerCase()
    if (normalized.includes('complete') || normalized.includes('done')) return <CheckCircle size={16} />
    if (normalized.includes('progress') || normalized.includes('working')) return <Clock size={16} />
    if (normalized.includes('block')) return <XCircle size={16} />
    return <AlertCircle size={16} />
  }

  return (
    <div className="ai-analysis-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Brain size={28} style={{ color: 'var(--color-primary)' }} />
            AI Task Analysis
          </h1>
          <p className="page-subtitle">
            Paste morning task assignments and evening updates to analyze completion status with AI
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Analysis Date</label>
            <input
              type="date"
              value={analysisDate}
              onChange={(e) => setAnalysisDate(e.target.value)}
              className="btn btn-ghost btn-sm"
              style={{ padding: '0.5rem', minWidth: '150px' }}
            />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadExample} style={{ marginTop: '1.2rem' }}>
            <Sparkles size={16} /> Load Example
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={20} />
          {error}
          <button className="alert-close" onClick={() => setError(null)}>
            &times;
          </button>
        </div>
      )}

      {successMessage && (
        <div className="alert alert-success">
          <CheckCircle size={20} />
          {successMessage}
          <button className="alert-close" onClick={() => setSuccessMessage(null)}>
            &times;
          </button>
        </div>
      )}

      <div className="ai-input-section glass-card">
        <div className="ai-input-grid">
          <div className="ai-input-column">
            <label className="ai-input-label">
              <TrendingUp size={18} />
              Morning Task Assignments
            </label>
            <textarea
              className="ai-textarea"
              value={morningAssignments}
              onChange={(e) => setMorningAssignments(e.target.value)}
              placeholder="Paste your morning 'todays task list' message here..."
              rows={15}
            />
            <p className="ai-input-hint">
              Supports Slack format with <code>`@Person Name`</code> and bullet points
            </p>
          </div>

          <div className="ai-input-column">
            <label className="ai-input-label">
              <CheckCircle size={18} />
              Evening Task Updates
            </label>
            <textarea
              className="ai-textarea"
              value={eveningUpdates}
              onChange={(e) => setEveningUpdates(e.target.value)}
              placeholder="Paste your evening status update message here..."
              rows={15}
            />
            <p className="ai-input-hint">
              Include what was completed, what's in progress, and any blockers
            </p>
          </div>
        </div>

        <div className="ai-actions">
          <button
            className="btn btn-primary btn-lg"
            onClick={handleAnalyze}
            disabled={analyzing || !morningAssignments.trim() || !eveningUpdates.trim()}
          >
            {analyzing ? (
              <>
                <div className="loading-spinner" style={{ width: '16px', height: '16px' }} />
                Analyzing with AI...
              </>
            ) : (
              <>
                <Brain size={18} />
                Analyze with AI
              </>
            )}
          </button>
        </div>
      </div>

      {results && (
        <>
          {/* Save Analysis & Match Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <button
              className="btn btn-lg"
              onClick={handleMatchWithYouTrack}
              disabled={matching}
              style={{
                background: '#8250df',
                color: 'white',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              {matching ? (
                <>
                  <div className="loading-spinner" style={{ width: '16px', height: '16px' }} />
                  Matching...
                </>
              ) : (
                <>
                  <Link2 size={18} />
                  Match with YouTrack
                </>
              )}
            </button>
            <button
              className="btn btn-success btn-lg"
              onClick={handleSaveAnalysis}
              disabled={saving}
            >
              {saving ? (
                <>
                  <div className="loading-spinner" style={{ width: '16px', height: '16px' }} />
                  Saving...
                </>
              ) : (
                <>
                  <Save size={18} />
                  Save Analysis for {analysisDate}
                </>
              )}
            </button>
          </div>

          {/* Summary Cards */}
          <div className="ai-summary-grid">
            <div className="ai-summary-card glass-card">
              <div className="ai-summary-icon" style={{ backgroundColor: 'var(--color-primary-light)' }}>
                <TrendingUp size={24} color="var(--color-primary)" />
              </div>
              <div className="ai-summary-content">
                <span className="ai-summary-value">{results.summary.total_tasks}</span>
                <span className="ai-summary-label">Total Tasks</span>
              </div>
            </div>

            <div className="ai-summary-card glass-card">
              <div className="ai-summary-icon" style={{ backgroundColor: 'var(--color-success-light)' }}>
                <CheckCircle size={24} color="var(--color-success)" />
              </div>
              <div className="ai-summary-content">
                <span className="ai-summary-value">{results.summary.completed}</span>
                <span className="ai-summary-label">Completed</span>
              </div>
            </div>

            <div className="ai-summary-card glass-card">
              <div className="ai-summary-icon" style={{ backgroundColor: 'var(--color-warning-light)' }}>
                <Clock size={24} color="var(--color-warning)" />
              </div>
              <div className="ai-summary-content">
                <span className="ai-summary-value">{results.summary.in_progress}</span>
                <span className="ai-summary-label">In Progress</span>
              </div>
            </div>

            <div className="ai-summary-card glass-card">
              <div className="ai-summary-icon" style={{ backgroundColor: 'var(--color-danger-light)' }}>
                <XCircle size={24} color="var(--color-danger)" />
              </div>
              <div className="ai-summary-content">
                <span className="ai-summary-value">{results.summary.blocked}</span>
                <span className="ai-summary-label">Blocked</span>
              </div>
            </div>
          </div>

          {/* Per-Person Breakdown */}
          <div className="ai-person-section">
            <h2 className="section-title">Per-Person Analysis</h2>
            <div className="ai-person-grid">
              {results.person_breakdown.map((person) => (
                <div key={person.name} className="ai-person-card glass-card">
                  <div className="ai-person-header">
                    <h3 className="ai-person-name">@{person.name}</h3>
                    <div className="ai-person-stats">
                      <span className="ai-stat-badge ai-stat-success">
                        {person.stats.completed}/{person.stats.total} ✓
                      </span>
                    </div>
                  </div>

                  <div className="ai-person-body">
                    {person.completed.length > 0 && (
                      <div className="ai-task-group">
                        <span className="ai-task-group-label" style={{ color: 'var(--color-success)' }}>
                          <CheckCircle size={14} /> Completed ({person.completed.length})
                        </span>
                        <ul className="ai-task-list">
                          {person.completed.map((task, idx) => (
                            <li key={idx} className="ai-task-item ai-task-completed">{task}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {person.pending.length > 0 && (
                      <div className="ai-task-group">
                        <span className="ai-task-group-label" style={{ color: 'var(--color-warning)' }}>
                          <Clock size={14} /> Pending ({person.pending.length})
                        </span>
                        <ul className="ai-task-list">
                          {person.pending.map((task, idx) => (
                            <li key={idx} className="ai-task-item ai-task-pending">{task}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {person.blocked.length > 0 && (
                      <div className="ai-task-group">
                        <span className="ai-task-group-label" style={{ color: 'var(--color-danger)' }}>
                          <XCircle size={14} /> Blocked ({person.blocked.length})
                        </span>
                        <ul className="ai-task-list">
                          {person.blocked.map((task, idx) => (
                            <li key={idx} className="ai-task-item ai-task-blocked">{task}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detailed Analysis */}
          <div className="ai-detail-section">
            <h2 className="section-title">Detailed AI Analysis</h2>
            <div className="ai-detail-table glass-card">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Status</th>
                    <th>Confidence</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {results.analysis.map((item, idx) => (
                    <tr key={idx}>
                      <td className="ai-task-title">{item.task_title}</td>
                      <td>
                        <span
                          className="ai-status-badge"
                          style={{ backgroundColor: getStatusColor(item.detected_status) }}
                        >
                          {getStatusIcon(item.detected_status)}
                          {item.detected_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td>
                        <div className="ai-confidence">
                          <div
                            className="ai-confidence-bar"
                            style={{
                              width: `${item.confidence * 100}%`,
                              backgroundColor: item.confidence > 0.7 ? 'var(--color-success)' : 'var(--color-warning)',
                            }}
                          />
                          <span className="ai-confidence-text">{Math.round(item.confidence * 100)}%</span>
                        </div>
                      </td>
                      <td className="ai-evidence">
                        {item.evidence.length > 0 ? (
                          <span className="ai-evidence-text">"{item.evidence[0]}"</span>
                        ) : (
                          <span className="ai-no-evidence">No direct evidence</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {/* YouTrack Match Confirmation Modal */}
      {matchResults && (
        <MatchConfirmationModal
          matches={matchResults.matches}
          unmatchedTasks={matchResults.unmatched_tasks}
          unmatchedIssues={matchResults.unmatched_issues}
          onClose={() => setMatchResults(null)}
          onSuccess={() => {
            setMatchResults(null)
            setSuccessMessage('YouTrack tickets updated successfully!')
            setTimeout(() => setSuccessMessage(null), 3000)
          }}
        />
      )}
    </div>
  )
}
