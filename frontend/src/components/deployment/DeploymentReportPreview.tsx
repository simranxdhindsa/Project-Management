import React from 'react'
import type { DeploymentTicket, Priority } from './types'
import { PRIORITY_ORDER } from './types'
import type { DeploymentSectionConfig } from '../../services/api'

interface Props {
  tickets: DeploymentTicket[]
  sections: DeploymentSectionConfig[]
}

function priorityLabel(p: Priority): string {
  return p ?? 'Other Fixes'
}

export function buildDeploymentReportText(tickets: DeploymentTicket[], sections: DeploymentSectionConfig[]): string {
  const enabledSections = sections.filter(s => s.enabled)
  const lines: string[] = []

  for (const section of enabledSections) {
    const sectionTickets = tickets.filter(
      t => t.platform === section.platform && t.fixStatement && t.status === 'ready'
    )
    if (sectionTickets.length === 0) continue

    lines.push(`## ${section.header}:`)
    lines.push('')

    const byPriority = new Map<Priority, DeploymentTicket[]>()
    for (const t of sectionTickets) {
      const arr = byPriority.get(t.priority) ?? []
      arr.push(t)
      byPriority.set(t.priority, arr)
    }

    for (const p of PRIORITY_ORDER) {
      const group = byPriority.get(p)
      if (!group?.length) continue
      if (p !== null) lines.push(`**${p}**`)
      for (const t of group) {
        lines.push(`- ${t.fixStatement}`)
      }
      lines.push('')
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n').trim()
}

export default function DeploymentReportPreview({ tickets, sections }: Props) {
  const enabledSections = sections.filter(s => s.enabled)

  return (
    <div className="dr-report-preview">
      {enabledSections.map(section => {
        const sectionTickets = tickets.filter(
          t => t.platform === section.platform && t.fixStatement && t.status === 'ready'
        )
        if (sectionTickets.length === 0) return null

        const byPriority = new Map<Priority, DeploymentTicket[]>()
        for (const t of sectionTickets) {
          const arr = byPriority.get(t.priority) ?? []
          arr.push(t)
          byPriority.set(t.priority, arr)
        }

        return (
          <div key={section.platform} style={{ marginBottom: '1rem' }}>
            <div className="dr-report-section-header">{section.header}:</div>
            {PRIORITY_ORDER.map(p => {
              const group = byPriority.get(p)
              if (!group?.length) return null
              return (
                <div key={String(p)}>
                  {p !== null && <div className="dr-report-priority-label">{p}</div>}
                  {group.map((t, i) => (
                    <div key={i} className="dr-report-bullet">• {t.fixStatement}</div>
                  ))}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
