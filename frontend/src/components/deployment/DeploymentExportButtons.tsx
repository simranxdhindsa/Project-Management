import React, { useState } from 'react'
import { Copy, Check, FileText, FileDown } from 'lucide-react'
import { saveAs } from 'file-saver'
import { jsPDF } from 'jspdf'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import type { DeploymentTicket } from './types'
import { PRIORITY_ORDER } from './types'
import type { DeploymentSectionConfig } from '../../services/api'
import { buildDeploymentReportText } from './DeploymentReportPreview'

interface Props {
  tickets: DeploymentTicket[]
  sections: DeploymentSectionConfig[]
  disabled: boolean
}

export default function DeploymentExportButtons({ tickets, sections, disabled }: Props) {
  const [copied, setCopied] = useState(false)
  const [showFallback, setShowFallback] = useState(false)

  const plainText = buildDeploymentReportText(tickets, sections)

  const buildHtml = (): string => {
    const enabledSections = sections.filter(s => s.enabled)
    const parts: string[] = []
    for (const section of enabledSections) {
      const sectionTickets = tickets.filter(t => t.platform === section.platform && t.fixStatement && t.status === 'ready')
      if (!sectionTickets.length) continue
      parts.push(`<h2>${section.header}</h2>`)
      const byPriority = new Map<string | null, DeploymentTicket[]>()
      for (const t of sectionTickets) {
        const arr = byPriority.get(t.priority) ?? []
        arr.push(t)
        byPriority.set(t.priority, arr)
      }
      for (const p of PRIORITY_ORDER) {
        const group = byPriority.get(p)
        if (!group?.length) continue
        if (p) parts.push(`<strong>${p}</strong>`)
        parts.push('<ul>')
        for (const t of group) parts.push(`<li>${t.fixStatement}</li>`)
        parts.push('</ul>')
      }
      parts.push('<hr/>')
    }
    return parts.join('\n')
  }

  const handleCopy = async () => {
    if (!plainText) return
    try {
      const html = buildHtml()
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        }),
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      try {
        await navigator.clipboard.writeText(plainText)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        setShowFallback(true)
      }
    }
  }

  const handlePDF = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const lines = plainText.split('\n')
    let y = 40
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 40
    const maxW = doc.internal.pageSize.getWidth() - margin * 2

    for (const line of lines) {
      if (y > pageH - margin) { doc.addPage(); y = 40 }
      if (line.startsWith('## ')) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(13)
        doc.text(line.replace('## ', ''), margin, y)
        y += 20
      } else if (line.startsWith('**') && line.endsWith('**')) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.text(line.replace(/\*\*/g, ''), margin, y)
        y += 15
      } else if (line.startsWith('- ')) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        const wrapped = doc.splitTextToSize(line, maxW - 10)
        doc.text(wrapped, margin + 10, y)
        y += wrapped.length * 14
      } else if (line === '---') {
        doc.setDrawColor(200, 200, 200)
        doc.line(margin, y, margin + maxW, y)
        y += 10
      } else {
        y += 8
      }
    }
    doc.save('deployment-report.pdf')
  }

  const handleDOCX = async () => {
    const enabledSections = sections.filter(s => s.enabled)
    const docChildren: Paragraph[] = []

    for (const section of enabledSections) {
      const sectionTickets = tickets.filter(t => t.platform === section.platform && t.fixStatement && t.status === 'ready')
      if (!sectionTickets.length) continue

      docChildren.push(new Paragraph({
        text: section.header,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
      }))

      const byPriority = new Map<string | null, DeploymentTicket[]>()
      for (const t of sectionTickets) {
        const arr = byPriority.get(t.priority) ?? []
        arr.push(t)
        byPriority.set(t.priority, arr)
      }

      for (const p of PRIORITY_ORDER) {
        const group = byPriority.get(p)
        if (!group?.length) continue
        if (p) {
          docChildren.push(new Paragraph({
            children: [new TextRun({ text: p, bold: true, size: 22 })],
            spacing: { before: 100, after: 60 },
          }))
        }
        for (const t of group) {
          docChildren.push(new Paragraph({
            text: `• ${t.fixStatement}`,
            spacing: { before: 40, after: 40 },
          }))
        }
      }

      docChildren.push(new Paragraph({ text: '', spacing: { before: 100 } }))
    }

    const doc = new Document({ sections: [{ children: docChildren }] })
    const blob = await Packer.toBlob(doc)
    saveAs(blob, 'deployment-report.docx')
  }

  if (showFallback) {
    return (
      <div className="dr-card">
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Copy the report below:</p>
        <textarea
          className="dr-textarea"
          rows={12}
          readOnly
          value={plainText}
          onFocus={e => e.target.select()}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
        />
        <button className="btn-ghost btn-sm" onClick={() => setShowFallback(false)}>Close</button>
      </div>
    )
  }

  return (
    <div className="dr-export-row">
      <button className="btn-secondary btn-sm" onClick={handleCopy} disabled={disabled || !plainText}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <button className="btn-secondary btn-sm" onClick={handlePDF} disabled={disabled || !plainText}>
        <FileText size={13} />
        PDF
      </button>
      <button className="btn-secondary btn-sm" onClick={handleDOCX} disabled={disabled || !plainText}>
        <FileDown size={13} />
        DOCX
      </button>
    </div>
  )
}
