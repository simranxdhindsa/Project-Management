import { useState, useEffect, useRef } from 'react'
import api from '../../services/api'
import { RightPanel } from './RightPanel'

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [])

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const fetchUnreadCount = async () => {
    try {
      const response = await api.getUnreadNotificationCount()
      if (response.success && response.data) {
        setUnreadCount(response.data.count)
      }
    } catch (err) {
      console.error('Error fetching unread count:', err)
    }
  }

  const handleClose = () => {
    setIsOpen(false)
    // Refresh unread count after panel closes (user may have read some)
    fetchUnreadCount()
  }

  return (
    <div className="notification-bell-container" ref={bellRef}>
      <button
        className={`notification-bell ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(prev => !prev)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="notification-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <RightPanel
          onClose={handleClose}
          initialTab="notifications"
        />
      )}
    </div>
  )
}
