import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

export default function ForgotPassword() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const submit = async event => {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await response.json()
      if (!response.ok) setError(data.error || 'Unable to send a reset email.')
      else setMessage(data.message)
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthPage title="Reset your password" subtitle="We’ll email you a secure reset link.">
      <form onSubmit={submit}>
        <Field label="Email Address" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="jane@city.gov" />
        {error && <Notice tone="error">{error}</Notice>}
        {message && <Notice tone="success">{message} Check your spam folder if it does not arrive.</Notice>}
        <button type="submit" disabled={loading} style={buttonStyle(loading)}>
          {loading ? 'Sending…' : 'Email reset link →'}
        </button>
      </form>
      <BackLink />
    </AuthPage>
  )
}

export function AuthPage({ title, subtitle, children }) {
  return (
    <div style={pageStyle}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 16, boxShadow: '0 8px 32px rgba(79,70,229,0.4)' }}>🏛</div>
          <div style={{ fontWeight: 800, fontSize: 22, color: 'white' }}>{title}</div>
          <div style={{ fontSize: 13, color: '#a5b4fc', marginTop: 6 }}>{subtitle}</div>
        </div>
        <div style={cardStyle}>{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, type = 'text', value, onChange, placeholder, autoComplete }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{label}</label>
      <input type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} required style={inputStyle} />
    </div>
  )
}

export function Notice({ tone, children }) {
  const success = tone === 'success'
  return <div style={{ background: success ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.12)', border: `1px solid ${success ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`, borderRadius: 9, padding: '10px 13px', marginBottom: 16, color: success ? '#86efac' : '#fca5a5', fontSize: 13, lineHeight: 1.5 }}>{children}</div>
}

export function BackLink() {
  return <div style={{ textAlign: 'center', marginTop: 20 }}><Link to="/login" style={{ color: '#a5b4fc', fontSize: 13, textDecoration: 'none', fontWeight: 700 }}>← Back to sign in</Link></div>
}

export const buttonStyle = disabled => ({
  width: '100%', padding: 12, borderRadius: 10, border: 'none', cursor: disabled ? 'default' : 'pointer',
  background: disabled ? 'rgba(99,102,241,.4)' : 'linear-gradient(135deg, #4f46e5, #6366f1)', color: 'white', fontWeight: 800, fontSize: 14
})

const pageStyle = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif', padding: 20, boxSizing: 'border-box' }
const cardStyle = { background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '32px 32px 28px', boxShadow: '0 24px 64px rgba(0,0,0,.5)' }
const inputStyle = { width: '100%', padding: '11px 14px', borderRadius: 9, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)', color: 'white', border: '1.5px solid rgba(255,255,255,.12)' }
