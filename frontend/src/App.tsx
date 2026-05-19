import { BrowserRouter, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import ThemePreviewPage from '@/pages/ThemePreviewPage'
import NoAccessPage from '@/pages/NoAccessPage'

function AppContent() {
  const { isAuthenticated, isLoading, accessDenied, accessDeniedMessage, clearAccessDenied } = useAuth()
  const location = useLocation()

  if (location.pathname === '/theme-preview') return <ThemePreviewPage />

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-screen-content">
          <div className="loading-spinner"></div>
          <p className="loading-screen-text">Loading Velocity...</p>
        </div>
      </div>
    )
  }

  if (accessDenied) {
    return <NoAccessPage message={accessDeniedMessage} onReset={clearAccessDenied} />
  }

  return isAuthenticated ? <Dashboard /> : <Login />
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
