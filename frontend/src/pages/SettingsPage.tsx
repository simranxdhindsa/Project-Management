import { useState, useEffect } from 'react'
import api from '../services/api'
import type { AllowedEmail, AllowedDomain, AccessSettings } from '../services/api'

type UserRole = 'admin' | 'project_manager' | 'member' | 'viewer'

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
]

export function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [settings, setSettings] = useState<AccessSettings | null>(null)

  // Form state
  const [newEmail, setNewEmail] = useState('')
  const [newEmailRole, setNewEmailRole] = useState<UserRole>('member')
  const [newDomain, setNewDomain] = useState('')
  const [newDomainRole, setNewDomainRole] = useState<UserRole>('member')
  const [addingEmail, setAddingEmail] = useState(false)
  const [addingDomain, setAddingDomain] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.getAccessSettings()
      if (response.success && response.data) {
        setSettings(response.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmail.trim()) return

    try {
      setAddingEmail(true)
      setError(null)
      const response = await api.addAllowedEmail(newEmail.trim(), newEmailRole)
      if (response.success) {
        setSuccess('Email added successfully')
        setNewEmail('')
        setNewEmailRole('member')
        fetchSettings()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add email')
    } finally {
      setAddingEmail(false)
    }
  }

  const handleRemoveEmail = async (email: string) => {
    if (!confirm(`Remove ${email} from the allowed list?`)) return

    try {
      setError(null)
      await api.removeAllowedEmail(email)
      setSuccess('Email removed successfully')
      fetchSettings()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove email')
    }
  }

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDomain.trim()) return

    try {
      setAddingDomain(true)
      setError(null)
      const domain = newDomain.trim().replace(/^@/, '')
      const response = await api.addAllowedDomain(domain, newDomainRole)
      if (response.success) {
        setSuccess('Domain added successfully')
        setNewDomain('')
        setNewDomainRole('member')
        fetchSettings()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add domain')
    } finally {
      setAddingDomain(false)
    }
  }

  const handleRemoveDomain = async (domain: string) => {
    if (!confirm(`Remove @${domain} from the allowed list?`)) return

    try {
      setError(null)
      await api.removeAllowedDomain(domain)
      setSuccess('Domain removed successfully')
      fetchSettings()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove domain')
    }
  }

  const getRoleBadgeClass = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'role-admin'
      case 'project_manager':
        return 'role-pm'
      case 'member':
        return 'role-member'
      case 'viewer':
        return 'role-viewer'
      default:
        return ''
    }
  }

  if (loading) {
    return (
      <div className="settings-page">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1 className="page-title">Access Control Settings</h1>
        <p className="page-subtitle">
          Manage who can access the application using Google OAuth
        </p>
      </div>

      {error && (
        <div className="alert alert-error">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
          <button className="alert-close" onClick={() => setError(null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {success}
        </div>
      )}

      {/* Default Admin Notice */}
      <div className="info-card glass-card">
        <div className="info-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
        <div className="info-content">
          <h3>Default Administrator</h3>
          <p>
            <strong>{settings?.default_admin_email}</strong> always has admin access
            and cannot be removed from the system.
          </p>
        </div>
      </div>

      {/* Allowed Emails Section */}
      <div className="settings-section glass-card">
        <div className="section-header">
          <div>
            <h2>Allowed Email Addresses</h2>
            <p>Specific email addresses that can access the application</p>
          </div>
        </div>

        <form className="add-form" onSubmit={handleAddEmail}>
          <div className="form-row">
            <div className="form-group flex-1">
              <input
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <select
                value={newEmailRole}
                onChange={(e) => setNewEmailRole(e.target.value as UserRole)}
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={addingEmail || !newEmail.trim()}
            >
              {addingEmail ? 'Adding...' : 'Add Email'}
            </button>
          </div>
        </form>

        <div className="items-list">
          {settings?.allowed_emails && settings.allowed_emails.length > 0 ? (
            settings.allowed_emails.map((item) => (
              <div key={item.email} className="list-item">
                <div className="item-info">
                  <span className="item-name">{item.email}</span>
                  <span className={`role-badge ${getRoleBadgeClass(item.role)}`}>
                    {item.role.replace('_', ' ')}
                  </span>
                  {item.is_default && (
                    <span className="default-badge">Default Admin</span>
                  )}
                </div>
                <div className="item-actions">
                  {!item.is_default && (
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => handleRemoveEmail(item.email)}
                      title="Remove email"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-list">
              <p>No additional emails configured. Only the default admin has access.</p>
            </div>
          )}
        </div>
      </div>

      {/* Allowed Domains Section */}
      <div className="settings-section glass-card">
        <div className="section-header">
          <div>
            <h2>Allowed Email Domains</h2>
            <p>Allow all users from specific email domains (e.g., @company.com)</p>
          </div>
        </div>

        <form className="add-form" onSubmit={handleAddDomain}>
          <div className="form-row">
            <div className="form-group flex-1">
              <div className="input-with-prefix">
                <span className="input-prefix">@</span>
                <input
                  type="text"
                  placeholder="company.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value.replace(/^@/, ''))}
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <select
                value={newDomainRole}
                onChange={(e) => setNewDomainRole(e.target.value as UserRole)}
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={addingDomain || !newDomain.trim()}
            >
              {addingDomain ? 'Adding...' : 'Add Domain'}
            </button>
          </div>
        </form>

        <div className="items-list">
          {settings?.allowed_domains && settings.allowed_domains.length > 0 ? (
            settings.allowed_domains.map((item) => (
              <div key={item.domain} className="list-item">
                <div className="item-info">
                  <span className="item-name">@{item.domain}</span>
                  <span className={`role-badge ${getRoleBadgeClass(item.role)}`}>
                    {item.role.replace('_', ' ')}
                  </span>
                </div>
                <div className="item-actions">
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => handleRemoveDomain(item.domain)}
                    title="Remove domain"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-list">
              <p>No domains configured. Add a domain to allow all users from that organization.</p>
            </div>
          )}
        </div>
      </div>

      {/* Google OAuth Setup Instructions */}
      <div className="settings-section glass-card">
        <div className="section-header">
          <h2>Google OAuth Setup</h2>
          <p>Instructions for setting up Google OAuth for your application</p>
        </div>

        <div className="instructions">
          <ol>
            <li>
              Go to the{' '}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Cloud Console
              </a>
            </li>
            <li>Create a new project or select an existing one</li>
            <li>Navigate to "APIs & Services" &gt; "Credentials"</li>
            <li>Click "Create Credentials" &gt; "OAuth client ID"</li>
            <li>Select "Web application" as the application type</li>
            <li>
              Add authorized JavaScript origins:
              <ul>
                <li>
                  <code>http://localhost:5173</code> (development)
                </li>
                <li>
                  <code>https://yourdomain.com</code> (production)
                </li>
              </ul>
            </li>
            <li>
              Add authorized redirect URIs:
              <ul>
                <li>
                  <code>http://localhost:5173/auth/callback</code> (development)
                </li>
                <li>
                  <code>https://yourdomain.com/auth/callback</code> (production)
                </li>
              </ul>
            </li>
            <li>Copy the Client ID and Client Secret</li>
            <li>
              Set environment variables in your backend:
              <ul>
                <li>
                  <code>GOOGLE_CLIENT_ID</code>
                </li>
                <li>
                  <code>GOOGLE_CLIENT_SECRET</code>
                </li>
                <li>
                  <code>GOOGLE_REDIRECT_URI</code>
                </li>
              </ul>
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
