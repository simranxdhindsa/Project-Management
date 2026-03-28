import React from 'react'
import type { DeploymentTicket } from './types'

interface Props {
  tickets: DeploymentTicket[]
}

const PLATFORM_BADGE_CLASS: Record<string, string> = {
  'UI': 'dr-badge dr-badge-ui',
  'Studio': 'dr-badge dr-badge-studio',
  'Mission Control': 'dr-badge dr-badge-mc',
  'Backend': 'dr-badge dr-badge-be',
  'Uncategorized': 'dr-badge dr-badge-other',
}

const PRIORITY_BADGE_CLASS: Record<string, string> = {
  'P0': 'dr-badge dr-badge-p0',
  'P1': 'dr-badge dr-badge-p1',
  'P2': 'dr-badge dr-badge-p2',
  'P3': 'dr-badge dr-badge-p3',
}

function statusIcon(status: DeploymentTicket['status']): string {
  switch (status) {
    case 'fetching': return '⏳'
    case 'generating': return '⏳'
    case 'ready': return '✓'
    case 'error': return '✗'
    default: return '•'
  }
}

function ticketCardClass(status: DeploymentTicket['status']): string {
  if (status === 'error') return 'dr-ticket-card dr-ticket-card--error'
  if (status === 'generating') return 'dr-ticket-card dr-ticket-card--generating'
  if (status === 'fetching') return 'dr-ticket-card dr-ticket-card--fetching'
  return 'dr-ticket-card'
}

function ticketDisplayName(t: DeploymentTicket): string {
  if (t.status === 'fetching') return 'Fetching…'
  if (t.status === 'generating') return 'Generating fix statement…'
  return t.cleanName || t.name
}

export default function DeploymentTicketList({ tickets }: Props) {
  return (
    <div className="dr-ticket-list">
      {tickets.map((t, i) => (
        <div key={t.gid || i} className={ticketCardClass(t.status)}>
          <span className={`dr-ticket-status-icon dr-status-${t.status}`}>{statusIcon(t.status)}</span>
          <span className={PLATFORM_BADGE_CLASS[t.platform] ?? 'dr-badge dr-badge-other'}>{t.platform}</span>
          {t.priority && (
            <span className={PRIORITY_BADGE_CLASS[t.priority] ?? 'dr-badge dr-badge-other'}>{t.priority}</span>
          )}
          <span className="dr-ticket-name" title={t.cleanName || t.name}>
            {ticketDisplayName(t)}
          </span>
          {t.manualDescription && (
            <span className="dr-badge dr-badge-other" title="Manual override">M</span>
          )}
          {t.fixStatement && t.status === 'ready' && (
            <span className="dr-ticket-fix" title={t.fixStatement}>✦</span>
          )}
        </div>
      ))}
    </div>
  )
}
