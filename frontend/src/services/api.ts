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

  // Slack endpoints
  async connectSlack(botToken: string) {
    return this.request('/slack/connect', {
      method: 'POST',
      body: JSON.stringify({ botToken }),
    })
  }

  async getSlackMessages(dateRange?: { from: string; to: string }) {
    const params = new URLSearchParams()
    if (dateRange?.from) params.append('from', dateRange.from)
    if (dateRange?.to) params.append('to', dateRange.to)
    const query = params.toString() ? `?${params}` : ''
    return this.request<SlackMessage[]>(`/slack/messages${query}`)
  }

  async analyzeSlackMessages(projectId: string) {
    return this.request<AIAnalysisResponse>(`/ai/analyze?project_id=${projectId}`, {
      method: 'POST',
    })
  }

  async getDiscrepancies() {
    return this.request<{ discrepancies: Discrepancy[] }>('/ai/discrepancies')
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
  due_date?: string
  created_at?: string
  updated_at?: string
  created_by?: string
}

export interface AsanaProject {
  gid: string
  name: string
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

// Export singleton instance
export const api = new ApiService()
export default api
