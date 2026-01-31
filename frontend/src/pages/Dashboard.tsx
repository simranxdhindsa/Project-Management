import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useTaskStats } from '@/hooks/useTaskStats'
import { useTasks } from '@/hooks/useTasks'
import {
  LayoutDashboard,
  KanbanSquare,
  List,
  Calendar,
  ClipboardList,
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
  Brain
} from 'lucide-react'
import { IntegrationsPage } from './IntegrationsPage'
import { SettingsPage } from './SettingsPage'
import { BoardPage } from './BoardPage'
import { DailyTaskListPage } from './DailyTaskListPage'
import { BotConfigPage } from './BotConfigPage'
import { AIAnalysisPage } from './AIAnalysisPage'

type Page = 'dashboard' | 'board' | 'list' | 'daily-tasks' | 'calendar' | 'reports' | 'ai-analysis' | 'bots' | 'team' | 'settings' | 'integrations'

export default function Dashboard() {
  const { user, logout } = useAuth()
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const { stats } = useTaskStats()
  const { tasks } = useTasks()

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

  // Group tasks by status for kanban preview
  const todoTasks = tasks.filter(t => t.status === 'todo').slice(0, 3)
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').slice(0, 3)
  const reviewTasks = tasks.filter(t => t.status === 'review').slice(0, 3)
  const doneTasks = tasks.filter(t => t.status === 'done').slice(0, 3)

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
              className={`sidebar-nav-item ${currentPage === 'daily-tasks' ? 'active' : ''}`}
              onClick={() => setCurrentPage('daily-tasks')}
            >
              <ClipboardList size={20} />
              <span>Daily Tasks</span>
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
              className={`sidebar-nav-item ${currentPage === 'reports' ? 'active' : ''}`}
              onClick={() => setCurrentPage('reports')}
            >
              <BarChart3 size={20} />
              <span>Reports</span>
            </button>
          </div>

          <div className="nav-section">
            <span className="nav-section-title">Settings</span>
            {user?.role === 'admin' && (
              <button
                className={`sidebar-nav-item ${currentPage === 'team' ? 'active' : ''}`}
                onClick={() => setCurrentPage('team')}
              >
                <Users size={20} />
                <span>Team</span>
              </button>
            )}
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
            {currentPage === 'daily-tasks' && 'Daily Task List'}
            {currentPage === 'calendar' && 'Calendar'}
            {currentPage === 'ai-analysis' && 'AI Task Analysis'}
            {currentPage === 'reports' && 'Reports'}
            {currentPage === 'team' && 'Team Management'}
            {currentPage === 'bots' && 'Bot Configuration'}
            {currentPage === 'settings' && 'Access Control'}
            {currentPage === 'integrations' && 'Integrations'}
          </h1>
        </div>
        <div className="header-actions">
          <div className="search-bar">
            <Search size={18} className="search-bar-icon" />
            <input
              type="text"
              className="search-bar-input"
              placeholder="Search tasks..."
            />
          </div>
          <button className="icon-button tooltip" data-tooltip="Notifications">
            <Bell size={20} />
            <span className="notification-badge"></span>
          </button>
          <button className="btn-primary btn-md">
            <Plus size={18} />
            <span>New Task</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Render page based on currentPage */}
        {currentPage === 'integrations' && <IntegrationsPage />}
        {currentPage === 'settings' && <SettingsPage />}

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
              You have <strong>{stats.todo + stats.in_progress} pending tasks</strong> and <strong>{stats.overdue} overdue</strong>.
            </p>
          </div>
          <button className="btn-secondary btn-md">View Pending Tasks</button>
        </div>

        {/* Stats Cards */}
        <div className="stats-grid animate-fade-in-up stagger-1">
          <div className="stat-card glass">
            <div className="stat-icon stat-icon-blue">
              <KanbanSquare size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.total}</span>
              <span className="stat-label">Total Tasks</span>
            </div>
          </div>
          <div className="stat-card glass">
            <div className="stat-icon stat-icon-yellow">
              <ChevronRight size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.in_progress}</span>
              <span className="stat-label">In Progress</span>
            </div>
          </div>
          <div className="stat-card glass">
            <div className="stat-icon stat-icon-green">
              <BarChart3 size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.done}</span>
              <span className="stat-label">Completed</span>
            </div>
          </div>
          <div className="stat-card glass">
            <div className="stat-icon stat-icon-red">
              <Bell size={24} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.overdue}</span>
              <span className="stat-label">Overdue</span>
            </div>
          </div>
        </div>

        {/* Kanban Preview */}
        <section className="section animate-fade-in-up stagger-2">
          <div className="section-header">
            <h2 className="section-title">Today's Tasks</h2>
            <a href="#" className="section-link">
              View All <ChevronRight size={16} />
            </a>
          </div>

          <div className="kanban-board">
            {/* To Do Column */}
            <div className="kanban-column">
              <div className="kanban-column-header">
                <span className="kanban-column-title">To Do</span>
                <span className="kanban-column-count">{stats.todo}</span>
              </div>
              <div className="kanban-column-body">
                {todoTasks.length > 0 ? todoTasks.map(task => (
                  <div key={task.id} className={`task-card priority-${task.priority || 'medium'}`}>
                    <h4 className="task-title">{task.title}</h4>
                    {task.description && <p className="task-description">{task.description}</p>}
                    <div className="task-meta">
                      <span className="badge badge-todo">To Do</span>
                      <div className="avatar avatar-sm">
                        {task.assignee_name ? getInitials(task.assignee_name) : 'U'}
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="text-muted" style={{padding: '1rem', textAlign: 'center'}}>No tasks</p>
                )}
              </div>
            </div>

            {/* In Progress Column */}
            <div className="kanban-column">
              <div className="kanban-column-header">
                <span className="kanban-column-title">In Progress</span>
                <span className="kanban-column-count">{stats.in_progress}</span>
              </div>
              <div className="kanban-column-body">
                {inProgressTasks.length > 0 ? inProgressTasks.map(task => (
                  <div key={task.id} className={`task-card priority-${task.priority || 'medium'}`}>
                    <h4 className="task-title">{task.title}</h4>
                    {task.description && <p className="task-description">{task.description}</p>}
                    <div className="task-meta">
                      <span className="badge badge-progress">In Progress</span>
                      <div className="avatar avatar-sm">
                        {task.assignee_name ? getInitials(task.assignee_name) : 'U'}
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="text-muted" style={{padding: '1rem', textAlign: 'center'}}>No tasks</p>
                )}
              </div>
            </div>

            {/* Review Column */}
            <div className="kanban-column">
              <div className="kanban-column-header">
                <span className="kanban-column-title">Review</span>
                <span className="kanban-column-count">{stats.review}</span>
              </div>
              <div className="kanban-column-body">
                {reviewTasks.length > 0 ? reviewTasks.map(task => (
                  <div key={task.id} className={`task-card priority-${task.priority || 'medium'}`}>
                    <h4 className="task-title">{task.title}</h4>
                    {task.description && <p className="task-description">{task.description}</p>}
                    <div className="task-meta">
                      <span className="badge badge-review">Review</span>
                      <div className="avatar avatar-sm">
                        {task.assignee_name ? getInitials(task.assignee_name) : 'U'}
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="text-muted" style={{padding: '1rem', textAlign: 'center'}}>No tasks</p>
                )}
              </div>
            </div>

            {/* Done Column */}
            <div className="kanban-column">
              <div className="kanban-column-header">
                <span className="kanban-column-title">Done</span>
                <span className="kanban-column-count">{stats.done}</span>
              </div>
              <div className="kanban-column-body">
                {doneTasks.length > 0 ? doneTasks.map(task => (
                  <div key={task.id} className={`task-card priority-${task.priority || 'low'}`}>
                    <h4 className="task-title">{task.title}</h4>
                    {task.description && <p className="task-description">{task.description}</p>}
                    <div className="task-meta">
                      <span className="badge badge-done">Done</span>
                      <div className="avatar avatar-sm">
                        {task.assignee_name ? getInitials(task.assignee_name) : 'U'}
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="text-muted" style={{padding: '1rem', textAlign: 'center'}}>No tasks</p>
                )}
              </div>
            </div>
          </div>
        </section>
          </>
        )}

        {/* Board View */}
        {currentPage === 'board' && <BoardPage />}

        {/* Daily Task List */}
        {currentPage === 'daily-tasks' && <DailyTaskListPage />}

        {/* Bot Configuration */}
        {currentPage === 'bots' && <BotConfigPage />}

        {/* AI Analysis */}
        {currentPage === 'ai-analysis' && <AIAnalysisPage />}

        {/* List View Placeholder */}
        {currentPage === 'list' && (
          <div className="coming-soon">
            <List size={48} />
            <h2>List View</h2>
            <p>Task list view with sorting and filtering coming soon!</p>
          </div>
        )}

        {/* Calendar Placeholder */}
        {currentPage === 'calendar' && (
          <div className="coming-soon">
            <Calendar size={48} />
            <h2>Calendar View</h2>
            <p>Calendar view with task scheduling coming soon!</p>
          </div>
        )}

        {/* Reports Placeholder */}
        {currentPage === 'reports' && (
          <div className="coming-soon">
            <BarChart3 size={48} />
            <h2>Reports</h2>
            <p>Team productivity reports and analytics coming soon!</p>
          </div>
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
    </div>
  )
}
