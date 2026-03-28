export type Platform = 'UI' | 'Studio' | 'Mission Control' | 'Backend' | 'Uncategorized'
export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'A0' | 'A1' | 'A2' | 'A3' | null

export interface DeploymentTicket {
  url: string
  gid: string
  name: string
  notes: string
  manualDescription: boolean
  platform: Platform
  priority: Priority
  cleanName: string
  fixStatement: string | null
  status: 'pending' | 'fetching' | 'ready' | 'error' | 'generating'
  error?: string
}

// Priority display order
export const PRIORITY_ORDER: Array<Priority> = ['P0', 'P1', 'P2', 'P3', 'A0', 'A1', 'A2', 'A3', null]

// Extract priority from raw ticket title
export function extractPriority(raw: string): Priority {
  const m = raw.match(/^([AP][0-3])\s/i)
  if (!m) return null
  return m[1].toUpperCase() as Priority
}

// Detect platform from title prefixes
export function detectPlatform(title: string): Platform {
  const t = title.toUpperCase()
  if (/\bBE\s+(RAG|PLATFORM|INFRA)\b/.test(t)) return 'Backend'
  if (/\bBE\s+MC\b/.test(t)) return 'Mission Control'
  if (/\bBE\s+STUDIO\b/.test(t)) return 'Studio'
  if (/\bBE\s+UI\b/.test(t)) return 'Backend'
  if (/\bFE\s+MC\b|\bMC\b.*:/.test(t) || /\bMISSION\s*CONTROL\b/.test(t)) return 'Mission Control'
  if (/\bFE\s+STUDIO\b|\bSTUDIO\b.*:/.test(t)) return 'Studio'
  if (/\bFE\s+UI\b|\bUI\b.*:/.test(t)) return 'UI'
  if (/\bMC\b/.test(t.split(':')[0])) return 'Mission Control'
  if (/\bSTUDIO\b/.test(t.split(':')[0])) return 'Studio'
  if (/\bUI\b/.test(t.split(':')[0])) return 'UI'
  if (/^\s*(?:[AP][0-3]\s+)?(?:REGRESSION\s+)?BE\b/.test(t)) return 'Backend'
  return 'Uncategorized'
}

// Strip priority, regression, and platform prefix tags
export function stripPrefix(raw: string): string {
  return raw
    .replace(/^[AP][0-3]\s+/i, '')
    .replace(/^Regression\s+/i, '')
    .replace(/^(?:FE|BE)\s+(?:UI|MC|Studio|RAG|Platform|Infra)\s*:\s*/i, '')
    .replace(/^(?:UI|MC|Studio|Mission Control)\s*:\s*/i, '')
    .replace(/^(?:FE|BE)\s*:\s*/i, '')
    .trim()
}
