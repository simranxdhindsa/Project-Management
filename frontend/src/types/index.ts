// Task Types
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export interface Assignee {
  id: string
  name: string
  email: string
  picture?: string
}

export interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  project_id?: string
  assignee_id?: string
  assignee?: Assignee
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

export interface CreateTaskRequest {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  project_id: string
  assignee_id?: string
  due_date?: string
}

export interface UpdateTaskRequest {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  assignee_id?: string
  due_date?: string
}

// Project Types
export interface Project {
  id: string
  name: string
  description?: string
  owner_id: string
  asana_project_id?: string
  created_at: string
  updated_at: string
}

export interface ProjectMember {
  project_id: string
  user_id: string
  role: UserRole
  joined_at: string
  user_name?: string
  user_email?: string
  user_picture?: string
}

// User Types
export type UserRole = 'admin' | 'project_manager' | 'member' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
  picture?: string
  role: UserRole
  created_at?: string
}

// Notification Types
export type NotificationType =
  | 'task_assigned'
  | 'task_updated'
  | 'task_completed'
  | 'task_overdue'
  | 'mention'
  | 'system'

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  message: string
  task_id?: string
  read: boolean
  created_at: string
}

// Calendar Types
export interface CalendarDay {
  date: string
  status: 'green' | 'yellow' | 'red' | 'none'
  task_count: number
  completed_count: number
  overdue_count: number
  in_progress_count: number
}

export interface CalendarMonth {
  year: number
  month: number
  days: CalendarDay[]
}

// Integration Types
export interface AsanaIntegration {
  connected: boolean
  workspace_id?: string
  workspace_name?: string
  last_sync_at?: string
}

export interface SlackIntegration {
  connected: boolean
  team_id?: string
  team_name?: string
  channel_id?: string
  channel_name?: string
}

export interface AsanaProject {
  gid: string
  name: string
}

// Asana Section (column) type
export interface AsanaSection {
  gid: string
  name: string
  position: number
  color?: string
}

export interface SlackChannel {
  id: string
  name: string
}

// Report Types
export interface TeamProductivityReport {
  period: string
  tasks_completed: number
  tasks_created: number
  completion_rate: number
  daily_data: {
    date: string
    completed: number
    created: number
  }[]
}

export interface ProjectHealthReport {
  overdue_tasks: number
  blocked_tasks: number
  on_track_tasks: number
  health_score: number
}

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  total: number
  page: number
  limit: number
}

// Daily Task List Types
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

// Slack Analysis Types
export interface SlackMessage {
  id: string
  channel_id: string
  user_id: string
  user_name: string
  text: string
  timestamp: string
}

export interface SlackAnalysisResult {
  id: string
  task_id?: string
  task_title: string
  slack_status: string
  asana_status?: string
  confidence: number
  message_ids: string[]
  discrepancy: boolean
  analyzed_at: string
}
