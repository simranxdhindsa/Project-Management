const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api'

interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

class ApiService {
  private token: string | null = null

  constructor() {
    // Load token from localStorage on init
    this.token = localStorage.getItem('token')
  }

  setToken(token: string | null) {
    this.token = token
    if (token) {
      localStorage.setItem('token', token)
    } else {
      localStorage.removeItem('token')
    }
  }

  getToken() {
    return this.token
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Merge existing headers if any
    if (options.headers) {
      const existingHeaders = options.headers as Record<string, string>
      Object.assign(headers, existingHeaders)
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'An error occurred')
    }

    return data
  }

  // Auth endpoints
  async googleAuth(credential: string, rememberMe: boolean = false) {
    return this.request<{ user: User; token: string }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential, remember_me: rememberMe }),
    })
  }

  async refreshToken() {
    return this.request<{ token: string }>('/auth/refresh', {
      method: 'POST',
    })
  }

  async getMe() {
    return this.request<User>('/auth/me')
  }

  async logout() {
    return this.request('/auth/logout', { method: 'POST' })
  }

  // Task endpoints
  async getTasks(filters?: { status?: string; date?: string }) {
    const params = new URLSearchParams()
    if (filters?.status) params.append('status', filters.status)
    if (filters?.date) params.append('date', filters.date)
    const query = params.toString() ? `?${params}` : ''
    return this.request<Task[]>(`/tasks${query}`)
  }

  async getYesterdayPending() {
    return this.request<Task[]>('/tasks/yesterday-pending')
  }

  async getTasksByDate(date: string) {
    return this.request<Task[]>(`/tasks/by-date/${date}`)
  }

  async createTask(task: Partial<Task>) {
    return this.request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    })
  }

  async updateTaskStatus(taskId: string, status: string) {
    return this.request(`/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  }

  // Asana endpoints
  async connectAsana(accessToken: string, workspaceId?: string) {
    return this.request('/asana/connect', {
      method: 'POST',
      body: JSON.stringify({ access_token: accessToken, workspace_id: workspaceId }),
    })
  }

  async disconnectAsana() {
    return this.request('/asana/disconnect', { method: 'POST' })
  }

  async getAsanaStatus() {
    return this.request<{
      connected: boolean
      workspace_id?: string
      workspace_name?: string
      last_sync_at?: string
    }>('/asana/status')
  }

  async getAsanaProjects() {
    return this.request<AsanaProject[]>('/asana/projects')
  }

  async linkProjectToAsana(projectId: string, asanaProjectId: string) {
    return this.request(`/projects/${projectId}/asana/link`, {
      method: 'POST',
      body: JSON.stringify({ asana_project_id: asanaProjectId }),
    })
  }

  async syncProjectWithAsana(projectId: string) {
    return this.request<{
      tasks_synced: number
      tasks_created: number
      tasks_updated: number
      errors?: string[]
    }>(`/projects/${projectId}/asana/sync`, { method: 'POST' })
  }

  async syncTaskToAsana(taskId: string, status: string) {
    return this.request(`/tasks/${taskId}/asana/sync`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    })
  }

  // Import tasks from Asana using env PAT (quick sync)
  async importFromAsana() {
    return this.request<{
      tasks_synced: number
      tasks_created: number
      tasks_updated: number
      errors?: string[]
    }>('/asana/import', { method: 'POST' })
  }

  // Push single task to Asana
  async pushTaskToAsana(taskId: string) {
    return this.request(`/tasks/${taskId}/asana/push`, { method: 'POST' })
  }

  // Get synced sections (columns) from database
  async getProjectSections() {
    return this.request<AsanaSection[]>('/asana/sections')
  }

  // Update task section (move to different column)
  async updateTaskSection(taskId: string, sectionGid: string, sectionName: string) {
    return this.request(`/tasks/${taskId}/section`, {
      method: 'PATCH',
      body: JSON.stringify({ section_gid: sectionGid, section_name: sectionName }),
    })
  }

  // Slack endpoints
  async connectSlack(botToken: string, channelId?: string) {
    return this.request('/slack/connect', {
      method: 'POST',
      body: JSON.stringify({ bot_token: botToken, channel_id: channelId || '' }),
    })
  }

  async disconnectSlack() {
    return this.request('/slack/disconnect', {
      method: 'POST',
    })
  }

  async getSlackStatus() {
    return this.request<{
      connected: boolean
      team_id?: string
      team_name?: string
      channel_id?: string
      channel_name?: string
    }>('/slack/status')
  }

  async getSlackChannels() {
    return this.request<{
      id: string
      name: string
      is_private: boolean
      is_member: boolean
    }[]>('/slack/channels')
  }

  async setSlackChannel(channelId: string, channelName: string) {
    return this.request('/slack/channel', {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId, channel_name: channelName }),
    })
  }

  async getSlackMessages(dateRange?: { from: string; to: string }) {
    const params = new URLSearchParams()
    if (dateRange?.from) params.append('from', dateRange.from)
    if (dateRange?.to) params.append('to', dateRange.to)
    const query = params.toString() ? `?${params}` : ''
    return this.request<{ messages: SlackMessage[]; count: number }>(`/slack/messages${query}`)
  }

  async getYesterdaySlackMessages() {
    return this.request<{ messages: SlackMessage[]; count: number }>('/slack/messages/yesterday')
  }

  async analyzeSlackMessages(projectId: string) {
    return this.request<AIAnalysisResponse>(`/ai/analyze?project_id=${projectId}`, {
      method: 'POST',
    })
  }

  async analyzeManualInput(morningAssignments: string, eveningUpdates: string) {
    return this.request<{
      tasks_detected: string[]
      analysis: {
        task_title: string
        detected_status: string
        confidence: number
        evidence: string[]
      }[]
      person_breakdown: {
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
      }[]
      summary: {
        total_tasks: number
        completed: number
        in_progress: number
        blocked: number
        not_mentioned: number
      }
    }>('/ai/analyze-manual', {
      method: 'POST',
      body: JSON.stringify({ morning_assignments: morningAssignments, evening_updates: eveningUpdates }),
    })
  }

  async getDiscrepancies() {
    return this.request<{ discrepancies: Discrepancy[] }>('/ai/discrepancies')
  }

  // Daily Tasks Management endpoints
  async saveAnalysis(date: string, morningMessage: string, eveningMessage: string, analysisResult: any) {
    return this.request<{
      id: string
      date: string
      morning_message: string
      evening_message: string
      analysis_result: any
    }>('/daily-tasks/analysis', {
      method: 'POST',
      body: JSON.stringify({
        date,
        morning_message: morningMessage,
        evening_message: eveningMessage,
        analysis_result: analysisResult
      }),
    })
  }

  async getAnalysisByDate(date: string) {
    return this.request<{
      id: string
      date: string
      morning_message: string
      evening_message: string
      analysis_result: any
    }>(`/daily-tasks/analysis/${date}`)
  }

  async getTodaysTasks(date: string) {
    return this.request<{
      assignee: string
      completed: string[]
      pending: string[]
      blocked: string[]
      skipped: string[]
    }[]>(`/daily-tasks/today/${date}`)
  }

  async getNextDayTasks(date: string) {
    return this.request<{
      date: string
      assignments: {
        user_name: string
        slack_handle: string
        tasks: {
          id: string
          target_date: string
          assignee: string
          task_title: string
          priority: string
          position: number
          is_carried_forward: boolean
          source_date?: string
          notes?: string
        }[]
      }[]
    }>(`/daily-tasks/next-day/${date}`)
  }

  async generateNextDayTasks(sourceDate: string, targetDate: string) {
    return this.request<{
      date: string
      assignments: any[]
    }>('/daily-tasks/next-day/generate', {
      method: 'POST',
      body: JSON.stringify({ source_date: sourceDate, target_date: targetDate }),
    })
  }

  async createNextDayTask(targetDate: string, assignee: string, taskTitle: string, priority?: string, notes?: string) {
    return this.request<any>('/daily-tasks/next-day/task', {
      method: 'POST',
      body: JSON.stringify({
        target_date: targetDate,
        assignee,
        task_title: taskTitle,
        priority,
        notes
      }),
    })
  }

  async updateNextDayTask(taskId: string, updates: { task_title?: string; priority?: string; notes?: string }) {
    return this.request<any>(`/daily-tasks/next-day/task/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
  }

  async deleteNextDayTask(taskId: string) {
    return this.request<any>(`/daily-tasks/next-day/task/${taskId}`, {
      method: 'DELETE',
    })
  }

  async reorderNextDayTasks(targetDate: string, assignee: string, taskIds: string[]) {
    return this.request<any>('/daily-tasks/next-day/reorder', {
      method: 'PATCH',
      body: JSON.stringify({
        target_date: targetDate,
        assignee,
        task_ids: taskIds
      }),
    })
  }

  async getFormattedSlackMessage(date: string) {
    return this.request<{
      formatted_message: string
      date: string
    }>(`/daily-tasks/next-day/${date}/slack-format`)
  }

  // Calendar endpoints
  async getCalendarData(year: number, month: number) {
    return this.request<CalendarData>(`/calendar/${year}/${month}`)
  }

  // Notification endpoints
  async getNotifications() {
    return this.request<Notification[]>('/notifications')
  }

  async getUnreadCount() {
    return this.request<{ count: number }>('/notifications/unread-count')
  }

  async markNotificationRead(id: string) {
    return this.request(`/notifications/${id}/read`, { method: 'PATCH' })
  }

  async markAllNotificationsRead() {
    return this.request('/notifications/read-all', { method: 'PATCH' })
  }

  // Report endpoints
  async getTeamProductivity() {
    return this.request<TeamProductivityReport>('/reports/team-productivity')
  }

  async getIndividualReport(userId: string) {
    return this.request<IndividualReport>(`/reports/individual/${userId}`)
  }

  async getProjectHealth() {
    return this.request<ProjectHealthReport>('/reports/project-health')
  }

  // User management (admin only)
  async getUsers() {
    return this.request<User[]>('/users')
  }

  async inviteUser(email: string, role: string) {
    return this.request('/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    })
  }

  async updateUserRole(userId: string, role: string) {
    return this.request(`/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
  }

  async deleteUser(userId: string) {
    return this.request(`/users/${userId}`, { method: 'DELETE' })
  }

  // Access Control / Whitelist endpoints
  async getAccessSettings() {
    return this.request<AccessSettings>('/settings/access')
  }

  async getAllowedEmails() {
    return this.request<AllowedEmail[]>('/settings/access/emails')
  }

  async addAllowedEmail(email: string, role: string) {
    return this.request<AllowedEmail>('/settings/access/emails', {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    })
  }

  async removeAllowedEmail(email: string) {
    return this.request(`/settings/access/emails/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    })
  }

  async getAllowedDomains() {
    return this.request<AllowedDomain[]>('/settings/access/domains')
  }

  async addAllowedDomain(domain: string, role: string) {
    return this.request<AllowedDomain>('/settings/access/domains', {
      method: 'POST',
      body: JSON.stringify({ domain, role }),
    })
  }

  async removeAllowedDomain(domain: string) {
    return this.request(`/settings/access/domains/${encodeURIComponent(domain)}`, {
      method: 'DELETE',
    })
  }

  // Daily Task List endpoints
  async getDailyTaskList(date: string, projectId?: string) {
    const params = new URLSearchParams()
    if (projectId) params.append('project_id', projectId)
    const query = params.toString() ? `?${params}` : ''
    return this.request<DailyTaskList>(`/daily-tasks/${date}${query}`)
  }

  async generateDailyTaskList(date: string, projectId?: string) {
    return this.request<DailyTaskList>(`/daily-tasks/${date}/generate`, {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId || 'default' }),
    })
  }

  async getDailyTaskListFormatted(date: string, projectId?: string) {
    const params = new URLSearchParams()
    if (projectId) params.append('project_id', projectId)
    const query = params.toString() ? `?${params}` : ''
    return this.request<{ formatted_text: string; date: string }>(
      `/daily-tasks/${date}/formatted${query}`
    )
  }

  async reorderDailyTasks(date: string, assignmentId: string, taskItemIds: string[]) {
    return this.request(`/daily-tasks/${date}/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ assignment_id: assignmentId, task_item_ids: taskItemIds }),
    })
  }

  async addDailyTaskItem(assignmentId: string, title: string, priority: string, taskId?: string) {
    return this.request<DailyTaskItem>('/daily-tasks/items', {
      method: 'POST',
      body: JSON.stringify({ assignment_id: assignmentId, title, priority, task_id: taskId }),
    })
  }

  async deleteDailyTaskItem(itemId: string) {
    return this.request(`/daily-tasks/items/${itemId}`, { method: 'DELETE' })
  }

  async addDailyAssignment(date: string, userName: string, slackHandle: string, projectId?: string) {
    const params = new URLSearchParams()
    if (projectId) params.append('project_id', projectId)
    const query = params.toString() ? `?${params}` : ''
    return this.request<UserTaskAssignment>(`/daily-tasks/${date}/assignments${query}`, {
      method: 'POST',
      body: JSON.stringify({ user_name: userName, slack_handle: slackHandle }),
    })
  }

  async deleteDailyAssignment(assignmentId: string) {
    return this.request(`/daily-tasks/assignments/${assignmentId}`, { method: 'DELETE' })
  }

  // Integration Settings endpoints

  // Get Asana configuration status (all authenticated users)
  async getAsanaConfigStatus() {
    return this.request<{ configured: boolean; has_project: boolean }>('/settings/integrations/asana/status')
  }

  // Get full Asana settings (admin only)
  async getAsanaSettings() {
    return this.request<AsanaSettings>('/settings/integrations/asana')
  }

  async updateAsanaSettings(settings: UpdateAsanaSettingsRequest) {
    return this.request('/settings/integrations/asana', {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  }

  async testAsanaConnection() {
    return this.request<{
      connected: boolean
      user: string
      projects: AsanaProject[]
    }>('/settings/integrations/asana/test', { method: 'POST' })
  }

  async getAsanaProjectsForSettings() {
    return this.request<AsanaProject[]>('/settings/integrations/asana/projects')
  }

  // Bot Config endpoints
  async listBots() {
    return this.request<BotConfig[]>('/bots')
  }

  async getBot(botId: string) {
    return this.request<BotConfig>(`/bots/${botId}`)
  }

  async createBot(bot: CreateBotConfigRequest) {
    return this.request<BotConfig>('/bots', {
      method: 'POST',
      body: JSON.stringify(bot),
    })
  }

  async updateBot(botId: string, updates: UpdateBotConfigRequest) {
    return this.request<BotConfig>(`/bots/${botId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
  }

  async deleteBot(botId: string) {
    return this.request(`/bots/${botId}`, { method: 'DELETE' })
  }

  async getBotTemplates() {
    return this.request<BotConfig[]>('/bots/templates')
  }
}

// Types
export interface User {
  id: string
  email: string
  name: string
  picture?: string
  role: 'admin' | 'project_manager' | 'member' | 'viewer'
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high'
  project_id: string
  assignee_id?: string
  assignee?: {
    id: string
    name: string
    email: string
    picture?: string
  }
  asana_id?: string
  asana_url?: string
  asana_section_gid?: string
  section_name?: string
  due_date?: string
  created_at?: string
  updated_at?: string
  created_by?: string
}

export interface AsanaProject {
  gid: string
  name: string
}

export interface AsanaSection {
  gid: string
  name: string
  position: number
  color?: string
}

export interface SlackMessage {
  user: string
  text: string
  timestamp: string
}

export interface SlackAnalysis {
  analysis: Array<{
    task: string
    status: string
    confidence: number
  }>
}

export interface TaskStatusAnalysis {
  task_title: string
  detected_status: string
  confidence: number
  evidence: string[]
  message_ids: string[]
}

export interface Discrepancy {
  task_title: string
  slack_status: string
  asana_status: string
  confidence: number
  message_ids: string[]
}

export interface AIAnalysisResponse {
  analysis: TaskStatusAnalysis[]
  discrepancies: Discrepancy[]
  summary: {
    tasks_analyzed: number
    messages_read: number
    discrepancies: number
  }
}

export interface DailyTaskItem {
  id: string
  assignment_id: string
  task_id?: string
  title: string
  priority: 'high' | 'medium' | 'low'
  position: number
  carried_over: boolean
  created_at?: string
}

export interface UserTaskAssignment {
  id: string
  daily_list_id: string
  user_id?: string
  user_name: string
  slack_handle: string
  position: number
  tasks: DailyTaskItem[]
  created_at?: string
}

export interface DailyTaskList {
  id: string
  date: string
  project_id: string
  assignments: UserTaskAssignment[]
  created_at?: string
  updated_at?: string
}

export interface CalendarData {
  year: string
  month: string
  days: Record<string, { status: string; count: string }>
}

export interface Notification {
  id: string
  type: string
  message: string
  read: boolean
  time: string
}

export interface TeamProductivityReport {
  period: string
  tasks_completed: number
  tasks_created: number
  completion_rate: number
  daily_data: Array<{ date: string; completed: number }>
}

export interface IndividualReport {
  user_id: string
  tasks_completed: number
  tasks_assigned: number
  completion_rate: number
}

export interface ProjectHealthReport {
  overdue_tasks: number
  blocked_tasks: number
  on_track_tasks: number
  health_score: number
}

export interface AllowedEmail {
  email: string
  role: 'admin' | 'project_manager' | 'member' | 'viewer'
  is_default: boolean
  added_at?: string
}

export interface AllowedDomain {
  domain: string
  role: 'admin' | 'project_manager' | 'member' | 'viewer'
  added_at?: string
}

export interface AccessSettings {
  default_admin_email: string
  allowed_emails: AllowedEmail[]
  allowed_domains: AllowedDomain[]
}

export interface AsanaSettings {
  pat: string  // Masked PAT (e.g., "****xxxx")
  project_id: string
  workspace_id: string
  configured: boolean
}

export interface UpdateAsanaSettingsRequest {
  pat?: string
  project_id?: string
  workspace_id?: string
}

// Bot Config Types
export interface BotVariable {
  name: string
  label: string
  type: 'text' | 'select' | 'date' | 'team_member'
  default: string
  options?: string[]
  required: boolean
  description?: string
}

export interface BotConfig {
  id: string
  name: string
  description: string
  bot_type: 'slack_analysis' | 'daily_report' | 'custom'
  prompt: string
  variables: string // JSON string of BotVariable[]
  is_active: boolean
  created_by?: string
  created_at?: string
  updated_at?: string
}

export interface CreateBotConfigRequest {
  name: string
  description: string
  bot_type: string
  prompt: string
  variables: string
}

export interface UpdateBotConfigRequest {
  name?: string
  description?: string
  prompt?: string
  variables?: string
  is_active?: boolean
}

// Export singleton instance
export const api = new ApiService()
export default api
