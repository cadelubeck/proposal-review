const crypto = require('crypto')
const dns = require('dns').promises
const net = require('net')

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a >= 224)
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase()
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
  }
  return true
}

async function validatePublicUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('Invalid source URL') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Source URL must use HTTP or HTTPS')
  if (url.username || url.password) throw new Error('Source URL cannot contain credentials')
  const addresses = await dns.lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new Error('Source URL resolves to a private or unsafe address')
  return url
}

async function fingerprint(response, finalUrl) {
  const hash = crypto.createHash('sha256')
  hash.update([
    finalUrl,
    response.headers.get('etag') || '',
    response.headers.get('last-modified') || '',
    response.headers.get('content-length') || ''
  ].join('|'))
  const reader = response.body?.getReader()
  let remaining = 65536
  try {
    while (reader && remaining > 0) {
      const { done, value } = await reader.read()
      if (done) break
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value
      hash.update(slice)
      remaining -= slice.byteLength
    }
  } finally {
    try { await reader?.cancel() } catch {}
  }
  return hash.digest('hex')
}

async function fetchWithSafeRedirects(sourceUrl, method = 'HEAD', maxRedirects = 5) {
  let current = await validatePublicUrl(sourceUrl)
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const response = await fetch(current, {
      method,
      redirect: 'manual',
      headers: method === 'GET'
        ? { 'User-Agent': 'ProposalReview-SourceMonitor/1.0', Range: 'bytes=0-1023' }
        : { 'User-Agent': 'ProposalReview-SourceMonitor/1.0' },
      signal: AbortSignal.timeout(15000)
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) return { response, finalUrl: current.toString() }
      current = await validatePublicUrl(new URL(location, current).toString())
      continue
    }
    return { response, finalUrl: current.toString() }
  }
  throw new Error('Too many redirects')
}

async function checkSourceUrl(sourceUrl, previousHealth = null) {
  const checkedAt = new Date().toISOString()
  if (!sourceUrl?.trim()) return { status: 'missing_url', checkedAt, httpStatus: null, finalUrl: null, error: 'No source URL is configured.', contentFingerprint: null, changed: false }
  try {
    const result = await fetchWithSafeRedirects(sourceUrl.trim(), 'GET')
    const contentFingerprint = await fingerprint(result.response, result.finalUrl)
    const changed = !!previousHealth?.contentFingerprint && previousHealth.contentFingerprint !== contentFingerprint
    const ok = result.response.status >= 200 && result.response.status < 400
    return {
      status: ok ? (changed ? 'changed' : 'healthy') : 'broken',
      checkedAt,
      httpStatus: result.response.status,
      finalUrl: result.finalUrl,
      error: ok ? null : `Source returned HTTP ${result.response.status}.`,
      contentFingerprint,
      changed
    }
  } catch (error) {
    return { status: 'broken', checkedAt, httpStatus: null, finalUrl: null, error: error.message, contentFingerprint: previousHealth?.contentFingerprint || null, changed: false }
  }
}

function mergeHealth(previous, next) {
  if (previous?.status === 'changed' && !previous.acknowledgedAt && next.status === 'healthy') {
    return {
      ...next,
      status: 'changed',
      changed: true,
      error: previous.error || 'The source content or destination changed since the prior check.',
      firstDetectedAt: previous.firstDetectedAt || previous.checkedAt,
      acknowledgedAt: null,
      acknowledgedById: null
    }
  }
  const alerting = next.status !== 'healthy'
  const sameIssue = previous?.status === next.status && previous?.error === next.error && previous?.httpStatus === next.httpStatus
  return {
    ...next,
    firstDetectedAt: alerting ? (sameIssue ? previous.firstDetectedAt : next.checkedAt) : null,
    acknowledgedAt: alerting && sameIssue ? (previous.acknowledgedAt || null) : null,
    acknowledgedById: alerting && sameIssue ? (previous.acknowledgedById || null) : null
  }
}

module.exports = { checkSourceUrl, fetchWithSafeRedirects, isPrivateAddress, mergeHealth, validatePublicUrl }
