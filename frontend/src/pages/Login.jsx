import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const inviteToken = params.get('invite') || ''
  const { login } = useAuth()
  const [mode, setMode] = useState(inviteToken ? 'register' : 'login')
  const [form, setForm] = useState({ name: '', companyName: '', email: params.get('email') || '', password: '', confirmPassword: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (mode === 'register') {
      if (!form.name.trim()) return setError('Full name is required')
      if (form.password !== form.confirmPassword) return setError('Passwords do not match')
      if (form.password.length < 12) return setError('Password must be at least 12 characters')
    }
    setLoading(true)
    try {
      const body = mode === 'login'
        ? { email: form.email, password: form.password }
        : { name: form.name, companyName: form.companyName, email: form.email, password: form.password, inviteToken }
      const r = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await r.json()
      if (!r.ok) return setError(data.error || 'Something went wrong')
      login(data.token, data.user)
      nav('/')
    } catch {
      setError('Connection error — is the server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
      padding: 20
    }}>
      {/* Background decoration */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-20%', left: '-10%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-20%', right: '-10%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,0.1) 0%, transparent 70%)' }} />
      </div>

      <div className="fade-in" style={{ width: '100%', maxWidth: 420, position: 'relative' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 16, boxShadow: '0 8px 32px rgba(79,70,229,0.4)' }}>🏛</div>
          <div style={{ fontWeight: 800, fontSize: 22, color: 'white', letterSpacing: -0.5 }}>City Form Reviewer</div>
          <div style={{ fontSize: 13, color: '#818cf8', marginTop: 4, fontWeight: 500 }}>AI-powered contract compliance</div>
        </div>

        {/* Card */}
        <div style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '32px 32px 28px', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>

          {/* Tab toggle */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 3, marginBottom: 28, gap: 3 }}>
            {[['login', 'Existing User'], ['register', 'New User']].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setError('') }}
                style={{
                  flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  background: mode === m ? 'rgba(99,102,241,0.9)' : 'transparent',
                  color: mode === m ? 'white' : '#94a3b8',
                  transition: 'all 0.15s', boxShadow: mode === m ? '0 2px 8px rgba(99,102,241,0.4)' : 'none'
                }}>{label}</button>
            ))}
          </div>

          <form onSubmit={submit}>
            {mode === 'register' && (
              <>
                <Field label="Full Name" value={form.name} onChange={v => set('name', v)} placeholder="Jane Smith" autoComplete="name" />
                {!inviteToken && <Field label="Company Name" value={form.companyName} onChange={v => set('companyName', v)} placeholder="Northstar Engineering" autoComplete="organization" />}
                {inviteToken && <div style={{ padding: '10px 12px', marginBottom: 16, borderRadius: 9, background: 'rgba(34,197,94,.1)', color: '#86efac', fontSize: 12 }}>You’re joining an existing company workspace.</div>}
              </>
            )}
            <Field label="Email Address" type="email" value={form.email} onChange={v => set('email', v)} placeholder="jane@city.gov" autoComplete="email" />
            <Field label="Password" type="password" value={form.password} onChange={v => set('password', v)} placeholder={mode === 'login' ? 'Your password' : 'At least 12 characters'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {mode === 'login' && (
              <div style={{ textAlign: 'right', marginTop: -8, marginBottom: 16 }}>
                <Link to={`/forgot-password${form.email ? `?email=${encodeURIComponent(form.email)}` : ''}`} style={{ color: '#a5b4fc', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>Forgot password?</Link>
              </div>
            )}
            {mode === 'register' && (
              <Field label="Confirm Password" type="password" value={form.confirmPassword} onChange={v => set('confirmPassword', v)} placeholder="Repeat password" autoComplete="new-password" />
            )}

            {error && (
              <div className="fade-in" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 9, padding: '10px 13px', marginBottom: 16, fontSize: 13, color: '#fca5a5', lineHeight: 1.5 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{
                width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: loading ? 'default' : 'pointer',
                background: loading ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #4f46e5, #6366f1)',
                color: 'white', fontWeight: 800, fontSize: 14, letterSpacing: 0.2,
                boxShadow: loading ? 'none' : '0 4px 16px rgba(79,70,229,0.5)', transition: 'all 0.15s', marginTop: 4
              }}>
              {loading
                ? <span><span className="spin">⟳</span> {mode === 'login' ? 'Signing in…' : 'Creating account…'}</span>
                : mode === 'login' ? 'Sign In →' : 'Create Account →'}
            </button>
          </form>

          {mode === 'register' && (
            <p style={{ fontSize: 11, color: '#475569', textAlign: 'center', marginTop: 18, lineHeight: 1.6 }}>
              Passwords are securely hashed and never stored as readable text.<br />
              Company managers can invite reviewers by email after creating an account.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, type = 'text', value, onChange, placeholder, autoComplete }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} required
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 9, fontSize: 14, outline: 'none', transition: 'all 0.15s', boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.06)', color: 'white',
          border: `1.5px solid ${focused ? 'rgba(99,102,241,0.7)' : 'rgba(255,255,255,0.1)'}`,
          boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.15)' : 'none'
        }} />
    </div>
  )
}
