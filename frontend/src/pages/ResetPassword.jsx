import { useMemo, useState } from 'react'
import { AuthPage, BackLink, Field, Notice, buttonStyle } from './ForgotPassword'

export default function ResetPassword() {
  const recovery = useMemo(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    return {
      accessToken: hash.get('access_token') || query.get('access_token') || '',
      error: hash.get('error_description') || query.get('error_description') || ''
    }
  }, [])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(recovery.error)
  const [message, setMessage] = useState('')

  const submit = async event => {
    event.preventDefault()
    setError('')
    if (password.length < 12) return setError('Password must be at least 12 characters.')
    if (password !== confirmPassword) return setError('Passwords do not match.')
    setLoading(true)
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: recovery.accessToken, password })
      })
      const data = await response.json()
      if (!response.ok) setError(data.error || 'Unable to reset your password.')
      else {
        window.history.replaceState(null, '', '/reset-password')
        setMessage(data.message)
        setPassword('')
        setConfirmPassword('')
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const missingToken = !recovery.accessToken
  return (
    <AuthPage title="Choose a new password" subtitle="Use at least 12 characters.">
      {message ? <Notice tone="success">{message}</Notice> : missingToken ? (
        <Notice tone="error">This reset link is missing, invalid, or expired. Return to sign in and request a new link.</Notice>
      ) : (
        <form onSubmit={submit}>
          <Field label="New Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 12 characters" />
          <Field label="Confirm Password" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" placeholder="Repeat password" />
          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" disabled={loading} style={buttonStyle(loading)}>{loading ? 'Updating…' : 'Update password →'}</button>
        </form>
      )}
      <BackLink />
    </AuthPage>
  )
}
