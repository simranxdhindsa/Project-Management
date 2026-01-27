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
  async googleAuth(credential: string) {
    return this.request<{ user: User; token: string }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
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
  async connectAsana(token: string) {
    return this.request('/asana/connect', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  async getAsanaProjects() {
    return this.request<AsanaProject[]>('/asana/projects')
  }

  async syncAsana() {
    return this.request('/asana/sync', { method: 'POST' })
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

  async analyzeSlackMessages() {
    return this.request<SlackAnalysis>('/slack/analyze', { method: 'POST' })
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
  assignee?: string
  asana_id?: string
  asana_url?: string
  due_date?: string
  created_at?: string
  updated_at?: string
}

export interface AsanaProject {
  id: string
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

// Export singleton instance
export const api = new ApiService()
export default api
