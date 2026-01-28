import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-screen-content">
          <div className="loading-spinner"></div>
          <p className="loading-screen-text">Loading Project Management...</p>
        </div>
      </div>
    )
  }

  return isAuthenticated ? <Dashboard /> : <Login />
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
