/**
 * pmDataService — source-agnostic PM data layer.
 *
 * All PM pages import from here instead of calling api.youtrack* or
 * api.asanaPM* directly. The active source is read from localStorage
 * (synced to DB on change via setActiveSource).
 */

import api from './api'

export type DataSource = 'youtrack' | 'asana'

const SOURCE_KEY = 'pm_active_source'

export function getActiveSource(): DataSource {
  return (localStorage.getItem(SOURCE_KEY) as DataSource) || 'youtrack'
}

export async function setActiveSource(source: DataSource): Promise<void> {
  localStorage.setItem(SOURCE_KEY, source)
  await api.setDataSource(source)
}

export async function loadActiveSourceFromDB(): Promise<DataSource> {
  try {
    const res = await api.getDataSource()
    const source = (res.data?.source || 'youtrack') as DataSource
    localStorage.setItem(SOURCE_KEY, source)
    return source
  } catch {
    return getActiveSource()
  }
}

// ── Status ───────────────────────────────────────────────────────────────────

export function getPMStatus() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMStatus()
    : api.getYouTrackStatus()
}

// ── Lists / metadata ─────────────────────────────────────────────────────────

export function getPMProjects() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMProjects()
    : api.getYouTrackProjects()
}

export function getPMBoards() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMBoards()
    : api.getYouTrackBoards()
}

export function getPMBoardColumns(boardId: string) {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMBoardColumns(boardId)
    : api.getYouTrackBoardColumns(boardId)
}

export function getPMStates() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMStates()
    : api.getYouTrackStates()
}

export function getPMPriorities() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMPriorities()
    : api.getYouTrackPriorities()
}

export function getPMUsers() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMUsers()
    : api.getYouTrackUsers()
}

export function getPMSections() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMSections()
    : api.getYouTrackSections()
}

// ── Issues / tasks ────────────────────────────────────────────────────────────

export function getPMIssues() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMIssues()
    : api.getYouTrackIssues()
}

export function getPMIssue(id: string) {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMIssue(id)
    : api.getYouTrackIssue(id)
}

export function createPMIssue(params: {
  summary: string
  description?: string
  state?: string
  priority?: string
  assignee_login?: string
  due_date?: number
  estimation_minutes?: number
}) {
  return getActiveSource() === 'asana'
    ? api.createAsanaPMIssue(params)
    : api.createYouTrackIssue(params)
}

export function updatePMIssue(id: string, summary?: string, description?: string, state?: string) {
  return getActiveSource() === 'asana'
    ? api.updateAsanaPMIssue(id, summary, description, state)
    : api.updateYouTrackIssue(id, summary, description, state)
}

export function updatePMIssueState(id: string, state: string) {
  return getActiveSource() === 'asana'
    ? api.updateAsanaPMIssueState(id, state)
    : api.updateYouTrackIssueState(id, state)
}

export function deletePMIssue(id: string) {
  return getActiveSource() === 'asana'
    ? api.deleteAsanaPMIssue(id)
    : api.deleteYouTrackIssue(id)
}

export function getPMIssuesGroupedByAssignee() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMIssuesGroupedByAssignee()
    : api.getYouTrackIssuesGroupedByAssignee()
}

// ── AI / analysis ─────────────────────────────────────────────────────────────

export function pmAssistantQuery(query: string, history: { role: string; content: string }[] = []) {
  return getActiveSource() === 'asana'
    ? api.asanaPMAssistantQuery(query, history)
    : api.pmAssistantQuery(query, history)
}

export function matchAnalysis(personBreakdown: any[], analysis: any[]) {
  return getActiveSource() === 'asana'
    ? api.matchAnalysisWithAsana(personBreakdown, analysis)
    : api.matchAnalysisWithYouTrack(personBreakdown, analysis)
}

// ── Daily ops ─────────────────────────────────────────────────────────────────

export function getDailyBrief() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMDailyBrief()
    : api.getDailyBrief()
}

export function getEODSummary() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMEODSummary()
    : api.getEODSummary()
}

export function getDeveloperLoad() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMDeveloperLoad()
    : api.getDeveloperLoad()
}

export function getBlockerReasons(issueIds: string[]) {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMBlockerReasons(issueIds)
    : api.getBlockerReasons(issueIds)
}

export function saveCarryoverPlan(items: any[]) {
  return getActiveSource() === 'asana'
    ? api.saveAsanaPMCarryoverPlan(items)
    : api.saveCarryoverPlan(items)
}

export function getCarryover() {
  return getActiveSource() === 'asana'
    ? api.getAsanaPMCarryover()
    : api.getCarryover()
}
