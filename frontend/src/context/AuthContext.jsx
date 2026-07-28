import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('auth_token'))
  const [loading, setLoading] = useState(true)

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token')
    setToken(null)
    setUser(null)
  }, [])

  const login = useCallback((newToken, newUser) => {
    localStorage.setItem('auth_token', newToken)
    setToken(newToken)
    setUser(newUser)
  }, [])

  // Validate token on mount
  useEffect(() => {
    if (!token && import.meta.env.DEV) {
      fetch('/api/auth/dev-login', { method: 'POST' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('Local preview login failed')))
        .then(data => login(data.token, data.user))
        .catch(() => setLoading(false))
      return
    }
    if (!token) { setLoading(false); return }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(u => { if (u) setUser(u); else logout() })
      .catch(() => logout())
      .finally(() => setLoading(false))
  }, [token, login, logout])

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }

// Authenticated fetch — attaches token automatically
export function useApiFetch() {
  const { token, logout } = useContext(AuthContext)
  return useCallback(async (url, options = {}) => {
    const headers = { ...options.headers, Authorization: `Bearer ${token}` }
    const r = await fetch(url, { ...options, headers })
    if (r.status === 401) { logout(); return r }
    return r
  }, [token, logout])
}
