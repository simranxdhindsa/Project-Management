import { useState, useEffect } from 'react'
import api from '../services/api'
import type { TaskStatusAnalysis, Discrepancy, AIAnalysisResponse } from '../services/api'

export function AIAnalysisPage() {
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<TaskStatusAnalysis[]>([])
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([])
  const [summary, setSummary] = useState<AIAnalysisResponse['summary'] | null>(null)
  const [projectId, setProjectId] = useState<string>('default') // Should come from context/selection
  const [lastAnalyzed, setLastAnalyzed] = useState<Date | null>(null)

  useEffect(() => {
    fetchDiscrepancies()
  }, [])

  const fetchDiscrepancies = async () => {
    try {
      setLoading(true)
      const response = await api.getDiscrepancies()
      if (response.success && response.data) {
        setDiscrepancies(response.data.discrepancies || [])
      }
    } catch (err) {
      console.error('Error fetching discrepancies:', err)
    } finally {
      setLoading(false)
    }
  }

  const runAnalysis = async () => {
    try {
      setAnalyzing(true)
      setError(null)
      const response = await api.analyzeSlackMessages(projectId)
      if (response.success && response.data) {
        setAnalysis(response.data.analysis || [])
        setDiscrepancies(response.data.discrepancies || [])
        setSummary(response.data.summary || null)
        setLastAnalyzed(new Date())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run AI analysis')
    } finally {
      setAnalyzing(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'done':
        return 'status-done'
      case 'in_progress':
      case 'in progress':
        return 'status-in_progress'
      case 'blocked':
        return 'status-blocked'
      case 'not_started':
      case 'todo':
        return 'status-todo'
      default:
        return 'status-unknown'
    }
  }

  const getConfidenceClass = (confidence: number) => {
    if (confidence >= 0.8) return 'confidence-high'
    if (confidence >= 0.5) return 'confidence-medium'
    return 'confidence-low'
  }

  const formatConfidence = (confidence: number) => {
    return `${Math.round(confidence * 100)}%`
  }

  return (
    <div className="ai-analysis-page">
      <div className="page-header">
        <div className="header-left">
          <h1 className="page-title">AI Analysis</h1>
          <p className="page-subtitle">
            Compare Slack-reported task statuses with Asana to find discrepancies
          </p>
        </div>
        <div className="header-right">
          <button
            className="btn btn-primary"
            onClick={runAnalysis}
            disabled={analyzing}
          >
            {analyzing ? (
              <>
                <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" opacity="0.3" />
                  <path d="M12 2 a10 10 0 0 1 10 10" />
                </svg>
                Analyzing...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Run AI Analysis
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {lastAnalyzed && (
        <div className="last-analyzed">
          Last analyzed: {lastAnalyzed.toLocaleTimeString()}
        </div>
      )}

      {summary && (
        <div className="analysis-summary glass-card">
          <h2 className="section-title">Analysis Summary</h2>
          <div className="summary-stats">
            <div className="stat-card">
              <div className="stat-value">{summary.messages_read}</div>
              <div className="stat-label">Messages Analyzed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{summary.tasks_analyzed}</div>
              <div className="stat-label">Tasks Detected</div>
            </div>
            <div className="stat-card stat-warning">
              <div className="stat-value">{summary.discrepancies}</div>
              <div className="stat-label">Discrepancies Found</div>
            </div>
          </div>
        </div>
      )}

      {discrepancies.length > 0 && (
        <div className="discrepancies-section glass-card">
          <h2 className="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Status Discrepancies
          </h2>
          <p className="section-description">
            These tasks have different statuses in Slack messages vs Asana
          </p>
          <div className="discrepancy-list">
            {discrepancies.map((d, index) => (
              <div key={index} className="discrepancy-item">
                <div className="discrepancy-task">
                  <span className="task-title">{d.task_title}</span>
                  <span className={`confidence-badge ${getConfidenceClass(d.confidence)}`}>
                    {formatConfidence(d.confidence)} confidence
                  </span>
                </div>
                <div className="discrepancy-comparison">
                  <div className="status-source">
                    <span className="source-label">Slack says:</span>
                    <span className={`status-badge ${getStatusColor(d.slack_status)}`}>
                      {d.slack_status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="status-arrow">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </div>
                  <div className="status-source">
                    <span className="source-label">Asana shows:</span>
                    <span className={`status-badge ${getStatusColor(d.asana_status)}`}>
                      {d.asana_status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <div className="discrepancy-actions">
                  <button className="btn btn-sm btn-ghost">
                    Update Asana
                  </button>
                  <button className="btn btn-sm btn-ghost">
                    View Messages
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {analysis.length > 0 && (
        <div className="analysis-results glass-card">
          <h2 className="section-title">All Task Analysis</h2>
          <div className="analysis-table">
            <div className="table-header">
              <div className="col-task">Task</div>
              <div className="col-status">Detected Status</div>
              <div className="col-confidence">Confidence</div>
              <div className="col-evidence">Evidence</div>
            </div>
            {analysis.map((item, index) => (
              <div key={index} className="table-row">
                <div className="col-task">{item.task_title}</div>
                <div className="col-status">
                  <span className={`status-badge ${getStatusColor(item.detected_status)}`}>
                    {item.detected_status.replace('_', ' ')}
                  </span>
                </div>
                <div className="col-confidence">
                  <div className={`confidence-bar ${getConfidenceClass(item.confidence)}`}>
                    <div
                      className="confidence-fill"
                      style={{ width: `${item.confidence * 100}%` }}
                    />
                  </div>
                  <span className="confidence-text">{formatConfidence(item.confidence)}</span>
                </div>
                <div className="col-evidence">
                  {item.evidence.length > 0 ? (
                    <ul className="evidence-list">
                      {item.evidence.slice(0, 2).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                      {item.evidence.length > 2 && (
                        <li className="more-evidence">
                          +{item.evidence.length - 2} more
                        </li>
                      )}
                    </ul>
                  ) : (
                    <span className="no-evidence">No direct evidence</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !analyzing && analysis.length === 0 && discrepancies.length === 0 && (
        <div className="empty-state glass-card">
          <div className="empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h3>No Analysis Data</h3>
          <p>Click "Run AI Analysis" to analyze yesterday's Slack messages and compare task statuses with Asana.</p>
        </div>
      )}

      {loading && (
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading previous analysis...</p>
        </div>
      )}
    </div>
  )
}
