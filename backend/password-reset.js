const crypto = require('crypto')

function configuration() {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '')
  return {
    configured: Boolean(supabaseUrl && serviceKey && appUrl),
    supabaseUrl,
    serviceKey,
    appUrl
  }
}

function recoveryRedirectUrl() {
  const { appUrl } = configuration()
  if (!appUrl) throw new Error('APP_URL is required for password reset emails.')
  let url
  try { url = new URL(appUrl) } catch { throw new Error('APP_URL must be a valid HTTP or HTTPS URL.') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('APP_URL must be a valid HTTP or HTTPS URL.')
  return new URL('reset-password', `${url.toString().replace(/\/$/, '')}/`).toString()
}

async function authRequest(route, options = {}, accessToken) {
  const { supabaseUrl, serviceKey } = configuration()
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase Auth is not configured for password resets.')
  const response = await fetch(`${supabaseUrl}/auth/v1${route}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${accessToken || serviceKey}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  })
  const body = await response.text()
  let data = null
  try { data = body ? JSON.parse(body) : null } catch { data = body }
  return { ok: response.ok, status: response.status, data }
}

async function ensureRecoveryIdentity(email) {
  const result = await authRequest('/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: crypto.randomBytes(48).toString('base64url'),
      email_confirm: true,
      user_metadata: { account_source: 'city-form-reviewer-password-recovery' }
    })
  })
  if (result.ok) return result.data
  const detail = `${result.data?.code || ''} ${result.data?.message || result.data?.msg || result.data || ''}`
  if (['email_exists', 'user_already_exists'].includes(result.data?.code) || /already (been )?(registered|exists)/i.test(detail)) return null
  throw new Error(`Supabase could not prepare the recovery account (${result.status}).`)
}

async function sendRecoveryEmail(email) {
  const redirectTo = recoveryRedirectUrl()
  const result = await authRequest(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    body: JSON.stringify({ email })
  })
  if (!result.ok) throw new Error(`Supabase could not send the recovery email (${result.status}).`)
}

async function verifyRecoveryToken(accessToken) {
  if (!accessToken) return null
  const result = await authRequest('/user', { method: 'GET' }, accessToken)
  if (!result.ok || !result.data?.email) return null
  return result.data
}

async function closeRecoverySession(accessToken) {
  if (!accessToken) return
  try { await authRequest('/logout?scope=global', { method: 'POST' }, accessToken) } catch {}
}

function tokenDigest(accessToken) {
  return crypto.createHash('sha256').update(accessToken).digest('hex')
}

module.exports = {
  configuration,
  recoveryRedirectUrl,
  ensureRecoveryIdentity,
  sendRecoveryEmail,
  verifyRecoveryToken,
  closeRecoverySession,
  tokenDigest
}
