import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/services/api'
import { ConfirmModal } from '@/components/ConfirmModal'
import CreateIssueModal from '@/components/CreateIssueModal'
import { useYouTrackEvents } from '@/services/useYouTrackEvents'
import {
  LayoutDashboard,
  KanbanSquare,
  List,
  Calendar,
  Bot,
  Bell,
  BarChart3,
  Settings,
  Users,
  Search,
  Plus,
  ChevronRight,
  LogOut,
  Link2,
  Brain,
  CheckCircle,
  AlertCircle,
  Clock,
  Code2,
  Archive,
  RefreshCw,
  User,
  AlertTriangle,
  X,
  MessageSquare,
  Sparkles,
  Maximize2,
  Minimize2,
  Activity,
  Zap,
} from 'lucide-react'
import { PMAssistantTab } from './PMReportsPage'
import { IntegrationsPage } from './IntegrationsPage'
import { SettingsPage } from './SettingsPage'
import { BoardPage } from './BoardPage'
import { DailyOpsPage } from './DailyOpsTab'
import { DailyAnalysisViewPage } from './DailyAnalysisViewPage'
import { BotConfigPage } from './BotConfigPage'
import { AIAnalysisPage } from './AIAnalysisPage'
import { PMReportsPage } from './PMReportsPage'
import { ListViewPage } from './ListViewPage'
import { SlackIntelligencePage } from './SlackIntelligencePage'
import { ActivityPage } from './ActivityPage'
import { DayTrackPage } from './DayTrackPage'
import { JellySwitch } from '../components/JellySwitch'
import { RightPanel } from '../components/notifications/RightPanel'
import type { LocalNotification } from '../components/notifications/RightPanel'

type Page = 'dashboard' | 'board' | 'list' | 'daily-ops' | 'daily-analysis' | 'calendar' | 'reports' | 'ai-analysis' | 'pm-reports' | 'bots' | 'team' | 'settings' | 'integrations' | 'slack' | 'activity' | 'daytrack'

// Pages accessible by members/viewers (limited access)
const MEMBER_PAGES: Page[] = ['dashboard', 'board', 'list', 'daily-ops', 'activity', 'calendar', 'ai-analysis', 'daily-analysis', 'pm-reports', 'daytrack']

// YouTrack issue with extracted fields
interface YTIssue {
  id: string
  summary: string
  description: string
  status: string
  priority: string
  assignee?: { id: string; login: string; fullName: string; email?: string }
}

// Column config for the 3 dashboard columns
const DASHBOARD_COLUMNS = [
  { id: 'backlog', label: 'Backlog', ytState: 'Open' },
  { id: 'in_progress', label: 'In Progress', ytState: 'In Progress' },
  { id: 'dev', label: 'DEV', ytState: 'DEV' },
] as const

const COLUMN_ORDER: Record<string, number> = {
  backlog: 0,
  in_progress: 1,
  dev: 2,
}

type DashboardNotification = LocalNotification

// Droppable column wrapper
function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className="kanban-column"
      style={{
        outline: isOver ? '2px solid #8250df' : 'none',
        outlineOffset: '-2px',
        borderRadius: '12px',
        transition: 'outline 0.15s ease',
      }}
    >
      {children}
    </div>
  )
}

// Draggable card wrapper
function DraggableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        opacity: isDragging ? 0.4 : 1,
        cursor: 'grab',
        touchAction: 'none',
      }}
    >
      {children}
    </div>
  )
}

// Map URL path segments to Page values
const PATH_TO_PAGE: Record<string, Page> = {
  '': 'dashboard',
  'dashboard': 'dashboard',
  'board': 'board',
  'list': 'list',
  'daily-ops': 'daily-ops',
  'daily-analysis': 'daily-analysis',
  'calendar': 'calendar',
  'reports': 'reports',
  'ai-analysis': 'ai-analysis',
  'pm-reports': 'pm-reports',
  'bots': 'bots',
  'team': 'team',
  'settings': 'settings',
  'integrations': 'integrations',
  'slack': 'slack',
  'activity': 'activity',
  'daytrack': 'daytrack',
}

const PM_REPORTS_TABS = ['tracking', 'daily', 'assignees', 'dailyops', 'deployment'] as const
type PMReportsTab = typeof PM_REPORTS_TABS[number]

const SLACK_TABS = ['inbox', 'threads', 'reminders', 'settings'] as const
type SlackTab = typeof SLACK_TABS[number]

const INTEGRATIONS_TABS = ['youtrack', 'slack', 'workflow'] as const
type IntegrationsTab = typeof INTEGRATIONS_TABS[number]

export default function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Derive current page from URL path
  const pathSegments = location.pathname.replace(/^\//, '').split('/')
  const currentPage: Page = PATH_TO_PAGE[pathSegments[0]] ?? 'dashboard'
  const subTab: string | undefined = pathSegments[1]

  // Derived sub-tab for pm-reports (with validation)
  const pmReportsTab: PMReportsTab = (PM_REPORTS_TABS as readonly string[]).includes(subTab ?? '')
    ? (subTab as PMReportsTab)
    : 'tracking'

  // Derived sub-tab for slack (with validation)
  const slackTab: SlackTab = (SLACK_TABS as readonly string[]).includes(subTab ?? '')
    ? (subTab as SlackTab)
    : 'inbox'

  // Derived sub-tab for integrations (with validation)
  const integrationsTab: IntegrationsTab = (INTEGRATIONS_TABS as readonly string[]).includes(subTab ?? '')
    ? (subTab as IntegrationsTab)
    : 'youtrack'

  // Navigate wrapper — updates URL and syncs page state
  const setCurrentPage = (page: Page) => {
    navigate(`/${page}`)
  }

  const [showNotifications, setShowNotifications] = useState(false)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') !== 'light'
  })

  useEffect(() => {
    const theme = darkMode ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [darkMode])

  useEffect(() => {
    const PAGE_TITLES: Record<Page, string> = {
      'dashboard':      'Dashboard',
      'board':          'Board View',
      'list':           'List View',
      'daily-ops':      'DailyOps',
      'daily-analysis': 'Daily Analysis',
      'calendar':       'Calendar',
      'reports':        'Reports',
      'ai-analysis':    'AI Analysis',
      'pm-reports':     'PM Reports',
      'bots':           'Bot Config',
      'team':           'Team',
      'settings':       'Settings',
      'integrations':   'Integrations',
      'reminders':      'Reminders',
      'slack':          'Slack Intelligence',
      'activity':       'Activity',
    }
    document.title = `${PAGE_TITLES[currentPage]} — Trackflow`
  }, [currentPage])

  // YouTrack state
  const [ytIssues, setYtIssues] = useState<YTIssue[]>([])
  const [ytLoading, setYtLoading] = useState(true)
  const [ytConnected, setYtConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [activeIssue, setActiveIssue] = useState<YTIssue | null>(null)
  const [dashboardView, setDashboardView] = useState<'board' | 'assignees'>('board')

  // New task modal state
  const [showNewTask, setShowNewTask] = useState(false)


  // Role-based access
  const isFullAccess = user?.role === 'admin' || user?.role === 'project_manager'
  const [showMyTasks, setShowMyTasks] = useState(!isFullAccess)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  // Notification state — persist to sessionStorage
  const [notifications, setNotifications] = useState<DashboardNotification[]>(() => {
    try {
      const saved = sessionStorage.getItem('pm_notifications')
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.map((n: DashboardNotification) => ({ ...n, timestamp: new Date(n.timestamp) }))
      }
    } catch { /* ignore */ }
    return []
  })
  const [toast, setToast] = useState<{ message: string; type: 'warning' | 'info' } | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatFullscreen, setChatFullscreen] = useState(false)
  const chatPanelRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionStorage.setItem('pm_notifications', JSON.stringify(notifications))
  }, [notifications])

  // Close notification panel on outside click
  useEffect(() => {
    if (!showNotifications) return
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNotifications])

  // Guard: redirect members to allowed pages
  useEffect(() => {
    if (!isFullAccess && !MEMBER_PAGES.includes(currentPage)) {
      navigate('/dashboard', { replace: true })
    }
  }, [currentPage, isFullAccess, navigate])

  const unreadCount = notifications.filter(n => !n.read).length

  const addNotification = (notif: Omit<DashboardNotification, 'id' | 'timestamp' | 'read'>) => {
    setNotifications(prev => [{
      ...notif,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date(),
      read: false,
    }, ...prev])
  }

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  const handleMoveToBlocked = async (notif: DashboardNotification) => {
    try {
      await api.bulkUpdateYouTrackStates([{ issue_id: notif.issueId, new_state: 'Blocked' }])
      setYtIssues(prev => prev.map(i =>
        i.id === notif.issueId ? { ...i, status: 'Blocked' } : i
      ))
      dismissNotification(notif.id)
      setToast({ message: `${notif.issueId} moved to Blocked`, type: 'info' })
      setTimeout(() => setToast(null), 3000)
    } catch {
      setToast({ message: `Failed to move ${notif.issueId} to Blocked`, type: 'warning' })
      setTimeout(() => setToast(null), 3000)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const issue = ytIssues.find(i => i.id === event.active.id)
    if (issue) setActiveIssue(issue)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveIssue(null)
    const { active, over } = event
    if (!over) return

    const issueId = active.id as string
    const targetColumnId = over.id as string

    // Find which column the issue currently belongs to
    const issue = ytIssues.find(i => i.id === issueId)
    if (!issue) return

    const currentCol = getColumnForIssue(issue)
    if (currentCol === targetColumnId) return

    // Find the target YouTrack state
    const targetCol = DASHBOARD_COLUMNS.find(c => c.id === targetColumnId)
    if (!targetCol) return

    // Detect backward movement
    const currentOrder = COLUMN_ORDER[currentCol] ?? 0
    const targetOrder = COLUMN_ORDER[targetColumnId] ?? 0
    const isBackward = targetOrder < currentOrder

    if (isBackward) {
      const fromLabel = DASHBOARD_COLUMNS.find(c => c.id === currentCol)?.label || currentCol
      const toLabel = targetCol.label
      addNotification({
        type: 'backward_move',
        issueId,
        summary: issue.summary,
        fromState: fromLabel,
        toState: toLabel,
      })
      setToast({ message: `${issueId} moved backward: ${fromLabel} → ${toLabel}`, type: 'warning' })
      setTimeout(() => setToast(null), 4000)
    }

    // Optimistic update: move the issue locally (even if backward)
    setYtIssues(prev => prev.map(i =>
      i.id === issueId ? { ...i, status: targetCol.ytState } : i
    ))

    // Call YouTrack API to update state
    try {
      await api.bulkUpdateYouTrackStates([{ issue_id: issueId, new_state: targetCol.ytState }])
    } catch (err) {
      console.error('Failed to update issue state:', err)
      // Revert on failure
      fetchYouTrackIssues()
    }
  }

  const getColumnForIssue = (issue: YTIssue): string => {
    const s = issue.status?.toLowerCase() || ''
    if (s === 'in progress') return 'in_progress'
    if (s === 'dev') return 'dev'
    return 'backlog'
  }

  useEffect(() => {
    fetchYouTrackIssues()
  }, [])

  const fetchYouTrackIssues = async () => {
    try {
      setYtLoading(true)
      const status = await api.getYouTrackStatus()
      if (status.configured) {
        setYtConnected(true)
        const response = await api.getYouTrackIssues()
        if (response.success && response.data) {
          setYtIssues(response.data as YTIssue[])
        }
      }
    } catch (err) {
      console.error('Failed to fetch YouTrack issues:', err)
    } finally {
      setYtLoading(false)
    }
  }

  // SSE: auto-refresh when YouTrack changes arrive via webhook
  useYouTrackEvents(useCallback((event) => {
    fetchYouTrackIssues()
    setToast({
      message: `YouTrack: ${event.issue_id} ${event.field} → ${event.new_value}`,
      type: 'info',
    })
    setTimeout(() => setToast(null), 4000)
  }, []))

  const handleSync = async () => {
    setSyncing(true)
    await fetchYouTrackIssues()
    setSyncing(false)
  }


  const handleLogout = async () => {
    await logout()
  }

  // Get user initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  // Filter issues by search query
  // Filter by "My Tasks" if enabled — match user name/email against assignee
  const myTasksFiltered = showMyTasks
    ? ytIssues.filter(i => {
        const assigneeName = i.assignee?.fullName?.toLowerCase() || ''
        const assigneeEmail = i.assignee?.email?.toLowerCase() || ''
        const userName = user?.name?.toLowerCase() || ''
        const userEmail = user?.email?.toLowerCase() || ''
        return assigneeName === userName || assigneeEmail === userEmail ||
               assigneeName.includes(userName) || userName.includes(assigneeName)
      })
    : ytIssues

  const filteredIssues = searchQuery.trim()
    ? myTasksFiltered.filter(i =>
        i.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.assignee?.fullName?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : myTasksFiltered

  // Group YouTrack issues by the 3 columns + Backlog
  const inProgressIssues = filteredIssues.filter(i => i.status?.toLowerCase() === 'in progress')
  const devIssues = filteredIssues.filter(i => i.status?.toLowerCase() === 'dev')
  const backlogIssues = filteredIssues.filter(i => {
    const s = i.status?.toLowerCase() || ''
    return s !== 'in progress' && s !== 'dev' && s !== 'done' && s !== 'fixed'
  })
  const doneIssues = filteredIssues.filter(i => {
    const s = i.status?.toLowerCase() || ''
    return s === 'done' || s === 'fixed'
  })

  // Group issues by assignee for Assignee View
  const assigneeGroups = useMemo(() => {
    const groups: Record<string, YTIssue[]> = {}
    const unassigned: YTIssue[] = []

    const activeIssues = filteredIssues.filter(i => {
      const s = i.status?.toLowerCase() || ''
      return s !== 'done' && s !== 'fixed'
    })

    for (const issue of activeIssues) {
      if (issue.assignee?.fullName) {
        const name = issue.assignee.fullName
        if (!groups[name]) groups[name] = []
        groups[name].push(issue)
      } else {
        unassigned.push(issue)
      }
    }

    const statusOrder = (s: string) => {
      const lower = s?.toLowerCase() || ''
      if (lower === 'in progress') return 0
      if (lower === 'dev') return 2
      return 1
    }

    for (const name of Object.keys(groups)) {
      groups[name].sort((a, b) => statusOrder(a.status) - statusOrder(b.status))
    }
    unassigned.sort((a, b) => statusOrder(a.status) - statusOrder(b.status))

    return { groups, unassigned }
  }, [filteredIssues])

  const getStatusBadge = (status: string) => {
    const s = status?.toLowerCase() || ''
    if (s === 'in progress') return { label: 'In Progress', bg: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }
    if (s === 'dev') return { label: 'DEV', bg: 'rgba(130, 80, 223, 0.15)', color: '#8250df' }
    return { label: status || 'Backlog', bg: 'rgba(128, 128, 128, 0.15)', color: '#888' }
  }

  const getBadgeClass = (status: string) => {
    const s = status?.toLowerCase() || ''
    if (s === 'in progress') return 'badge-progress'
    if (s === 'dev') return 'badge-review'
    return 'badge-todo'
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar animate-slide-in-left">
        <div className="sidebar-logo">
          <div className="logo-icon">
            <KanbanSquare size={24} />
          </div>
          <span className="logo-text text-gradient">Project Management</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <span className="nav-section-title">Main</span>
            <button
              className={`sidebar-nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
              onClick={() => setCurrentPage('dashboard')}
            >
              <LayoutDashboard size={20} />
              <span>Dashboard</span>
            </button>
            <button
              className={`sidebar-nav-item ${currentPage === 'board' ? 'active' : ''}`}
              onClick={() => setCurrentPage('board')}
            >
              <KanbanSquare size={20} />
              <span>Board View</span>
            </button>
            <button
              className={`sidebar-nav-item ${currentPage === 'list' ? 'active' : ''}`}
              onClick={() => setCurrentPage('list')}
            >
              <List size={20} />
              <span>List View</span>
            </button>
            <button
              className={`sidebar-nav-item ${currentPage === 'daily-ops' ? 'active' : ''}`}
              onClick={() => setCurrentPage('daily-ops')}
            >
              <Zap size={20} />
              <span>DailyOps</span>
            </button>
            <button
              className={`sidebar-nav-item ${currentPage === 'daytrack' ? 'active' : ''}`}
              onClick={() => setCurrentPage('daytrack')}
            >
              <Clock size={20} />
              <span>DayTrack</span>
            </button>
            <button
              className={`sidebar-nav-item ${currentPage === 'activity' ? 'active' : ''}`}
              onClick={() => setCurrentPage('activity')}
            >
              <Activity size={20} />
              <span>Activity</span>
            </button>
            <button
              className={`sidebar-nav-item ${currentPage === 'calendar' ? 'active' : ''}`}
              onClick={() => setCurrentPage('calendar')}
            >
              <Calendar size={20} />
              <span>Calendar</span>
            </button>
          </div>

          <div className="nav-section">
            <span className="nav-section-title">Analytics</span>
            <button
              className={`sidebar-nav-item ${currentPage === 'ai-analysis' ? 'active' : ''}`}
              onClick={() => setCurrentPage('ai-analysis')}
            >
              <Brain size={20} />
              <span>AI Analysis</span>
            </button>
            <button
              className={`sidebar-nav-item ${currentPage === 'daily-analysis' ? 'active' : ''}`}
              onClick={() => setCurrentPage('daily-analysis')}
            >
              <CheckCircle size={20} />
              <span>Daily Status</span>
            </button>
            <button
              className={`sidebar-nav-item ${currentPage === 'pm-reports' ? 'active' : ''}`}
              onClick={() => setCurrentPage('pm-reports')}
            >
              <MessageSquare size={20} />
              <span>PM Reports</span>
            </button>
            {isFullAccess && (
              <button
                className={`sidebar-nav-item ${currentPage === 'slack' ? 'active' : ''}`}
                onClick={() => setCurrentPage('slack')}
              >
                <svg width="20" height="20" viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19.7 32.5a4.9 4.9 0 1 1-4.9-4.9h4.9v4.9Z" fill="#E01E5A"/>
                  <path d="M22.2 32.5a4.9 4.9 0 0 1 9.8 0v12.3a4.9 4.9 0 0 1-9.8 0V32.5Z" fill="#E01E5A"/>
                  <path d="M27.1 19.7a4.9 4.9 0 1 1 4.9-4.9v4.9H27.1Z" fill="#36C5F0"/>
                  <path d="M27.1 22.2a4.9 4.9 0 0 1 0 9.8H14.8a4.9 4.9 0 0 1 0-9.8H27.1Z" fill="#36C5F0"/>
                  <path d="M39.9 27.1a4.9 4.9 0 1 1 4.9 4.9H39.9V27.1Z" fill="#2EB67D"/>
                  <path d="M37.4 27.1a4.9 4.9 0 0 1-9.8 0V14.8a4.9 4.9 0 0 1 9.8 0V27.1Z" fill="#2EB67D"/>
                  <path d="M32.5 39.9a4.9 4.9 0 1 1-4.9 4.9V39.9h4.9Z" fill="#ECB22E"/>
                  <path d="M32.5 37.4a4.9 4.9 0 0 1 0-9.8h12.3a4.9 4.9 0 0 1 0 9.8H32.5Z" fill="#ECB22E"/>
                </svg>
                <span>Slack</span>
              </button>
            )}
          </div>

          <div className="nav-section">
            {isFullAccess && <span className="nav-section-title">Settings</span>}
            {user?.role === 'admin' && (
              <button
                className={`sidebar-nav-item ${currentPage === 'team' ? 'active' : ''}`}
                onClick={() => setCurrentPage('team')}
              >
                <Users size={20} />
                <span>Team</span>
              </button>
            )}
            {isFullAccess && (
              <>
                <button
                  className={`sidebar-nav-item ${currentPage === 'bots' ? 'active' : ''}`}
                  onClick={() => setCurrentPage('bots')}
                >
                  <Bot size={20} />
                  <span>Bot Config</span>
                </button>
                <button
                  className={`sidebar-nav-item ${currentPage === 'integrations' ? 'active' : ''}`}
                  onClick={() => setCurrentPage('integrations')}
                >
                  <Link2 size={20} />
                  <span>Integrations</span>
                </button>
              </>
            )}
            {user?.role === 'admin' && (
              <button
                className={`sidebar-nav-item ${currentPage === 'settings' ? 'active' : ''}`}
                onClick={() => setCurrentPage('settings')}
              >
                <Settings size={20} />
                <span>Access Control</span>
              </button>
            )}
            <button className="sidebar-nav-item logout-button" onClick={handleLogout}>
              <LogOut size={20} />
              <span>Logout</span>
            </button>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            {user?.picture ? (
              <img src={user.picture} alt={user.name} className="avatar-image" />
            ) : (
              <div className="avatar">{user ? getInitials(user.name) : 'U'}</div>
            )}
            <div className="user-info">
              <span className="user-name">{user?.name || 'User'}</span>
              <span className="user-role">{user?.role?.replace('_', ' ') || 'Member'}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Header */}
      <header className="header animate-fade-in-down">
        <div className="header-left">
          <h1 className="header-title">
            {currentPage === 'dashboard' && 'Dashboard'}
            {currentPage === 'board' && 'Board View'}
            {currentPage === 'list' && 'List View'}
            {currentPage === 'daily-ops' && 'DailyOps'}
            {currentPage === 'calendar' && 'Calendar'}
            {currentPage === 'ai-analysis' && 'AI Task Analysis'}
            {currentPage === 'daily-analysis' && 'Daily Status'}
            {currentPage === 'pm-reports' && 'Reports'}
            {currentPage === 'team' && 'Team Management'}
            {currentPage === 'bots' && 'Bot Configuration'}
            {currentPage === 'settings' && 'Access Control'}
            {currentPage === 'integrations' && 'Integrations'}
            {currentPage === 'slack' && 'Slack Intelligence'}
            {currentPage === 'activity' && 'Activity'}
            {currentPage === 'daytrack' && 'DayTrack'}
          </h1>
        </div>
        <div className="header-actions">
          <div className="search-bar">
            <Search size={18} className="search-bar-icon" />
            <input
              type="text"
              className="search-bar-input"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          {(currentPage === 'dashboard' || currentPage === 'list') && (
            <div className="my-tasks-toggle">
              <button
                className={`toggle-btn ${showMyTasks ? 'active' : ''}`}
                onClick={() => setShowMyTasks(true)}
              >
                My Tasks
              </button>
              <button
                className={`toggle-btn ${!showMyTasks ? 'active' : ''}`}
                onClick={() => setShowMyTasks(false)}
              >
                All Tasks
              </button>
            </div>
          )}
          <JellySwitch
            checked={darkMode}
            onChange={setDarkMode}
            label="Dark Mode"
          />
          <div className="notification-bell-container" ref={notifRef}>
            <button
              className={`notification-bell ${showNotifications ? 'active' : ''}`}
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>
            {showNotifications && (
              <RightPanel
                onClose={() => setShowNotifications(false)}
                initialTab="notifications"
                localNotifications={notifications}
                onMoveToBlocked={handleMoveToBlocked}
                onDismissLocal={dismissNotification}
              />
            )}
          </div>
          <button
            className="btn-primary btn-md btn-new-task"
            onClick={() => setShowNewTask(true)}
          >
            <Plus size={18} />
            <span>New Task</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Render page based on currentPage */}
        {currentPage === 'integrations' && (
          <IntegrationsPage
            initialTab={integrationsTab}
            onTabChange={(tab) => navigate(`/integrations/${tab}`)}
          />
        )}
        {currentPage === 'settings' && <SettingsPage />}
        {currentPage === 'activity' && <ActivityPage />}
        {currentPage === 'slack' && (
          <SlackIntelligencePage
            initialTab={slackTab}
            onTabChange={(tab) => navigate(`/slack/${tab}`)}
          />
        )}

        {/* Dashboard Content */}
        {currentPage === 'dashboard' && (
          <>
        {/* Welcome Message */}
        <div className="welcome-banner glass-static animate-fade-in-up">
          <div className="welcome-content">
            <h2 className="welcome-title">
              Welcome back, {user?.name?.split(' ')[0] || 'there'}!
            </h2>
            <p className="welcome-subtitle">
              {ytConnected ? (
                <>
                  You have <strong>{inProgressIssues.length} in progress</strong>, <strong>{devIssues.length} in DEV</strong>, and <strong>{backlogIssues.length} in backlog</strong>.
                </>
              ) : (
                <>YouTrack not connected. Configure it in Integrations.</>
              )}
            </p>
          </div>
          {ytConnected && (
            <button
              className="btn-secondary btn-md"
              onClick={handleSync}
              disabled={syncing}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync YouTrack'}
            </button>
          )}
        </div>

        {/* Stats Cards */}
        <div className="stats-grid animate-fade-in-up stagger-1">
          <div className="stat-card glass">
            <div className="stat-icon stat-icon-blue">
              <KanbanSquare size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{ytIssues.length}</span>
              <span className="stat-label">Total Tickets</span>
            </div>
          </div>
          <div className="stat-card glass">
            <div className="stat-icon stat-icon-yellow">
              <Clock size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{inProgressIssues.length}</span>
              <span className="stat-label">In Progress</span>
            </div>
          </div>
          <div className="stat-card glass">
            <div className="stat-icon" style={{ backgroundColor: 'rgba(130, 80, 223, 0.15)' }}>
              <Code2 size={24} style={{ color: '#8250df' }} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{devIssues.length}</span>
              <span className="stat-label">DEV</span>
            </div>
          </div>
          <div className="stat-card glass">
            <div className="stat-icon" style={{ backgroundColor: 'rgba(128, 128, 128, 0.15)' }}>
              <Archive size={24} style={{ color: '#888' }} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{backlogIssues.length}</span>
              <span className="stat-label">Backlog</span>
            </div>
          </div>
        </div>

        {/* YouTrack Board - 3 Active Columns */}
        {ytLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="loading-spinner" />
          </div>
        ) : (
        <section className="section animate-fade-in-up stagger-2">
          <div className="section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                YouTrack Board
                <span className="badge" style={{ background: 'rgba(130, 80, 223, 0.15)', color: '#8250df' }}>
                  {ytIssues.length} tickets
                </span>
              </h2>
              {/* View Toggle */}
              <div className="tabs" style={{ padding: '0.15rem' }}>
                <button
                  className={`tab ${dashboardView === 'board' ? 'active' : ''}`}
                  onClick={() => setDashboardView('board')}
                  style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}
                >
                  <KanbanSquare size={14} />
                  Board
                </button>
                <button
                  className={`tab ${dashboardView === 'assignees' ? 'active' : ''}`}
                  onClick={() => setDashboardView('assignees')}
                  style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}
                >
                  <Users size={14} />
                  Assignees
                </button>
              </div>
            </div>
            <button
              className="section-link"
              onClick={() => setCurrentPage('board')}
              style={{ cursor: 'pointer', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              View Full Board <ChevronRight size={16} />
            </button>
          </div>

          {/* Board View */}
          {dashboardView === 'board' && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
          <div className="kanban-board" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {/* Backlog Column */}
            <DroppableColumn id="backlog">
              <div className="kanban-column-header">
                <span className="kanban-column-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Archive size={16} style={{ color: '#888' }} />
                  Backlog
                </span>
                <span className="kanban-column-count">{backlogIssues.length}</span>
              </div>
              <div className="kanban-column-body">
                {backlogIssues.length > 0 ? backlogIssues.map(issue => (
                  <DraggableCard key={issue.id} id={issue.id}>
                    <div className="task-card priority-medium">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{ color: '#8250df', fontSize: '0.75rem', fontWeight: 600 }}>{issue.id}</span>
                      </div>
                      <h4 className="task-title">{issue.summary}</h4>
                      <div className="task-meta">
                        <span className="badge" style={{ background: 'rgba(128, 128, 128, 0.15)', color: '#888' }}>{issue.status || 'Backlog'}</span>
                        {issue.assignee && (
                          <div className="avatar avatar-sm" title={issue.assignee.fullName}>
                            {getInitials(issue.assignee.fullName)}
                          </div>
                        )}
                      </div>
                    </div>
                  </DraggableCard>
                )) : (
                  <p className="text-muted" style={{ padding: '1rem', textAlign: 'center' }}>No tickets</p>
                )}
              </div>
            </DroppableColumn>

            {/* In Progress Column */}
            <DroppableColumn id="in_progress">
              <div className="kanban-column-header">
                <span className="kanban-column-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={16} style={{ color: 'var(--color-warning)' }} />
                  In Progress
                </span>
                <span className="kanban-column-count">{inProgressIssues.length}</span>
              </div>
              <div className="kanban-column-body">
                {inProgressIssues.length > 0 ? inProgressIssues.map(issue => (
                  <DraggableCard key={issue.id} id={issue.id}>
                    <div className="task-card priority-medium">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{ color: '#8250df', fontSize: '0.75rem', fontWeight: 600 }}>{issue.id}</span>
                      </div>
                      <h4 className="task-title">{issue.summary}</h4>
                      <div className="task-meta">
                        <span className="badge badge-progress">In Progress</span>
                        {issue.assignee && (
                          <div className="avatar avatar-sm" title={issue.assignee.fullName}>
                            {getInitials(issue.assignee.fullName)}
                          </div>
                        )}
                      </div>
                    </div>
                  </DraggableCard>
                )) : (
                  <p className="text-muted" style={{ padding: '1rem', textAlign: 'center' }}>No tickets</p>
                )}
              </div>
            </DroppableColumn>

            {/* DEV Column */}
            <DroppableColumn id="dev">
              <div className="kanban-column-header">
                <span className="kanban-column-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Code2 size={16} style={{ color: '#8250df' }} />
                  DEV
                </span>
                <span className="kanban-column-count">{devIssues.length}</span>
              </div>
              <div className="kanban-column-body">
                {devIssues.length > 0 ? devIssues.map(issue => (
                  <DraggableCard key={issue.id} id={issue.id}>
                    <div className="task-card priority-medium">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{ color: '#8250df', fontSize: '0.75rem', fontWeight: 600 }}>{issue.id}</span>
                      </div>
                      <h4 className="task-title">{issue.summary}</h4>
                      <div className="task-meta">
                        <span className="badge" style={{ background: 'rgba(130, 80, 223, 0.15)', color: '#8250df' }}>DEV</span>
                        {issue.assignee && (
                          <div className="avatar avatar-sm" title={issue.assignee.fullName}>
                            {getInitials(issue.assignee.fullName)}
                          </div>
                        )}
                      </div>
                    </div>
                  </DraggableCard>
                )) : (
                  <p className="text-muted" style={{ padding: '1rem', textAlign: 'center' }}>No tickets</p>
                )}
              </div>
            </DroppableColumn>

          </div>

          <DragOverlay>
            {activeIssue ? (
              <div className="task-card priority-medium" style={{ opacity: 0.9, boxShadow: '0 8px 25px rgba(0,0,0,0.3)', transform: 'rotate(3deg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <span style={{ color: '#8250df', fontSize: '0.75rem', fontWeight: 600 }}>{activeIssue.id}</span>
                </div>
                <h4 className="task-title">{activeIssue.summary}</h4>
                <div className="task-meta">
                  <span className="badge" style={{ background: 'rgba(130, 80, 223, 0.15)', color: '#8250df' }}>{activeIssue.status}</span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
          </DndContext>
          )}

          {/* Assignee View */}
          {dashboardView === 'assignees' && (
          <div className="kanban-board">
            <div className="kanban-columns">
              {Object.entries(assigneeGroups.groups).map(([name, issues]) => {
                const ipCount = issues.filter(i => i.status?.toLowerCase() === 'in progress').length
                const devCount = issues.filter(i => i.status?.toLowerCase() === 'dev').length
                const blCount = issues.length - ipCount - devCount
                return (
                  <div key={name} className="kanban-column">
                    <div className="kanban-column-header">
                      <div className="column-header-title">
                        <div className="avatar avatar-sm">
                          {getInitials(name)}
                        </div>
                        <div>
                          <h3 className="column-title">{name}</h3>
                          <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: '2px' }}>
                            {ipCount > 0 && <span className="badge badge-progress" style={{ padding: '1px 6px', fontSize: '0.65rem' }}>{ipCount} active</span>}
                            {' '}
                            {blCount > 0 && <span className="badge badge-todo" style={{ padding: '1px 6px', fontSize: '0.65rem' }}>{blCount} backlog</span>}
                            {' '}
                            {devCount > 0 && <span className="badge badge-review" style={{ padding: '1px 6px', fontSize: '0.65rem' }}>{devCount} done</span>}
                          </div>
                        </div>
                      </div>
                      <span className="column-task-count">{issues.length}</span>
                    </div>
                    <div className="kanban-column-content">
                      {issues.map(issue => {
                        const badgeClass = getBadgeClass(issue.status)
                        return (
                          <div key={issue.id} className="task-card">
                            <div className="task-card-header">
                              <span className="task-priority-badge priority-medium">{issue.id}</span>
                            </div>
                            <h4 className="task-card-title">{issue.summary}</h4>
                            <div className="task-card-footer">
                              <span className={`badge ${badgeClass}`}>{getStatusBadge(issue.status).label}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {/* Unassigned Column */}
              {assigneeGroups.unassigned.length > 0 && (
                <div className="kanban-column" style={{ opacity: 0.7 }}>
                  <div className="kanban-column-header">
                    <div className="column-header-title">
                      <div className="task-assignee-placeholder">
                        <User size={12} />
                      </div>
                      <h3 className="column-title">Unassigned</h3>
                    </div>
                    <span className="column-task-count">{assigneeGroups.unassigned.length}</span>
                  </div>
                  <div className="kanban-column-content">
                    {assigneeGroups.unassigned.map(issue => {
                      const badgeClass = getBadgeClass(issue.status)
                      return (
                        <div key={issue.id} className="task-card">
                          <div className="task-card-header">
                            <span className="task-priority-badge priority-medium">{issue.id}</span>
                          </div>
                          <h4 className="task-card-title">{issue.summary}</h4>
                          <div className="task-card-footer">
                            <span className={`badge ${badgeClass}`}>{getStatusBadge(issue.status).label}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          )}

        </section>
        )}
          </>
        )}

        {/* DayTrack */}
        {currentPage === 'daytrack' && <DayTrackPage />}

        {/* Board View */}
        {currentPage === 'board' && <BoardPage />}

        {/* Daily Ops */}
        {currentPage === 'daily-ops' && <DailyOpsPage />}

        {/* Bot Configuration */}
        {currentPage === 'bots' && <BotConfigPage />}

        {/* AI Analysis */}
        {currentPage === 'ai-analysis' && (
          <AIAnalysisPage onNavigateToDailyAnalysis={() => setCurrentPage('daily-analysis')} />
        )}

        {/* Daily Analysis View */}
        {currentPage === 'daily-analysis' && <DailyAnalysisViewPage />}

        {/* List View */}
        {currentPage === 'list' && <ListViewPage showMyTasks={showMyTasks} />}

        {/* Calendar Placeholder */}
        {currentPage === 'calendar' && (
          <div className="coming-soon">
            <Calendar size={48} />
            <h2>Calendar View</h2>
            <p>Calendar view with task scheduling coming soon!</p>
          </div>
        )}

        {/* PM Reports */}
        {currentPage === 'pm-reports' && (
          <PMReportsPage
            initialTab={pmReportsTab}
            onTabChange={(tab) => navigate(`/pm-reports/${tab}`)}
          />
        )}

        {/* Team Placeholder */}
        {currentPage === 'team' && (
          <div className="coming-soon">
            <Users size={48} />
            <h2>Team Management</h2>
            <p>Team management features coming soon!</p>
          </div>
        )}
      </main>

      {/* New Task Modal */}
      {showNewTask && (
        <CreateIssueModal
          onClose={() => setShowNewTask(false)}
          onCreated={() => setShowNewTask(false)}
        />
      )}


      {/* Toast Notification */}
      {toast && (
        <div className={`dashboard-toast ${toast.type === 'warning' ? 'toast-warning' : 'toast-info'}`}>
          {toast.type === 'warning' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Floating PM Assistant */}
      {chatOpen && (
        <div className={`pm-chat-panel${chatFullscreen ? ' pm-chat-panel--fullscreen' : ''}`} ref={chatPanelRef}>
          <div className="pm-chat-panel-header">
            <div className="pm-chat-panel-title">
              <Sparkles size={16} className="pm-chat-panel-title-icon" />
              <span>PM Assistant</span>
            </div>
            <div className="pm-chat-panel-actions">
              <button
                className="pm-chat-panel-close"
                onClick={() => setChatFullscreen(v => !v)}
                title={chatFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {chatFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button className="pm-chat-panel-close" onClick={() => { setChatOpen(false); setChatFullscreen(false) }}>
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="pm-chat-panel-body">
            <PMAssistantTab />
          </div>
        </div>
      )}

      <button
        className={`pm-float-bubble${chatOpen ? ' pm-float-bubble--open' : ''}`}
        onClick={() => setChatOpen(v => !v)}
        aria-label="PM Assistant"
      >
        <span className="pm-float-bubble-glow" />
        {chatOpen ? <X size={22} /> : <Sparkles size={22} />}
      </button>
    </div>
  )
}
