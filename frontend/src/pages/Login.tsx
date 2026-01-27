import { useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { KanbanSquare, CheckCircle, Zap, Shield } from 'lucide-react'

// Declare Google global type
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (
            element: HTMLElement,
            config: {
              theme?: string
              size?: string
              width?: number
              text?: string
            }
          ) => void
          prompt: () => void
        }
      }
    }
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

export default function Login() {
  const { login, isLoading } = useAuth()

  const handleGoogleCallback = useCallback(
    async (response: { credential: string }) => {
      try {
        await login(response.credential)
        // Redirect will happen automatically via App.tsx
      } catch (error) {
        console.error('Login failed:', error)
      }
    },
    [login]
  )

  useEffect(() => {
    // Load Google Sign-In script
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    document.body.appendChild(script)

    script.onload = () => {
      if (window.google && GOOGLE_CLIENT_ID) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCallback,
        })

        const buttonDiv = document.getElementById('google-signin-button')
        if (buttonDiv) {
          window.google.accounts.id.renderButton(buttonDiv, {
            theme: 'filled_black',
            size: 'large',
            width: 300,
            text: 'signin_with',
          })
        }
      }
    }

    return () => {
      document.body.removeChild(script)
    }
  }, [handleGoogleCallback])

  const features = [
    {
      icon: <KanbanSquare className="feature-icon" />,
      title: 'Asana Sync',
      description: 'Two-way sync with your Asana projects',
    },
    {
      icon: <Zap className="feature-icon" />,
      title: 'AI Analysis',
      description: 'Smart Slack message analysis with Gemini',
    },
    {
      icon: <CheckCircle className="feature-icon" />,
      title: 'Daily Carry-Over',
      description: "Yesterday's pending tasks at a glance",
    },
    {
      icon: <Shield className="feature-icon" />,
      title: 'Role-Based Access',
      description: 'Admin, PM, Member, and Viewer roles',
    },
  ]

  return (
    <div className="login-container">
      <div className="login-content animate-fade-in-up">
        {/* Logo and Title */}
        <div className="login-header">
          <div className="login-logo animate-float">
            <KanbanSquare size={48} />
          </div>
          <h1 className="login-title text-gradient">TaskSync Pro</h1>
          <p className="login-subtitle">
            Sync your Asana tasks, analyze Slack progress with AI
          </p>
        </div>

        {/* Login Card */}
        <div className="login-card glass-static">
          <h2 className="login-card-title">Welcome Back</h2>
          <p className="login-card-description">
            Sign in with your company Google account
          </p>

          <div className="login-button-container">
            {isLoading ? (
              <div className="loading-container">
                <div className="loading-spinner"></div>
                <span className="loading-text">Signing in...</span>
              </div>
            ) : GOOGLE_CLIENT_ID ? (
              <div id="google-signin-button"></div>
            ) : (
              <div className="login-demo-notice">
                <p>Google Client ID not configured.</p>
                <p className="login-demo-hint">
                  Set VITE_GOOGLE_CLIENT_ID in .env file
                </p>
                <button
                  className="btn-primary btn-md login-demo-button"
                  onClick={() => {
                    // Demo mode - create a fake login for development
                    alert('Configure Google OAuth to enable login')
                  }}
                >
                  Configure OAuth
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Features Grid */}
        <div className="features-grid">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={`feature-card glass stagger-${index + 1}`}
            >
              {feature.icon}
              <h3 className="feature-title">{feature.title}</h3>
              <p className="feature-description">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Background decorations */}
      <div className="login-bg-decoration login-bg-decoration-1"></div>
      <div className="login-bg-decoration login-bg-decoration-2"></div>
    </div>
  )
}
