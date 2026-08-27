const assert = require('node:assert/strict')

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
process.env.APP_URL = 'https://city-form-reviewer.vercel.app'

const calls = []
global.fetch = async (url, options) => {
  calls.push({ url, options })
  if (url.endsWith('/auth/v1/user')) return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'auth-user', email: 'user@example.com' }) }
  return { ok: true, status: 200, text: async () => '{}' }
}

const {
  configuration, recoveryRedirectUrl, ensureRecoveryIdentity, sendRecoveryEmail, verifyRecoveryToken, tokenDigest
} = require('./password-reset')

;(async () => {
  assert.equal(configuration().configured, true)
  assert.equal(recoveryRedirectUrl(), 'https://city-form-reviewer.vercel.app/reset-password')
  await ensureRecoveryIdentity('user@example.com')
  const created = JSON.parse(calls[0].options.body)
  assert.equal(created.email, 'user@example.com')
  assert.equal(created.email_confirm, true)
  assert.notEqual(created.password, '')

  await sendRecoveryEmail('user@example.com')
  assert.match(calls[1].url, /\/auth\/v1\/recover\?redirect_to=/)
  assert.match(decodeURIComponent(calls[1].url), /city-form-reviewer\.vercel\.app\/reset-password/)

  const verified = await verifyRecoveryToken('recovery-access-token')
  assert.equal(verified.email, 'user@example.com')
  assert.equal(calls[2].options.headers.Authorization, 'Bearer recovery-access-token')
  assert.equal(tokenDigest('one'), tokenDigest('one'))
  assert.notEqual(tokenDigest('one'), tokenDigest('two'))
  console.log('password reset wiring: ok')
})().catch(error => {
  console.error(error)
  process.exit(1)
})
