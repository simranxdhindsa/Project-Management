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

    const text = await response.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      if (!response.ok) {
        throw new Error(text || `Request failed with status ${response.status}`)
      }
      throw new Error('Invalid JSON response from server')
    }

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

  // YouTrack endpoints
  async getYouTrackStatus() {
    return this.request<{
      connected: boolean
      configured: boolean
      error?: string
    }>('/youtrack/status')
  }

  async testYouTrackConnection(baseUrl: string, token: string, projectId: string) {
    return this.request<{ success: boolean; error?: string }>('/youtrack/test', {
      method: 'POST',
      body: JSON.stringify({ base_url: baseUrl, token, project_id: projectId }),
    })
  }

  async getYouTrackProjects() {
    return this.request<YouTrackProject[]>('/youtrack/projects')
  }

  async getYouTrackBoards() {
    return this.request<YouTrackBoard[]>('/youtrack/boards')
  }

  async getYouTrackBoardColumns(boardId: string) {
    return this.request<YouTrackColumn[]>(`/youtrack/boards/${boardId}/columns`)
  }

  async getYouTrackStates() {
    return this.request<YouTrackState[]>('/youtrack/states')
  }

  async getYouTrackUsers() {
    return this.request<YouTrackUser[]>('/youtrack/users')
  }

  async getYouTrackIssues() {
    return this.request<YouTrackIssue[]>('/youtrack/issues')
  }

  async getYouTrackIssue(issueId: string) {
    return this.request<YouTrackIssue>(`/youtrack/issues/${issueId}`)
  }

  async createYouTrackIssue(params: {
    summary: string
    description?: string
    state?: string
    priority?: string
    assignee_login?: string
    subsystem?: string
    due_date?: number        // Unix ms timestamp
    estimation_minutes?: number
  }) {
    return this.request<YouTrackIssue>('/youtrack/issues', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async updateYouTrackIssue(issueId: string, summary?: string, description?: string, state?: string) {
    return this.request<YouTrackIssue>(`/youtrack/issues/${issueId}`, {
      method: 'PUT',
      body: JSON.stringify({ summary, description, state }),
    })
  }

  async updateYouTrackIssueState(issueId: string, state: string) {
    return this.request(`/youtrack/issues/${issueId}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    })
  }

  async deleteYouTrackIssue(issueId: string) {
    return this.request(`/youtrack/issues/${issueId}`, { method: 'DELETE' })
  }

  async importFromYouTrack() {
    return this.request<{
      tasks_synced: number
      tasks_created: number
      tasks_updated: number
      errors?: string[]
    }>('/youtrack/import', { method: 'POST' })
  }

  async syncTaskToYouTrack(taskId: string) {
    return this.request(`/tasks/${taskId}/youtrack/sync`, { method: 'POST' })
  }

  async getYouTrackSections() {
    return this.request<YouTrackState[]>('/youtrack/sections')
  }

  async matchAnalysisWithYouTrack(personBreakdown: any[], analysis: any[]) {
    return this.request<{
      matches: {
        task_title: string
        person: string
        status: string
        youtrack_issue: { id: string; summary: string; current_state: string }
        proposed_state: string
        confidence: number
      }[]
      unmatched_tasks: { task_title: string; person: string; status: string }[]
      unmatched_issues: { id: string; summary: string; current_state: string }[]
    }>('/youtrack/match-analysis', {
      method: 'POST',
      body: JSON.stringify({ person_breakdown: personBreakdown, analysis }),
    })
  }

  async bulkUpdateYouTrackStates(updates: { issue_id: string; new_state: string }[]) {
    return this.request<{
      succeeded: number
      failed: number
      errors: string[]
      message: string
    }>('/youtrack/bulk-update-states', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    })
  }

  async getYouTrackIssuesGroupedByAssignee() {
    return this.request<{
      assignments: {
        user_name: string
        slack_handle: string
        issues: {
          id: string
          summary: string
          priority_tag: string
          clean_title: string
          status: string
          selected: boolean
        }[]
      }[]
    }>('/youtrack/issues/grouped-by-assignee')
  }

  async getSyncRecommendations(personBreakdown: any[], analysis: any[]) {
    return this.request<{
      recommendations: {
        issue_id: string
        summary: string
        person: string
        current_state: string
        proposed_state: string
        reason: string
        backward: boolean
        confidence: number
      }[]
    }>('/youtrack/sync-recommendations', {
      method: 'POST',
      body: JSON.stringify({ person_breakdown: personBreakdown, analysis }),
    })
  }

  async bulkCreateNextDayTasks(targetDate: string, tasks: { assignee: string; task_title: string; priority?: string; youtrack_id?: string }[]) {
    return this.request<{
      date: string
      assignments: any[]
    }>('/daily-tasks/next-day/bulk-create', {
      method: 'POST',
      body: JSON.stringify({ target_date: targetDate, tasks }),
    })
  }

  // PM Assistant
  async pmAssistantQuery(query: string, history: { role: string; content: string }[] = []) {
    return this.request<{ response: string }>('/youtrack/pm-query', {
      method: 'POST',
      body: JSON.stringify({ query, history }),
    })
  }

  // Daily Ops endpoints
  async getDailyBrief() {
    return this.request<DailyBrief>('/youtrack/daily-brief')
  }

  async getEODSummary() {
    return this.request<EODSummary>('/youtrack/eod-summary')
  }

  async getDeveloperLoad() {
    return this.request<DeveloperLoad[]>('/youtrack/developer-load')
  }

  async postMorningReport(reportText: string, channelIds: string[]) {
    return this.request<{ posted_channels: string[]; errors: string[] }>('/slack/post-morning-report', {
      method: 'POST',
      body: JSON.stringify({ report_text: reportText, channel_ids: channelIds }),
    })
  }

  async generateEODPlan(summary: EODSummary) {
    return this.request<{ plan_text: string }>('/ai/eod-plan', {
      method: 'POST',
      body: JSON.stringify(summary),
    })
  }

  async getBlockerReasons(issueIds: string[]) {
    return this.request<Record<string, string>>(`/youtrack/blocker-reasons?ids=${issueIds.join(',')}`)
  }

  async saveCarryoverPlan(items: CarryoverItem[]) {
    return this.request<{ success: boolean }>('/youtrack/save-plan', {
      method: 'POST',
      body: JSON.stringify({ items }),
    })
  }

  async getCarryover() {
    return this.request<CarryoverData>('/youtrack/carryover')
  }

  async createIssueReminder(issueId: string, issueSummary: string, targetDate: string) {
    return this.request<{ id: string }>('/reminders', {
      method: 'POST',
      body: JSON.stringify({
        type: 'blocked_issue',
        title: `Follow up: ${issueSummary}`,
        related_issue_id: issueId,
        target_date: targetDate,
        recurring: 'none',
      }),
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

  async setSlackMonitorChannel(channelId: string, channelName: string) {
    return this.request('/slack/monitor-channel', {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId, channel_name: channelName }),
    })
  }

  // Slack Intelligence endpoints
  async scanSlack() {
    return this.request<{ success: boolean; new_mentions: number; new_threads: number }>('/slack/scan', {
      method: 'POST',
    })
  }

  async getSlackMentions() {
    return this.request<{ success: boolean; mentions: SlackMention[]; count: number; unreplied_count: number }>('/slack/mentions')
  }

  async dismissSlackMention(messageTS: string) {
    return this.request(`/slack/mentions/${encodeURIComponent(messageTS)}/dismiss`, {
      method: 'POST',
    })
  }

  async snoozeSlackMention(messageTS: string, until: '2h' | 'tomorrow') {
    return this.request(`/slack/mentions/${encodeURIComponent(messageTS)}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ until }),
    })
  }

  async snoozeSlackThread(threadTS: string, until: '2h' | 'tomorrow') {
    return this.request(`/slack/threads/${encodeURIComponent(threadTS)}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ until }),
    })
  }

  async getSlackThreads() {
    return this.request<{ success: boolean; threads: SlackThread[]; count: number }>('/slack/threads')
  }

  async postSlackDigest(issues: DigestIssue[]) {
    return this.request<{ success: boolean; thread_ts: string; message: string }>('/slack/digest', {
      method: 'POST',
      body: JSON.stringify({ issues }),
    })
  }

  async createSlackFollowupReminder(params: SlackReminderParams) {
    return this.request<{ success: boolean; reminder: ReminderItem }>('/slack/reminders', {
      method: 'POST',
      body: JSON.stringify(params),
    })
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

  // Notification endpoints
  async getNotifications(limit?: number) {
    const query = limit ? `?limit=${limit}` : ''
    return this.request<NotificationItem[]>(`/notifications${query}`)
  }

  async getUnreadNotificationCount() {
    return this.request<{ count: number }>('/notifications/unread-count')
  }

  async markNotificationAsRead(notifId: string) {
    return this.request(`/notifications/${notifId}/read`, { method: 'PATCH' })
  }

  async markAllNotificationsAsRead() {
    return this.request('/notifications/read-all', { method: 'PATCH' })
  }

  async deleteNotification(notifId: string) {
    return this.request(`/notifications/${notifId}`, { method: 'DELETE' })
  }

  // Reminder endpoints
  async getReminders() {
    return this.request<ReminderItem[]>('/reminders')
  }

  async createReminder(reminder: CreateReminderRequest) {
    return this.request<ReminderItem>('/reminders', {
      method: 'POST',
      body: JSON.stringify(reminder),
    })
  }

  async dismissReminder(reminderId: string) {
    return this.request(`/reminders/${reminderId}/dismiss`, { method: 'PATCH' })
  }

  async deleteReminder(reminderId: string) {
    return this.request(`/reminders/${reminderId}`, { method: 'DELETE' })
  }

  // PM Report endpoints
  async generatePMReport(date: string, scope: 'full' | 'summary' = 'full') {
    return this.request<PMReport>(`/reports/pm-report/${date}?scope=${scope}`)
  }

  async getSavedPMReport(date: string) {
    return this.request<PMReport>(`/reports/pm-report/${date}/saved`)
  }

  async listPMReports() {
    return this.request<PMReport[]>('/reports/pm-reports')
  }

  async deletePMReport(id: string) {
    return this.request<{ message: string }>(`/reports/pm-report/${id}/delete`, { method: 'DELETE' })
  }

  async generateWeeklyPMReport(weekStart: string, scope: 'full' | 'summary' = 'full') {
    return this.request<PMReport>(`/reports/pm-report/weekly/${weekStart}?scope=${scope}`)
  }

  async listWeeklyPMReports() {
    return this.request<PMReport[]>('/reports/pm-reports/weekly')
  }

  async getAssigneeStats() {
    return this.request<AssigneeStat[]>('/reports/assignee-stats')
  }

  async getTimeTracking(params?: { week?: string; assignee?: string; priority?: string }) {
    const qs = new URLSearchParams()
    if (params?.week) qs.set('week', params.week)
    if (params?.assignee) qs.set('assignee', params.assignee)
    if (params?.priority) qs.set('priority', params.priority)
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return this.request<TimeTrackingRow[]>(`/reports/time-tracking${query}`)
  }

  async pinIssue(issueID: string) {
    return this.request<void>('/reports/pins', { method: 'POST', body: JSON.stringify({ issue_id: issueID }) })
  }

  async unpinIssue(issueID: string) {
    return this.request<void>(`/reports/pins/${encodeURIComponent(issueID)}`, { method: 'DELETE' })
  }

  async getPinnedIssues() {
    return this.request<string[]>('/reports/pins')
  }

  async getIssueTimelines() {
    return this.request<IssueTimeline[]>('/reports/issue-timelines')
  }

  async dismissAlert(issueID: string) {
    return this.request<void>('/reports/alerts/dismiss', {
      method: 'POST',
      body: JSON.stringify({ issue_id: issueID }),
    })
  }

  async undismissAlert(issueID: string) {
    return this.request<void>(`/reports/alerts/dismiss/${encodeURIComponent(issueID)}`, { method: 'DELETE' })
  }

  async backfillStateLog() {
    return this.request<{ inserted: number; skipped: number; total: number }>('/reports/backfill', {
      method: 'POST',
    })
  }

  async resetStateLog() {
    return this.request<{ deleted: number }>('/reports/reset-state-log', {
      method: 'DELETE',
    })
  }

  async reconcileStateLog() {
    return this.request<{ reconciled: number; skipped: number; checked: number }>('/reports/reconcile', {
      method: 'POST',
    })
  }

  async importHistory() {
    return this.request<{ inserted: number; skipped: number; errors: number; issues: number }>('/reports/import-history', {
      method: 'POST',
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
  asana_section_gid?: string
  youtrack_id?: string
  youtrack_url?: string
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

// YouTrack Types
export interface YouTrackProject {
  id: string
  name: string
  shortName: string
  archived?: boolean
}

export interface YouTrackBoard {
  id: string
  name: string
}

export interface YouTrackColumn {
  name: string
  fieldValues: string[]
}

export interface YouTrackState {
  name: string
}

export interface YouTrackUser {
  id: string
  login: string
  fullName: string
  email?: string
  avatarUrl?: string
}

export interface YouTrackIssue {
  id: string
  summary: string
  description: string
  status: string
  subsystem?: string
  priority: string
  assignee?: YouTrackUser
  created: number
  updated: number
  attachments?: YouTrackAttachment[]
}

export interface YouTrackAttachment {
  id: string
  name: string
  size: number
  mimeType: string
  url: string
  extension: string
}

export interface YouTrackSettings {
  base_url: string
  token?: string
  project_id: string
  board_id?: string
  configured: boolean
}

export interface UpdateYouTrackSettingsRequest {
  base_url?: string
  token?: string
  project_id?: string
  board_id?: string
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

export interface SlackMention {
  id: string
  user_id: string
  slack_user_id: string
  message_ts: string
  thread_ts?: string
  channel_id: string
  message_text: string
  sender_name: string
  requires_reply: boolean
  replied: boolean
  reply_checked_at?: string
  snoozed_until?: string
  created_at: string
}

export interface SlackThread {
  id: string
  user_id: string
  channel_id: string
  thread_ts: string
  message_text: string
  reply_count: number
  last_checked_at?: string
  has_reply: boolean
  reminder_sent: boolean
  snoozed_until?: string
  created_at: string
}

export interface DigestIssue {
  id: string
  summary: string
  assignee: string
  status: string
  priority: string
}

export interface SlackReminderParams {
  thread_ts: string
  channel_id: string
  message_text: string
  follow_up_date?: string
  note?: string
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

export interface NotificationItem {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  task_id?: string
  read: boolean
  created_at: string
}

export interface ReminderItem {
  id: string
  user_id: string
  type: string
  title: string
  message?: string
  target_date: string
  target_time?: string
  related_task_id?: string
  related_issue_id?: string
  recurring: string
  status: string
  created_at: string
}

export interface CreateReminderRequest {
  type?: string
  title: string
  message?: string
  target_date: string
  target_time?: string
  related_task_id?: string
  related_issue_id?: string
  recurring?: string
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
  bot_type: 'slack_analysis' | 'daily_report' | 'custom' | 'pm_assistant'
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

export interface PMReport {
  id: string
  date: string
  report_type?: 'daily' | 'weekly'
  report_text: string
  done_count: number
  open_count: number
  blocked_count: number
  generated_at: string
  updated_at: string
  saved?: boolean
}

export interface PMReportSummary {
  id: string
  date: string
  done_count: number
  open_count: number
  blocked_count: number
  generated_at: string
}

export interface AssigneeStat {
  assignee: string
  open: number
  in_progress: number
  done: number
  blocked: number
  avg_hours_in_progress: number | null
  issues?: string[]
}

export interface IssueStint {
  stint_number: number
  entered_at: string
  exited_at: string | null
  exited_to: string
  duration_hours: number | null
  moved_back: boolean
  moved_by: string
  comment: string
}

export interface IssueTimeline {
  issue_id: string
  issue_summary: string
  assignee: string
  priority: string
  pinned: boolean
  total_stints: number
  total_hours: number
  is_live: boolean
  live_hours: number
  moved_back_count: number
  is_overdue: boolean
  threshold_hours: number
  first_entered_at: string
  last_activity_at: string
  stints: IssueStint[]
  alert_dismissed: boolean
}

export interface TimeTrackingRow {
  id: string
  issue_id: string
  issue_summary: string
  assignee: string
  moved_by: string
  moved_by_mismatch: boolean
  from_state: string
  to_state: string
  priority: string
  transitioned_at: string
  duration_in_prev_state_hours: number | null
  comment: string
  overdue: boolean
  threshold_hours: number
  pinned: boolean
}

// Export singleton instance
export const api = new ApiService()
export default api

// ── YouTrack avatar cache ─────────────────────────────────────────────────
// Maps fullName → absolute avatarUrl. Fetched once per session, reused everywhere.
let _ytAvatarCache: Record<string, string> | null = null
let _ytAvatarPromise: Promise<Record<string, string>> | null = null

export async function getYouTrackAvatarMap(): Promise<Record<string, string>> {
  if (_ytAvatarCache) return _ytAvatarCache
  if (_ytAvatarPromise) return _ytAvatarPromise
  _ytAvatarPromise = api.getYouTrackUsers().then(res => {
    const map: Record<string, string> = {}
    // getYouTrackUsers returns the raw response — handle both array and {data:[]} shapes
    const users: YouTrackUser[] = Array.isArray(res)
      ? res
      : ((res as unknown as { data?: YouTrackUser[] }).data ?? [])
    for (const u of users) {
      if (u.fullName && u.avatarUrl) {
        // YouTrack Cloud returns absolute URLs (https://xxx.youtrack.cloud/hub/...)
        map[u.fullName] = u.avatarUrl
      }
    }
    _ytAvatarCache = map
    return map
  }).catch(() => {
    _ytAvatarCache = {}
    return {}
  })
  return _ytAvatarPromise
}

// Daily Ops interfaces
export interface DailyOpsIssue {
  id: string
  summary: string
  status: string
  priority: string
  assignee: string
  blocker_reason?: string
}

export interface DailyBrief {
  done_yesterday: DailyOpsIssue[]
  p0: DailyOpsIssue[]
  p1: DailyOpsIssue[]
  p2: DailyOpsIssue[]
  p3: DailyOpsIssue[]
  blocked_ours: DailyOpsIssue[]
  blocked_theirs: DailyOpsIssue[]
  open_items: DailyOpsIssue[]
  unassigned: DailyOpsIssue[]
  generated_at: string
}

export interface EODSummary {
  completed_today: DailyOpsIssue[]
  still_in_progress: DailyOpsIssue[]
  no_movement: DailyOpsIssue[]
  new_blockers: DailyOpsIssue[]
  date: string
}

export interface DeveloperLoad {
  assignee: string
  active_issues: DailyOpsIssue[]
  blocked_issues: DailyOpsIssue[]
  done_today: number
  avg_hours_per_p1: number
  avg_hours_per_p2: number
  last_activity_at: string | null
  missing_update: boolean
  overloaded: boolean
}

export interface CarryoverItem {
  text: string
  done: boolean
}

export interface CarryoverData {
  yesterday: CarryoverItem[]
  today: CarryoverItem[]
  yesterday_date: string
  today_date: string
}
