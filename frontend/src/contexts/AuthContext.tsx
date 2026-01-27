import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import api, { type User } from '@/services/api'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (credential: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const token = api.getToken()
      if (!token) {
        setUser(null)
        return
      }

      const response = await api.getMe()
      if (response.success && response.data) {
        setUser(response.data)
      } else {
        setUser(null)
        api.setToken(null)
      }
    } catch {
      setUser(null)
      api.setToken(null)
    }
  }, [])

  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true)
      await refreshUser()
      setIsLoading(false)
    }
    initAuth()
  }, [refreshUser])

  const login = async (credential: string) => {
    setIsLoading(true)
    try {
      const response = await api.googleAuth(credential)
      if (response.success && response.data) {
        api.setToken(response.data.token)
        setUser(response.data.user)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const logout = async () => {
    try {
      await api.logout()
    } finally {
      api.setToken(null)
      setUser(null)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
