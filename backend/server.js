const express = require('express')
require('express-async-errors')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { aiConfiguration, checkConnection, retrieveBackgroundStructuredResponse, startBackgroundStructuredResponse, structuredResponse, embedTexts } = require('./openai')
const { buildMatrix } = require('./compliance')
const { RESEARCH_DOMAINS, buildSourceStatus, matchingDocuments, researchDocuments } = require('./source-context')
const { SOURCE_CATEGORIES, SOURCE_CATEGORY_KEYS, categoryDefinition, documentCategory } = require('./source-catalog')
const { checkSourceUrl, mergeHealth } = require('./source-health')
const {
  configuration: passwordResetConfiguration,
  ensureRecoveryIdentity, sendRecoveryEmail, verifyRecoveryToken, closeRecoverySession, tokenDigest
} = require('./password-reset')
const {
  cloud, UPLOADS_DIR: UPLOADS,
  readIndex, writeIndex, readProposal, writeProposal, deleteProposal,
  readStandards, writeStandards, upsertStandards, readUsers, writeUsers, readCompanies, writeCompanies,
  readInvites, writeInvites, writeAudit, readAudit,
  saveUpload, readUpload, deleteUpload, standardStoreKeys
} = require('./persistence')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

app.get('/api/health', (_req, res) => {
  const ai = aiConfiguration()
  res.json({
    ok: true,
    persistence: cloud ? 'supabase' : 'local',
    aiEnabled: ai.enabled,
    aiConfigured: ai.configured,
    aiModel: ai.model,
    webSearchEnabled: ai.webSearchEnabled,
    passwordResetConfigured: passwordResetConfiguration().configured
  })
})

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-please-set-JWT_SECRET-in-env'
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-please-set-JWT_SECRET-in-env') {
  throw new Error('JWT_SECRET must be set to a long, random value in production')
}

const SHARED_STANDARDS_KEY = '_shared'

// Record API usage and troubleshooting metadata without sensitive request content.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next()
  const startedAt = Date.now()
  let sessionUser = null
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (token) {
    try { sessionUser = jwt.verify(token, JWT_SECRET) } catch {}
  }
  res.on('finish', () => {
    void writeAudit({
      event: 'api_request',
      userId: req.user?.id || sessionUser?.id || null,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      isAiRequest: ['/api/proposals/:id/ai-review', '/api/proposals/:id/analyze-diagrams', '/api/proposals/:id/compliance-review']
        .some(pattern => pattern === req.route?.path)
    })
  })
  next()
})

// ── Auth middleware ──
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try { req.user = jwt.verify(token, JWT_SECRET); next() }
  catch { return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' }) }
}

// ── Multer ──
const storage = cloud ? multer.memoryStorage() : multer.diskStorage({
  destination: UPLOADS,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
})
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } })

// ── Section detection ──
function detectSections(text) {
  const lines = text.split('\n')
  const sections = []
  const isHeader = (line) => {
    const t = line.trim()
    if (!t || t.length > 120 || t.length < 3) return false
    if (/^\d+(\.\d+)*[\.\)]\s+\S/.test(t)) return true
    if (/^[A-Z][A-Z\s\-:\/]{3,60}$/.test(t) && !/[a-z]/.test(t) && /[A-Z]{2}/.test(t)) return true
    if (/^(SECTION|ARTICLE|CHAPTER|PART)\s+[\dIVX]/i.test(t)) return true
    if (/^[IVX]+\.\s+\S/.test(t)) return true
    return false
  }
  lines.forEach((line, idx) => {
    if (isHeader(line)) {
      sections.push({ id: crypto.randomUUID(), title: line.trim().slice(0, 100), startLine: idx, score: 'green', notes: '', statutes: [] })
    }
  })
  if (!sections.length) sections.push({ id: crypto.randomUUID(), title: 'Full Document', startLine: 0, score: 'green', notes: '', statutes: [] })
  return sections
}

const requirementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jurisdiction', 'projectScope', 'requirements'],
  properties: {
    jurisdiction: {
      type: 'object', additionalProperties: false,
      required: ['city', 'county', 'state', 'confidence', 'evidence'],
      properties: {
        city: { type: ['string', 'null'] }, county: { type: ['string', 'null'] },
        state: { type: ['string', 'null'] }, confidence: { type: 'number' }, evidence: { type: 'string' }
      }
    },
    projectScope: { type: 'array', items: { type: 'string' } },
    requirements: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['category', 'subject', 'description', 'valueType', 'value', 'unit', 'comparison', 'page', 'excerpt', 'definition', 'coordinateSystem', 'scoringRule', 'missingValueConvention'],
        properties: {
          category: { type: 'string' }, subject: { type: 'string' }, description: { type: 'string' },
          valueType: { type: 'string', enum: ['number', 'text'] },
          value: { type: ['number', 'string'] }, unit: { type: ['string', 'null'] },
          comparison: { type: 'string', enum: ['max', 'min', 'exact'] },
          page: { type: ['integer', 'null'] }, excerpt: { type: 'string' },
          definition: { type: ['string', 'null'] }, coordinateSystem: { type: ['string', 'null'] },
          scoringRule: { type: ['string', 'null'] }, missingValueConvention: { type: ['string', 'null'] }
        }
      }
    }
  }
}

const catalogComparisonSchema = {
  type: 'object', additionalProperties: false,
  required: ['jurisdiction', 'projectScope', 'matrix', 'missingSources'],
  properties: {
    jurisdiction: requirementSchema.properties.jurisdiction,
    projectScope: requirementSchema.properties.projectScope,
    matrix: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['subject', 'requirement', 'cityStandard', 'siteRequirement', 'proposalValue', 'controllingValue', 'result', 'reason', 'recommendedCorrection', 'source'], properties: {
      subject: { type: 'string' }, requirement: { type: 'string' }, cityStandard: { type: ['string', 'null'] }, siteRequirement: { type: ['string', 'null'] }, proposalValue: { type: ['string', 'null'] }, controllingValue: { type: ['string', 'null'] }, result: { type: 'string', enum: ['pass', 'fail', 'review'] }, reason: { type: 'string' }, recommendedCorrection: { type: 'string' },
      source: { type: ['object', 'null'], additionalProperties: false, required: ['title', 'url', 'page', 'excerpt', 'authorityLevel', 'documentStatus'], properties: { title: { type: 'string' }, url: { type: 'string' }, page: { type: ['integer', 'null'] }, excerpt: { type: 'string' }, authorityLevel: { type: 'string' }, documentStatus: { type: 'string' } } }
    }}},
    missingSources: { type: 'array', items: { type: 'string' } }
  }
}

const SOURCE_TAXONOMY_TEXT = SOURCE_CATEGORIES
  .map(category => `${category.label}: ${category.description}`)
  .join('\n')

function researchDomainsForDocuments(documents) {
  const domains = [...RESEARCH_DOMAINS]
  for (const doc of documents) {
    if (!doc.sourceUrl || (doc.sensitivity || 'public') === 'restricted') continue
    try { domains.push(new URL(doc.sourceUrl).hostname) } catch {}
  }
  return [...new Set(domains)].slice(0, 100)
}

function sourceForCatalogPrompt(doc) {
  return {
    title: doc.title,
    category: documentCategory(doc),
    url: doc.sourceUrl,
    jurisdiction: doc.jurisdiction,
    jurisdictionTier: doc.jurisdictionTier,
    authorityLevel: doc.authorityLevel,
    documentStatus: doc.documentStatus,
    notes: doc.notes
  }
}

function catalogComparisonRequest(proposal, catalogDocs, sourceStatus) {
  const stateSources = catalogDocs.filter(doc => doc.jurisdictionTier === 'state').map(sourceForCatalogPrompt)
  const citySources = catalogDocs.filter(doc => doc.jurisdictionTier === 'city').map(sourceForCatalogPrompt)
  return {
    name: 'catalog_standards_comparison',
    schema: catalogComparisonSchema,
    instructions: `Assist a licensed civil engineer and public-procurement reviewer. Work in strict jurisdiction order: first identify applicable ${sourceStatus.jurisdiction.state} requirements, then apply only ${sourceStatus.jurisdiction.city} requirements. Do not research, cite, or apply another city, county, district, or private entity. Compare the submitted proposal only against the supplied jurisdiction-filtered sources and their directly linked official materials. Use this precedence: (1) addenda and written clarifications; (2) executed contract, special provisions, plans, and specifications; (3) solicitation and evaluation criteria; (4) the expressly incorporated municipal standards edition; (5) applicable law, permits, and funding rules; (6) adopted municipal code/plans/policies; (7) maps, portals, planning studies, and historical data. Never substitute the newest edition for the incorporated edition. Score only solicitation criteria. A pass or fail requires a proposal passage and a verified controlling requirement; otherwise return review. Treat hazards, GIS, groundwater, soils, environmental, and historical sources as screening unless confirmed by the responsible professional or agency. Never use protected-class data, political activity, personal information, restricted archaeology, or sensitive utility/security details. Every source URL must be one you actually inspected with web search.`,
    input: `PROPOSAL: ${proposal.name}\nCLIENT: ${proposal.company || ''}\nSTATE: ${sourceStatus.jurisdiction.state}\nCITY: ${sourceStatus.jurisdiction.city}\n\nPROPOSAL TEXT:\n${(proposal.text_content || '').slice(0, 150000)}\n\nSTATE SOURCES (review first):\n${JSON.stringify(stateSources)}\n\n${sourceStatus.jurisdiction.city.toUpperCase()} SOURCES (review second):\n${JSON.stringify(citySources)}`,
    maxOutputTokens: 10000,
    webSearchDomains: researchDomainsForDocuments(catalogDocs)
  }
}

function completedCatalogReview(researched, sourceStatus) {
  const verifiedUrls = new Set(researched.sources.map(source => source.url))
  const matrix = researched.data.matrix.map((row, index) => {
    const sourceVerified = !row.source || verifiedUrls.has(row.source.url)
    return {
      id: `catalog-${index + 1}`,
      ...row,
      result: sourceVerified ? row.result : 'review',
      reason: sourceVerified ? row.reason : `${row.reason} Citation could not be verified in the API response; engineer review required.`,
      source: sourceVerified ? row.source : null
    }
  })
  const summary = { pass: matrix.filter(row => row.result === 'pass').length, fail: matrix.filter(row => row.result === 'fail').length, review: matrix.filter(row => row.result === 'review').length }
  return { ...researched.data, matrix, summary, sourceStatus, matchedDocumentIds: [], webSources: researched.sources, generatedAt: new Date().toISOString(), openai: { responseId: researched.responseId, model: researched.model }, decisionPolicy: `Jurisdiction-filtered catalog screening: ${sourceStatus.jurisdiction.state} first, then ${sourceStatus.jurisdiction.city}; other cities and counties excluded. Only verified, project-applicable controlling sources may support pass/fail. Final approval remains with the responsible engineer.` }
}

async function extractRequirements(text, context) {
  return structuredResponse({
    name: 'civil_engineering_requirements',
    schema: requirementSchema,
    instructions: `You extract explicit civil-engineering, procurement, contract, permitting, cost, schedule, qualification, and project requirements or submitted values. Never invent values. "max" means the submitted value must be greater than or equal to the requirement (minimum depth, thickness, strength, compaction, diameter). "min" means it must be less than or equal (maximum slope, maximum spacing). "exact" is categorical or exact. Preserve units, coordinate systems, defined terms, scoring rules, and missing-value conventions. Page numbers must come from visible page markers; otherwise null. Excerpts must be short verbatim evidence. Evaluate the document against this source taxonomy:\n${SOURCE_TAXONOMY_TEXT}`,
    input: `${context}\n\nDOCUMENT:\n${text.slice(0, 180000)}`,
    maxOutputTokens: 12000
  })
}

async function addRequirementEmbeddings(requirements) {
  const texts = requirements.map(x => [x.category, x.subject, x.description, x.value, x.unit].filter(Boolean).join(' | '))
  const vectors = await embedTexts(texts)
  return requirements.map((rule, index) => ({ ...rule, embedding: vectors[index] }))
}

// ═══════════════════════════════════════════════
// ── PUBLIC AUTH ROUTES (no token required) ──
// ═══════════════════════════════════════════════

app.post('/api/auth/dev-login', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' })
  const companies = await readCompanies()
  let company = companies.find(c => c.id === 'local-preview-company')
  if (!company) {
    company = { id: 'local-preview-company', name: 'Local Preview Company', created_at: new Date().toISOString() }
    companies.push(company); await writeCompanies(companies)
  }
  const users = await readUsers()
  let user = users.find(u => u.id === 'local-preview-user')
  if (!user) {
    user = {
      id: 'local-preview-user',
      name: 'Local Reviewer',
      email: 'reviewer@localhost',
      role: 'manager',
      companyId: company.id,
      companyName: company.name,
      created_at: new Date().toISOString()
    }
    users.push(user); await writeUsers(users)
  }
  const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, companyName: user.companyName }
  const token = jwt.sign(publicUser, JWT_SECRET, { expiresIn: '1d' })
  res.json({ token, user: publicUser })
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, companyName, inviteToken } = req.body
    if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Name, email, and password are required' })
    if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' })

    const users = await readUsers()
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }

    // Passwords are deliberately hashed (not reversibly encrypted) and never stored or logged.
    const passwordHash = await bcrypt.hash(password, 12)
    let companies = await readCompanies()
    let invites = await readInvites()
    const invite = inviteToken
      ? invites.find(i => i.token === inviteToken && i.email === email.toLowerCase().trim() && !i.accepted_at)
      : null
    let company
    if (invite) {
      company = companies.find(c => c.id === invite.companyId)
      if (!company) return res.status(400).json({ error: 'This company invitation is no longer valid' })
    } else {
      const resolvedName = companyName?.trim() || `${name.trim()}'s Company`
      company = { id: crypto.randomUUID(), name: resolvedName, created_at: new Date().toISOString() }
      companies.push(company)
      await writeCompanies(companies)
    }
    const user = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: invite ? invite.role : 'manager',
      companyId: company.id,
      companyName: company.name,
      created_at: new Date().toISOString()
    }
    users.push(user)
    await writeUsers(users)
    if (invite) {
      invite.accepted_at = new Date().toISOString()
      await writeInvites(invites)
    }
    await writeAudit({ event: 'account_created', userId: user.id })

    const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, companyName: user.companyName }
    const token = jwt.sign(publicUser, JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: publicUser })
  } catch (e) {
    console.error('Register error:', e)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

    const users = await readUsers()
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim())
    if (!user) {
      await writeAudit({ event: 'login_failed', userId: null })
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      await writeAudit({ event: 'login_failed', userId: user.id })
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Migrate older accounts into a private company without exposing existing data to new accounts.
    if (!user.companyId) {
      const companies = await readCompanies()
      const company = { id: crypto.randomUUID(), name: `${user.name}'s Company`, created_at: new Date().toISOString() }
      companies.push(company); await writeCompanies(companies)
      user.companyId = company.id; user.companyName = company.name; await writeUsers(users)
      const idx = await readIndex()
      for (const p of idx) {
        if (!p.companyId) {
          p.companyId = company.id
          const proposal = await readProposal(p.id)
          if (proposal && !proposal.companyId) { proposal.companyId = company.id; await writeProposal(p.id, proposal) }
        }
      }
      await writeIndex(idx)
    }
    const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, companyName: user.companyName }
    const token = jwt.sign(publicUser, JWT_SECRET, { expiresIn: '7d' })
    await writeAudit({ event: 'login_succeeded', userId: user.id })
    res.json({ token, user: publicUser })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PASSWORD_RESET_RESPONSE = 'If an account exists for that email, a password-reset link has been sent.'
const passwordResetRequests = new Map()

function passwordResetRateLimited(req, email) {
  const key = crypto.createHash('sha256').update(`${req.ip || 'unknown'}|${email}`).digest('hex')
  const now = Date.now()
  const recent = (passwordResetRequests.get(key) || []).filter(timestamp => now - timestamp < 15 * 60 * 1000)
  if (recent.length >= 3) return true
  recent.push(now)
  passwordResetRequests.set(key, recent)
  if (passwordResetRequests.size > 1000) {
    for (const [candidate, timestamps] of passwordResetRequests) {
      if (!timestamps.some(timestamp => now - timestamp < 15 * 60 * 1000)) passwordResetRequests.delete(candidate)
    }
  }
  return false
}

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' })
  if (!passwordResetConfiguration().configured) return res.status(503).json({ error: 'Password reset email is not configured.' })
  if (passwordResetRateLimited(req, email)) return res.json({ message: PASSWORD_RESET_RESPONSE })

  try {
    const user = (await readUsers()).find(candidate => candidate.email.toLowerCase() === email)
    if (user) {
      await ensureRecoveryIdentity(email)
      await sendRecoveryEmail(email)
      await writeAudit({ event: 'password_reset_requested', userId: user.id })
    } else {
      await writeAudit({ event: 'password_reset_requested_unknown_email', userId: null })
    }
  } catch (error) {
    console.error('Password reset request failed:', error.message)
    await writeAudit({ event: 'password_reset_request_failed', userId: null, error: error.message })
  }
  res.json({ message: PASSWORD_RESET_RESPONSE })
})

app.post('/api/auth/reset-password', async (req, res) => {
  const accessToken = String(req.body?.accessToken || '')
  const password = String(req.body?.password || '')
  if (!accessToken) return res.status(400).json({ error: 'This password-reset link is missing or invalid.' })
  if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters.' })
  if (Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Password must be 72 characters or fewer.' })

  try {
    const recoveryUser = await verifyRecoveryToken(accessToken)
    if (!recoveryUser?.email) return res.status(401).json({ error: 'This password-reset link is invalid or expired. Request a new link.' })
    const users = await readUsers()
    const user = users.find(candidate => candidate.email.toLowerCase() === recoveryUser.email.toLowerCase())
    if (!user) return res.status(401).json({ error: 'This password-reset link is invalid or expired. Request a new link.' })
    const digest = tokenDigest(accessToken)
    if (user.lastPasswordResetTokenHash === digest) return res.status(409).json({ error: 'This password-reset link has already been used. Request a new link.' })

    user.passwordHash = await bcrypt.hash(password, 12)
    user.lastPasswordResetTokenHash = digest
    user.passwordChangedAt = new Date().toISOString()
    await writeUsers(users)
    await closeRecoverySession(accessToken)
    await writeAudit({ event: 'password_reset_completed', userId: user.id })
    res.json({ message: 'Your password has been updated. You can now sign in.' })
  } catch (error) {
    console.error('Password reset failed:', error.message)
    res.status(500).json({ error: 'Unable to reset the password right now. Please request a new link and try again.' })
  }
})

// ═══════════════════════════════════════════════
// ── PROTECTED ROUTES (token required) ──
// ═══════════════════════════════════════════════
app.get('/api/cron/source-health', async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  await runScheduledSourceHealthChecks()
  res.json({ success: true, checkedAt: new Date().toISOString() })
})

app.use(requireAuth)

async function currentUser(req) {
  return (await readUsers()).find(u => u.id === req.user.id)
}
async function companyList(req) {
  const user = await currentUser(req)
  return (await readIndex()).filter(p => p.companyId === user?.companyId)
}
async function canAccess(req, proposal) {
  const user = await currentUser(req)
  return !!user && proposal?.companyId === user.companyId
}
function isAdmin(user) {
  return ['manager', 'admin'].includes(user?.role)
}
async function readAccessibleStandards(req) {
  const user = await currentUser(req)
  const shared = (await readStandards(SHARED_STANDARDS_KEY))
    .filter(doc => (doc.sensitivity || 'public') !== 'restricted')
    .map(doc => ({ ...doc, visibility: 'shared' }))
  const organization = (await readStandards(user?.companyId))
    .filter(doc => (doc.sensitivity || 'public') !== 'restricted' || isAdmin(user))
    .map(doc => ({ ...doc, visibility: 'organization' }))
  return [...shared, ...organization]
}
async function readAnalysisStandards(req) {
  return (await readAccessibleStandards(req)).filter(doc => (doc.sensitivity || 'public') !== 'restricted')
}
async function standardsStoresForAdmin(user) {
  return [
    { key: SHARED_STANDARDS_KEY, visibility: 'shared', documents: await readStandards(SHARED_STANDARDS_KEY) },
    { key: user.companyId, visibility: 'organization', documents: await readStandards(user.companyId) }
  ]
}
async function locateStandardsDocument(user, documentId) {
  for (const store of await standardsStoresForAdmin(user)) {
    const doc = store.documents.find(item => item.id === documentId)
    if (doc) return { ...store, doc }
  }
  return null
}
function publicDocument(doc, visibility = doc.visibility || 'organization') {
  const { textContent, filePath, ...safe } = doc
  return { ...safe, visibility, sourceCategory: documentCategory(doc) }
}
function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}
function errorStatus(error) {
  return Number.isInteger(error?.statusCode) ? error.statusCode : 500
}

// ── Standards and site-document library ──
app.get('/api/standards', async (req, res) => {
  res.json((await readAccessibleStandards(req)).map(doc => publicDocument(doc, doc.visibility)))
})

app.get('/api/source-categories', (_req, res) => {
  res.json(SOURCE_CATEGORIES)
})

app.get('/api/admin/ai-status', async (req, res) => {
  const user = await currentUser(req)
  if (!isAdmin(user)) return res.status(403).json({ error: 'Administrator access required' })
  res.json(await checkConnection())
})

app.get('/api/proposals/:id/analysis-sources', async (req, res) => {
  const proposal = await readProposal(req.params.id)
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' })
  if (!await canAccess(req, proposal)) return res.status(403).json({ error: 'Access denied' })
  res.json(buildSourceStatus(await readAnalysisStandards(req), proposal))
})

app.post('/api/standards', upload.single('file'), async (req, res) => {
  try {
    const user = await currentUser(req)
    const sourceUrl = req.body.sourceUrl?.trim() || ''
    if (!req.file && !sourceUrl) return res.status(400).json({ error: 'A PDF/text file or source URL is required' })
    if (sourceUrl && !isHttpUrl(sourceUrl)) return res.status(400).json({ error: 'Source URL must be a valid HTTP or HTTPS URL' })
    const sourceCategory = SOURCE_CATEGORY_KEYS.includes(req.body.sourceCategory) ? req.body.sourceCategory : 'city_engineering'
    const sensitivity = req.body.sensitivity === 'restricted' ? 'restricted' : 'public'
    const requestedVisibility = req.body.visibility === 'shared' ? 'shared' : 'organization'
    if (requestedVisibility === 'shared' && !isAdmin(user)) return res.status(403).json({ error: 'Only administrators can publish shared standards' })
    if (requestedVisibility === 'shared' && sensitivity === 'restricted') return res.status(400).json({ error: 'Restricted infrastructure data cannot be published to the shared catalog' })
    let textContent = ''
    const fileBuffer = req.file ? (req.file.buffer || fs.readFileSync(req.file.path)) : null
    if (req.file?.mimetype === 'application/pdf') {
      const parsed = await require('pdf-parse')(fileBuffer)
      textContent = parsed.text
    } else if (req.file) {
      textContent = fileBuffer.toString('utf8')
    }
    const storeKey = requestedVisibility === 'shared' ? SHARED_STANDARDS_KEY : user.companyId
    const docs = await readStandards(storeKey)
    const documentId = crypto.randomUUID()
    const savedFile = await saveUpload(req.file, user.companyId, `standard-${documentId}`)
    const doc = {
      id: documentId,
      title: req.body.title?.trim() || req.file?.originalname || sourceUrl,
      documentType: req.body.documentType || 'city_standard',
      sourceCategory,
      jurisdiction: req.body.jurisdiction?.trim() || '',
      client: req.body.client?.trim() || '',
      projectTypes: (req.body.projectTypes || '').split(',').map(x => x.trim()).filter(Boolean),
      effectiveDate: req.body.effectiveDate || null,
      sourceUrl,
      visibility: requestedVisibility,
      sensitivity,
      originalName: req.file?.originalname || null,
      filePath: savedFile?.path || null,
      fileStorage: savedFile?.storage || null,
      fileContentType: savedFile?.contentType || null,
      textContent,
      requirements: [],
      extractionStatus: textContent ? 'pending' : 'url_only',
      health: mergeHealth(null, sourceUrl
        ? { status: 'unchecked', checkedAt: null, httpStatus: null, finalUrl: null, error: null, contentFingerprint: null, changed: false }
        : { status: 'missing_url', checkedAt: new Date().toISOString(), httpStatus: null, finalUrl: null, error: 'No source URL is configured.', contentFingerprint: null, changed: false }),
      createdAt: new Date().toISOString(),
      createdById: req.user.id,
      createdByCompanyId: user.companyId
    }
    docs.push(doc); await writeStandards(storeKey, docs)
    res.json(publicDocument(doc, requestedVisibility))
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message })
  }
})

app.post('/api/standards/:documentId/extract', async (req, res) => {
  try {
    const user = await currentUser(req)
    const located = await locateStandardsDocument(user, req.params.documentId)
    if (!located) return res.status(404).json({ error: 'Document not found' })
    if (located.visibility === 'shared' && !isAdmin(user)) return res.status(403).json({ error: 'Only administrators can update shared standards' })
    const { doc } = located
    if (!doc.textContent) return res.status(400).json({ error: 'This URL-only source has no document text. Attach a PDF or text copy before extracting requirements.' })
    const category = categoryDefinition(documentCategory(doc))
    const extracted = await extractRequirements(doc.textContent, `SOURCE CATEGORY: ${category?.label || doc.documentType}\nSOURCE TYPE: ${doc.documentType}\nTITLE: ${doc.title}\nJURISDICTION: ${doc.jurisdiction}`)
    const embedded = await addRequirementEmbeddings(extracted.data.requirements)
    doc.requirements = embedded.map(rule => ({ ...rule, documentId: doc.id }))
    doc.detectedJurisdiction = extracted.data.jurisdiction
    doc.projectScope = extracted.data.projectScope
    doc.extractionStatus = 'complete'
    doc.extractedAt = new Date().toISOString()
    doc.openai = { responseId: extracted.responseId, model: extracted.model }
    await writeStandards(located.key, located.documents)
    res.json(publicDocument(doc, located.visibility))
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message })
  }
})

app.patch('/api/standards/:documentId', async (req, res) => {
  const user = await currentUser(req)
  if (!isAdmin(user)) return res.status(403).json({ error: 'Administrator access required' })
  const located = await locateStandardsDocument(user, req.params.documentId)
  if (!located) return res.status(404).json({ error: 'Document not found' })
  if (req.body.sourceUrl?.trim() && !isHttpUrl(req.body.sourceUrl.trim())) return res.status(400).json({ error: 'Source URL must be a valid HTTP or HTTPS URL' })
  const allowed = ['title', 'jurisdiction', 'client', 'sourceUrl', 'sourceCategory']
  for (const key of allowed) {
    if (req.body[key] === undefined) continue
    if (key === 'sourceCategory' && !SOURCE_CATEGORY_KEYS.includes(req.body[key])) return res.status(400).json({ error: 'Unknown source category' })
    located.doc[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key]
  }
  if (req.body.sourceUrl !== undefined) {
    located.doc.health = req.body.sourceUrl?.trim()
      ? mergeHealth(null, { status: 'unchecked', checkedAt: null, httpStatus: null, finalUrl: null, error: 'This source has not been checked yet.', contentFingerprint: null, changed: false })
      : mergeHealth(null, { status: 'missing_url', checkedAt: new Date().toISOString(), httpStatus: null, finalUrl: null, error: 'No source URL is configured.', contentFingerprint: null, changed: false })
  }
  located.doc.updatedAt = new Date().toISOString()
  await writeStandards(located.key, located.documents)
  await writeAudit({ event: 'source_metadata_updated', userId: user.id, documentId: located.doc.id })
  res.json(publicDocument(located.doc, located.visibility))
})

app.delete('/api/standards/:documentId', async (req, res) => {
  const user = await currentUser(req)
  const located = await locateStandardsDocument(user, req.params.documentId)
  if (!located) return res.status(404).json({ error: 'Document not found' })
  if (located.visibility === 'shared' && !isAdmin(user)) return res.status(403).json({ error: 'Only administrators can remove shared standards' })
  const { doc } = located
  await deleteUpload(doc.filePath, doc.fileStorage)
  await writeStandards(located.key, located.documents.filter(x => x.id !== doc.id))
  res.json({ success: true })
})

function effectiveHealth(doc) {
  if (doc.health) return doc.health
  return doc.sourceUrl
    ? { status: 'unchecked', checkedAt: null, httpStatus: null, finalUrl: null, error: 'This source has not been checked yet.', changed: false, acknowledgedAt: null }
    : { status: 'missing_url', checkedAt: null, httpStatus: null, finalUrl: null, error: 'No source URL is configured.', changed: false, acknowledgedAt: null }
}

async function healthPayload(user) {
  const sources = (await standardsStoresForAdmin(user)).flatMap(store => store.documents.map(doc => ({
    ...publicDocument(doc, store.visibility),
    health: effectiveHealth(doc)
  })))
  const notifications = sources
    .filter(source => ['broken', 'changed', 'missing_url'].includes(source.health.status) && !source.health.acknowledgedAt)
    .map(source => ({
      id: `${source.id}:${source.health.status}`,
      documentId: source.id,
      title: source.title,
      visibility: source.visibility,
      sourceCategory: source.sourceCategory,
      severity: source.health.status === 'broken' ? 'critical' : 'warning',
      type: source.health.status,
      message: source.health.error || (source.health.status === 'changed' ? 'The source headers or destination changed since the last successful check.' : 'Source requires attention.'),
      detectedAt: source.health.firstDetectedAt || source.health.checkedAt || source.createdAt
    }))
  const counts = { healthy: 0, broken: 0, changed: 0, missing_url: 0, unchecked: 0 }
  for (const source of sources) counts[source.health.status] = (counts[source.health.status] || 0) + 1
  return { counts, notificationCount: notifications.length, notifications, sources, categories: SOURCE_CATEGORIES }
}

async function checkStandardsStore(storeKey, documentIds = null, limit = null) {
  const documents = await readStandards(storeKey)
  let targets = documentIds ? documents.filter(doc => documentIds.includes(doc.id)) : [...documents]
  targets.sort((a, b) => String(effectiveHealth(a).checkedAt || '').localeCompare(String(effectiveHealth(b).checkedAt || '')))
  if (limit) targets = targets.slice(0, limit)
  const checks = await Promise.all(targets.map(doc => checkSourceUrl(doc.sourceUrl, effectiveHealth(doc))))
  targets.forEach((doc, index) => { doc.health = mergeHealth(effectiveHealth(doc), checks[index]) })
  await upsertStandards(storeKey, targets)
  return targets.length
}

app.get('/api/admin/source-health', async (req, res) => {
  const user = await currentUser(req)
  if (!isAdmin(user)) return res.status(403).json({ error: 'Administrator access required' })
  res.json(await healthPayload(user))
})

app.post('/api/admin/source-health/check', async (req, res) => {
  const user = await currentUser(req)
  if (!isAdmin(user)) return res.status(403).json({ error: 'Administrator access required' })
  try {
    const requestedId = req.body.documentId || null
    let checked = 0
    for (const store of await standardsStoresForAdmin(user)) {
      checked += await checkStandardsStore(store.key, requestedId ? [requestedId] : null, requestedId ? null : Math.max(0, 12 - checked))
      if (!requestedId && checked >= 12) break
    }
    await writeAudit({ event: 'source_health_check', userId: user.id, checked })
    res.json({ checked, ...await healthPayload(user) })
  } catch (error) {
    res.status(errorStatus(error)).json({ error: error.message })
  }
})

app.post('/api/admin/source-health/:documentId/acknowledge', async (req, res) => {
  const user = await currentUser(req)
  if (!isAdmin(user)) return res.status(403).json({ error: 'Administrator access required' })
  const located = await locateStandardsDocument(user, req.params.documentId)
  if (!located) return res.status(404).json({ error: 'Source not found' })
  const current = effectiveHealth(located.doc)
  located.doc.health = { ...current, acknowledgedAt: new Date().toISOString(), acknowledgedById: user.id }
  await writeStandards(located.key, located.documents)
  await writeAudit({ event: 'source_health_acknowledged', userId: user.id, documentId: located.doc.id })
  res.json({ success: true })
})

app.get('/api/auth/me', async (req, res) => {
  const users = await readUsers()
  const user = users.find(u => u.id === req.user.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, companyName: user.companyName })
})

app.get('/api/company', async (req, res) => {
  const user = await currentUser(req)
  const company = (await readCompanies()).find(c => c.id === user?.companyId)
  const members = (await readUsers()).filter(u => u.companyId === user?.companyId).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
  const invites = (await readInvites()).filter(i => i.companyId === user?.companyId && !i.accepted_at).map(({ token, ...i }) => i)
  res.json({ company, members, invites })
})

app.post('/api/company/invites', async (req, res) => {
  const user = await currentUser(req)
  if (user?.role !== 'manager') return res.status(403).json({ error: 'Only company managers can invite members' })
  const email = req.body.email?.toLowerCase().trim()
  if (!email) return res.status(400).json({ error: 'Email is required' })
  if ((await readUsers()).some(u => u.email === email)) return res.status(409).json({ error: 'That email already has an account' })
  const invites = await readInvites()
  const existing = invites.find(i => i.companyId === user.companyId && i.email === email && !i.accepted_at)
  if (existing) return res.json({ success: true, inviteToken: existing.token })
  const invite = { id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('hex'), companyId: user.companyId, email, role: 'reviewer', invitedById: user.id, created_at: new Date().toISOString() }
  invites.push(invite); await writeInvites(invites)
  res.json({ success: true, inviteToken: invite.token })
})

app.get('/api/clients', async (req, res) => {
  const clients = [...new Set((await companyList(req)).map(p => p.company).filter(Boolean))].sort()
  res.json(clients)
})

app.get('/api/profile/usage', async (req, res) => {
  const now = Date.now()
  const requests = (await readAudit())
    .filter(entry => entry.event === 'api_request' && entry.userId === req.user.id)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  const since = days => requests.filter(entry => now - new Date(entry.timestamp).getTime() < days * 86400000)
  const summarize = entries => ({
    requests: entries.length,
    aiRequests: entries.filter(entry => entry.isAiRequest).length,
    errors: entries.filter(entry => entry.status >= 400).length
  })
  const endpointCounts = {}
  requests.forEach(entry => {
    const key = `${entry.method} ${entry.path}`
    endpointCounts[key] = (endpointCounts[key] || 0) + 1
  })
  const topEndpoints = Object.entries(endpointCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([endpoint, count]) => ({ endpoint, count }))

  res.json({
    totals: summarize(requests),
    today: summarize(since(1)),
    last7Days: summarize(since(7)),
    last30Days: summarize(since(30)),
    topEndpoints,
    recent: requests.slice(0, 30)
  })
})

// List all users (for assignment dropdown)
app.get('/api/users', async (req, res) => {
  const me = await currentUser(req)
  const users = (await readUsers()).filter(u => u.companyId === me?.companyId).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
  res.json(users)
})

// My workload: proposals assigned to me + unassigned ones I can pick up
app.get('/api/me/proposals', async (req, res) => {
  const userId = req.user.id
  const list = await companyList(req)
  const mine = list.filter(p => p.assignedToId === userId)
  const available = list.filter(p => !p.assignedToId && !['accepted', 'rejected'].includes(p.status))
  const recent = [...list].filter(p => p.assignedToId !== userId).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 10)

  const statusCounts = {}
  mine.forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1 })

  res.json({ mine, available, recent, statusCounts })
})

// ── Proposals ──
app.get('/api/proposals', async (req, res) => {
  const { search, status, location, company, assignedToId } = req.query
  let list = await companyList(req)
  if (search) { const q = search.toLowerCase(); list = list.filter(p => [p.name, p.company, p.location].some(v => (v || '').toLowerCase().includes(q))) }
  if (status) list = list.filter(p => p.status === status)
  if (location) list = list.filter(p => (p.location || '').toLowerCase().includes(location.toLowerCase()))
  if (company) list = list.filter(p => (p.company || '').toLowerCase().includes(company.toLowerCase()))
  if (assignedToId) list = list.filter(p => p.assignedToId === assignedToId)
  list.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  res.json(list)
})

app.use('/api/proposals/:id', async (req, res, next) => {
  const proposal = await readProposal(req.params.id)
  if (!proposal) return res.status(404).json({ error: 'Not found' })
  if (!await canAccess(req, proposal)) return res.status(403).json({ error: 'Access denied' })
  next()
})

app.get('/api/proposals/:id', async (req, res) => {
  const p = await readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  if (!await canAccess(req, p)) return res.status(403).json({ error: 'Access denied' })
  res.json(p)
})

app.post('/api/proposals', upload.single('file'), async (req, res) => {
  try {
    const { name, company, location } = req.body
    if (!name) return res.status(400).json({ error: 'Name required' })
    const id = crypto.randomUUID()
    const user = await currentUser(req)
    let text = req.body.text_content || ''
    let filePath = null
    let fileStorage = null
    let fileContentType = null

    if (req.file) {
      const fileBuffer = req.file.buffer || fs.readFileSync(req.file.path)
      if (req.file.mimetype === 'application/pdf') {
        try { const d = await require('pdf-parse')(fileBuffer); text = d.text }
        catch { text = '[PDF uploaded — text extraction unavailable. Add sections manually.]' }
      } else { text = fileBuffer.toString('utf8') }
      const savedFile = await saveUpload(req.file, user.companyId, id)
      filePath = savedFile.path
      fileStorage = savedFile.storage
      fileContentType = savedFile.contentType
    }

    const now = new Date().toISOString()
    const proposal = {
      id, name, company: company || '', location: location || '',
      status: 'pending', file_path: filePath, file_storage: fileStorage, file_content_type: fileContentType, text_content: text,
      sections: detectSections(text), highlights: [],
      createdById: req.user.id, createdByName: req.user.name, companyId: user?.companyId,
      created_at: now, updated_at: now
    }
    await writeProposal(id, proposal)
    const idx = await readIndex()
    idx.push({ id, name, company: proposal.company, location: proposal.location, status: proposal.status, companyId: proposal.companyId, created_at: now, updated_at: now })
    await writeIndex(idx)
    res.json({ id, sections: proposal.sections })
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }) }
})

app.put('/api/proposals/:id', async (req, res) => {
  const p = await readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  const allowed = ['name', 'company', 'location', 'status', 'sections', 'highlights', 'diagramAnalysis', 'assignedTo', 'assignedToId', 'dueDate', 'priority']
  for (const k of allowed) { if (req.body[k] !== undefined) p[k] = req.body[k] }
  p.updated_at = new Date().toISOString()
  await writeProposal(req.params.id, p)
  const idx = (await readIndex()).map(i => i.id === req.params.id
    ? { ...i, name: p.name, company: p.company, location: p.location, status: p.status, assignedTo: p.assignedTo || '', assignedToId: p.assignedToId || '', dueDate: p.dueDate || '', priority: p.priority || '', updated_at: p.updated_at }
    : i)
  await writeIndex(idx)
  res.json({ success: true })
})

app.delete('/api/proposals/:id', async (req, res) => {
  const p = await readProposal(req.params.id)
  await Promise.all([
    deleteUpload(p?.file_path, p?.file_storage),
    ...(p?.versions || []).map(version => deleteUpload(version.file_path, version.file_storage))
  ])
  await deleteProposal(req.params.id)
  await writeIndex((await readIndex()).filter(i => i.id !== req.params.id))
  res.json({ success: true })
})

app.post('/api/proposals/:id/sections', async (req, res) => {
  const p = await readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  const sec = { id: crypto.randomUUID(), title: req.body.title || 'New Section', startLine: req.body.startLine ?? 0, score: 'green', notes: '', statutes: [] }
  p.sections.push(sec)
  p.updated_at = new Date().toISOString()
  await writeProposal(req.params.id, p)
  await writeIndex((await readIndex()).map(i => i.id === req.params.id ? { ...i, updated_at: p.updated_at } : i))
  res.json(sec)
})

// ── Serve proposal file (token accepted as query param for iframe) ──
app.get('/api/proposals/:id/file', async (req, res) => {
  const p = await readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  let filePath
  const vIdx = req.query.version
  if (vIdx !== undefined && p.versions?.length) {
    const v = p.versions[parseInt(vIdx)]
    if (!v?.file_path) return res.status(404).json({ error: 'Version not found' })
    filePath = v.file_path
    var fileStorage = v.file_storage || p.file_storage
    var fileContentType = v.file_content_type || p.file_content_type
  } else {
    if (!p.file_path) return res.status(404).json({ error: 'No file attached' })
    filePath = p.file_path
    var fileStorage = p.file_storage
    var fileContentType = p.file_content_type
  }
  try {
    const contents = await readUpload(filePath, fileStorage)
    res.setHeader('Content-Type', fileContentType || 'application/pdf')
    res.setHeader('Content-Disposition', 'inline')
    res.send(contents)
  } catch {
    res.status(404).json({ error: 'File not found in storage' })
  }
})

// ── Upload new document version ──
app.post('/api/proposals/:id/versions', upload.single('file'), async (req, res) => {
  try {
    const p = await readProposal(req.params.id)
    if (!p) return res.status(404).json({ error: 'Not found' })
    if (!req.file) return res.status(400).json({ error: 'File required' })
    const versions = p.versions || []
    if (p.file_path) versions.push({ version: versions.length + 1, label: req.body.label || `v${versions.length + 1}`, file_path: p.file_path, file_storage: p.file_storage, file_content_type: p.file_content_type, uploaded_at: p.updated_at || p.created_at, uploadedById: req.user.id, uploadedByName: req.user.name })
    const fileBuffer = req.file.buffer || fs.readFileSync(req.file.path)
    let text = ''
    if (req.file.mimetype === 'application/pdf') {
      try { const d = await require('pdf-parse')(fileBuffer); text = d.text }
      catch { text = '[PDF uploaded — text extraction unavailable.]' }
    } else { text = fileBuffer.toString('utf8') }
    const now = new Date().toISOString()
    const savedFile = await saveUpload(req.file, p.companyId, p.id)
    p.file_path = savedFile.path; p.file_storage = savedFile.storage; p.file_content_type = savedFile.contentType
    p.text_content = text; p.versions = versions; p.updated_at = now
    if (req.body.resetSections === 'true') p.sections = detectSections(text)
    await writeProposal(req.params.id, p)
    await writeIndex((await readIndex()).map(i => i.id === req.params.id ? { ...i, updated_at: now } : i))
    res.json({ success: true, versionCount: versions.length + 1 })
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }) }
})

// ── Full deterministic compliance analysis ──
app.post('/api/proposals/:id/compliance-review', async (req, res) => {
  try {
    const p = await readProposal(req.params.id)
    if (!p) return res.status(404).json({ error: 'Proposal not found' })
    const allDocs = await readAnalysisStandards(req)
    const sourceStatus = buildSourceStatus(allDocs, p)
    if (!sourceStatus.jurisdiction.resolved) return res.status(400).json({
      error: 'Enter a specific city and state in the proposal location before running standards comparison. Broad multi-city research is not allowed.',
      sourceStatus
    })
    const docs = matchingDocuments(allDocs, p)
    const catalogDocs = researchDocuments(allDocs, p)
    if (!docs.length) {
      if (!catalogDocs.length) return res.status(400).json({ error: 'No extracted standards or relevant catalog sources are available for this proposal.', sourceStatus })
      if (process.env.AI_WEB_SEARCH_ENABLED !== 'true') {
        const error = new Error('No extracted standards match this proposal, and catalog research is disabled. Enable AI web research or upload and extract the controlling standards.')
        error.statusCode = 503
        throw error
      }
      if (p.complianceReviewJob && ['queued', 'in_progress'].includes(p.complianceReviewJob.status)) {
        return res.status(202).json({ status: p.complianceReviewJob.status, job: p.complianceReviewJob, sourceStatus })
      }
      const started = await startBackgroundStructuredResponse(catalogComparisonRequest(p, catalogDocs, sourceStatus))
      p.complianceReviewJob = {
        responseId: started.responseId,
        status: started.status,
        model: started.model,
        state: sourceStatus.jurisdiction.state,
        city: sourceStatus.jurisdiction.city,
        startedAt: new Date().toISOString()
      }
      p.updated_at = new Date().toISOString()
      await writeProposal(p.id, p)
      await writeAudit({ event: 'compliance_review_started', userId: req.user.id, proposalId: p.id, state: p.complianceReviewJob.state, city: p.complianceReviewJob.city })
      return res.status(202).json({ status: started.status, job: p.complianceReviewJob, sourceStatus })
    }

    const extracted = await extractRequirements(p.text_content || '', `PROPOSAL: ${p.name}\nCLIENT: ${p.company}\nSUBMITTED LOCATION: ${p.location}\nExtract submitted design values, not governing standards.`)
    const proposalRequirements = await addRequirementEmbeddings(extracted.data.requirements)
    const matrix = buildMatrix(proposalRequirements, docs)
    const summary = {
      pass: matrix.filter(x => x.result === 'pass').length,
      fail: matrix.filter(x => x.result === 'fail').length,
      review: matrix.filter(x => x.result === 'review').length
    }
    p.complianceReview = {
      jurisdiction: extracted.data.jurisdiction,
      projectScope: extracted.data.projectScope,
      proposalRequirements,
      matchedDocumentIds: docs.map(x => x.id),
      sourceStatus,
      matrix,
      summary,
      generatedAt: new Date().toISOString(),
      openai: { responseId: extracted.responseId, model: extracted.model },
      decisionPolicy: 'City/client baseline; site-specific source controls only when deterministically stricter; conflicts require engineer review.'
    }
    p.updated_at = new Date().toISOString()
    delete p.complianceReviewJob
    await writeProposal(p.id, p)
    res.json(p.complianceReview)
  } catch (error) {
    console.error('Compliance review error:', error.message)
    res.status(errorStatus(error)).json({ error: error.message })
  }
})

app.get('/api/proposals/:id/compliance-review/status', async (req, res) => {
  const p = await readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Proposal not found' })
  if (!p.complianceReviewJob) {
    if (p.complianceReview) return res.json(p.complianceReview)
    return res.status(404).json({ error: 'No structured comparison is currently running.' })
  }
  try {
    const allDocs = await readAnalysisStandards(req)
    const sourceStatus = buildSourceStatus(allDocs, p)
    if (p.complianceReviewJob.state !== sourceStatus.jurisdiction.state || p.complianceReviewJob.city !== sourceStatus.jurisdiction.city) {
      return res.status(409).json({ error: 'The proposal location changed while the comparison was running. Start a new comparison.', sourceStatus })
    }
    const researched = await retrieveBackgroundStructuredResponse(p.complianceReviewJob.responseId)
    if (['queued', 'in_progress'].includes(researched.status)) {
      if (p.complianceReviewJob.status !== researched.status) {
        p.complianceReviewJob.status = researched.status
        await writeProposal(p.id, p)
      }
      return res.status(202).json({ status: researched.status, job: p.complianceReviewJob, sourceStatus })
    }
    p.complianceReview = completedCatalogReview(researched, sourceStatus)
    delete p.complianceReviewJob
    p.updated_at = new Date().toISOString()
    await writeProposal(p.id, p)
    await writeAudit({ event: 'compliance_review_completed', userId: req.user.id, proposalId: p.id, state: sourceStatus.jurisdiction.state, city: sourceStatus.jurisdiction.city })
    res.json(p.complianceReview)
  } catch (error) {
    p.complianceReviewJob.status = 'failed'
    p.complianceReviewJob.error = error.message
    p.complianceReviewJob.failedAt = new Date().toISOString()
    await writeProposal(p.id, p)
    await writeAudit({ event: 'compliance_review_failed', userId: req.user.id, proposalId: p.id, error: error.message })
    res.status(502).json({ error: `Structured comparison failed: ${error.message}` })
  }
})

// ── Diagram analysis ──
app.post('/api/proposals/:id/analyze-diagrams', async (req, res) => {
  const p = await readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  if (!p.file_path) return res.status(400).json({ error: 'No PDF file attached' })
  let fileBuffer
  try { fileBuffer = await readUpload(p.file_path, p.file_storage) } catch { return res.status(404).json({ error: 'File not found' }) }
  if (fileBuffer.length > 25 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 25MB)' })

  try {
    const diagramSchema = {
      type: 'object', additionalProperties: false,
      required: ['summary', 'diagrams', 'overallCompliance', 'criticalIssues', 'recommendations', 'researchFindings'],
      properties: {
        summary: { type: 'string' },
        diagrams: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'description', 'location', 'concerns', 'positives', 'compliance', 'missingElements', 'codes'], properties: {
          type: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' },
          concerns: { type: 'array', items: { type: 'string' } }, positives: { type: 'array', items: { type: 'string' } },
          compliance: { type: 'string', enum: ['green', 'yellow', 'red'] },
          missingElements: { type: 'array', items: { type: 'string' } }, codes: { type: 'array', items: { type: 'string' } }
        }}},
        overallCompliance: { type: 'string', enum: ['green', 'yellow', 'red'] },
        criticalIssues: { type: 'array', items: { type: 'string' } },
        recommendations: { type: 'array', items: { type: 'string' } },
        researchFindings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['category', 'finding', 'sourceTitle', 'sourceUrl', 'confidence'], properties: {
          category: { type: 'string', enum: SOURCE_CATEGORY_KEYS },
          finding: { type: 'string' }, sourceTitle: { type: 'string' }, sourceUrl: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        }}}
      }
    }
    const allDocs = await readAnalysisStandards(req)
    const sourceStatus = buildSourceStatus(allDocs, p)
    if (!sourceStatus.jurisdiction.resolved) return res.status(400).json({
      error: 'Enter a specific city and state in the proposal location before analyzing the PDF. Broad multi-city research is not allowed.',
      sourceStatus
    })
    const matchedDocs = matchingDocuments(allDocs, p)
    const catalogDocs = researchDocuments(allDocs, p)
    const libraryRequirements = matchedDocs.flatMap(doc => (doc.requirements || []).map(rule => ({
      documentId: doc.id,
      documentTitle: doc.title,
      documentType: doc.documentType,
      sourceCategory: documentCategory(doc),
      visibility: doc.visibility,
      sensitivity: doc.sensitivity || 'public',
      sourceUrl: doc.sourceUrl || null,
      jurisdiction: doc.jurisdiction,
      category: rule.category,
      subject: rule.subject,
      description: rule.description,
      value: rule.value,
      unit: rule.unit,
      comparison: rule.comparison,
      page: rule.page,
      excerpt: rule.excerpt,
      definition: rule.definition,
      coordinateSystem: rule.coordinateSystem,
      scoringRule: rule.scoringRule,
      missingValueConvention: rule.missingValueConvention
    }))).slice(0, 160)
    const analyzed = await structuredResponse({
      name: 'diagram_analysis', schema: diagramSchema,
      instructions: `Assist a licensed civil engineer and public-procurement reviewer. Analyze every visible plan, detail, section, table, schedule, form, and contract provision and cite page or sheet identifiers. Compare against the supplied extracted library requirements. Research the project location and governing agencies using allowed authoritative domains. Cover this complete taxonomy:\n${SOURCE_TAXONOMY_TEXT}\nNever invent a requirement, condition, URL, or compliance conclusion. Distinguish controlling adopted requirements from informational evidence. If a needed source is unavailable, stale, or its location relevance cannot be established, mark it missing and use yellow rather than claiming compliance. Apply vendor criteria only when legally permissible. Never expose, summarize, or search for restricted utility or critical-infrastructure details. Research findings are screening evidence, not a substitute for a site-specific stamped report or legal determination.`,
      input: [{ role: 'user', content: [
        { type: 'input_file', filename: p.file_path.split('/').pop(), file_data: `data:application/pdf;base64,${fileBuffer.toString('base64')}` },
        { type: 'input_text', text: `Review ${p.name}, ${p.company || ''}, ${p.location || ''}. Work in strict jurisdiction order: ${sourceStatus.jurisdiction.state} first, then ${sourceStatus.jurisdiction.city}. Do not use another city, county, district, or private entity.\n\nSOURCE PRECEDENCE (highest first): issued addenda/clarifications; executed contract and special provisions/plans/specifications; solicitation and evaluation criteria; expressly incorporated municipal standards edition; applicable law/permits/funding; adopted municipal code/plans/policies; then maps, portals, studies, and historical data. Never substitute the newest edition for the incorporated edition.\n\nMATCHED EXTRACTED LIBRARY REQUIREMENTS:\n${JSON.stringify(libraryRequirements)}\n\nJURISDICTION-FILTERED CATALOG SOURCES, STATE FIRST THEN CITY (discovery/screening unless adoption and project applicability are verified):\n${JSON.stringify(catalogDocs.map(sourceForCatalogPrompt))}` }
      ]}],
      maxOutputTokens: 10000,
      webSearchDomains: [...new Set([
        ...(process.env.ANALYSIS_SOURCE_DOMAINS || RESEARCH_DOMAINS.join(',')).split(',').map(domain => domain.trim()).filter(Boolean),
        ...researchDomainsForDocuments(catalogDocs)
      ])].slice(0, 100)
    })
    const verifiedUrls = new Set((analyzed.sources || []).map(source => source.url))
    const result = {
      ...analyzed.data,
      researchFindings: (analyzed.data.researchFindings || []).filter(finding => verifiedUrls.has(finding.sourceUrl)),
      sourceStatus,
      webSources: analyzed.sources || [],
      generatedAt: new Date().toISOString(),
      openai: { responseId: analyzed.responseId, model: analyzed.model }
    }
    p.diagramAnalysis = result; p.updated_at = new Date().toISOString()
    await writeProposal(req.params.id, p)
    res.json(result)
  } catch (e) { console.error('Diagram analysis error:', e.message); res.status(errorStatus(e)).json({ error: e.message }) }
})

// ── AI section review ──
app.post('/api/proposals/:id/ai-review', async (req, res) => {
  const p = await readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Proposal not found' })
  const { sectionId } = req.body
  const secIdx = p.sections.findIndex(s => s.id === sectionId)
  if (secIdx === -1) return res.status(404).json({ error: 'Section not found' })
  const sec = p.sections[secIdx]
  const nextSec = p.sections[secIdx + 1]
  const lines = (p.text_content || '').split('\n')
  const sectionText = lines.slice(sec.startLine, nextSec ? nextSec.startLine : lines.length).join('\n').slice(0, 4000)
  const contextText = sectionText || (p.text_content || '').slice(0, 5000)

  try {
    const allDocs = await readAnalysisStandards(req)
    const docs = matchingDocuments(allDocs, p)
    const sourceStatus = buildSourceStatus(allDocs, p)
    if (!sourceStatus.jurisdiction.resolved) return res.status(400).json({
      error: 'Enter a specific city and state in the proposal location before running AI review. Broad multi-city research is not allowed.',
      sourceStatus
    })
    if (!docs.length) return res.status(400).json({
      error: allDocs.length
        ? 'No extracted library sources match this proposal location and client.'
        : 'The standards repository is empty. Upload and extract sources before running AI review.',
      sourceStatus
    })
    const sources = docs.flatMap(doc => (doc.requirements || []).map(rule => ({
      title: doc.title, sourceCategory: documentCategory(doc), jurisdiction: doc.jurisdiction, page: rule.page, description: rule.description,
      value: rule.value, unit: rule.unit, excerpt: rule.excerpt
    }))).slice(0, 80)
    const schema = {
      type: 'object', additionalProperties: false, required: ['score', 'notes', 'statutes'],
      properties: {
        score: { type: 'string', enum: ['green', 'yellow', 'red'] }, notes: { type: 'string' },
        statutes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'jurisdiction', 'relevance', 'url'], properties: {
          title: { type: 'string' }, jurisdiction: { type: 'string' }, relevance: { type: 'string' }, url: { type: 'string' }
        }}}
      }
    }
    const reviewed = await structuredResponse({
      name: 'section_review', schema,
      instructions: `Assist an engineer and public-procurement reviewer. Use only supplied sources and consider the complete source taxonomy below. If a controlling comparison is not deterministic or a relevant category is missing, score yellow. Apply vendor criteria only when legally permissible. Never fabricate a citation or URL and never expose sensitive infrastructure data.\n${SOURCE_TAXONOMY_TEXT}`,
      input: `PROPOSAL: ${p.name}\nSTATE: ${sourceStatus.jurisdiction.state}\nCITY: ${sourceStatus.jurisdiction.city}\nSECTION: ${sec.title}\n${contextText}\n\nRETRIEVED LIBRARY REQUIREMENTS (STATE FIRST, THEN THIS CITY ONLY):\n${JSON.stringify(sources)}`,
      maxOutputTokens: 2500
    })
    res.json({ ...reviewed.data, sourceStatus, generatedAt: new Date().toISOString(), openai: { responseId: reviewed.responseId, model: reviewed.model } })
  } catch (e) { console.error('AI review error:', e.message); res.status(errorStatus(e)).json({ error: e.message }) }
})

// ── Dashboard stats ──
app.get('/api/dashboard', async (req, res) => {
  const list = await companyList(req)
  const me = await currentUser(req)
  const users = (await readUsers()).filter(u => u.companyId === me?.companyId).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
  const statuses = ['pending', 'in_review', 'needs_updates', 'accepted', 'rejected']
  const statusCounts = Object.fromEntries(statuses.map(s => [s, 0]))
  const locationCounts = {}
  const reviewerCounts = {}
  const priorityCounts = { high: 0, medium: 0, low: 0, '': 0 }

  for (const p of list) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1
    const loc = p.location || 'Unknown'
    locationCounts[loc] = (locationCounts[loc] || 0) + 1
    const revKey = p.assignedToId || 'unassigned'
    const revName = p.assignedTo || 'Unassigned'
    if (!reviewerCounts[revKey]) reviewerCounts[revKey] = { id: revKey, name: revName, total: 0, ...Object.fromEntries(statuses.map(s => [s, 0])) }
    reviewerCounts[revKey].total++
    reviewerCounts[revKey][p.status] = (reviewerCounts[revKey][p.status] || 0) + 1
    priorityCounts[p.priority || ''] = (priorityCounts[p.priority || ''] || 0) + 1
  }

  const recent = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 15)
  res.json({ statusCounts, locationCounts, reviewerCounts, priorityCounts, total: list.length, recent, users })
})

let sourceMonitorRunning = false
async function runScheduledSourceHealthChecks() {
  if (sourceMonitorRunning) return
  sourceMonitorRunning = true
  try {
    const storeKeys = await standardStoreKeys()
    let checked = 0
    for (const storeKey of storeKeys) {
      checked += await checkStandardsStore(storeKey, null, Math.max(0, 12 - checked))
      if (checked >= 12) break
    }
    await writeAudit({ event: 'scheduled_source_health_check', checkedStores: storeKeys.length, checkedSources: checked })
  } catch (error) {
    console.error('Scheduled source health check failed:', error.message)
  } finally {
    sourceMonitorRunning = false
  }
}

app.use((error, _req, res, _next) => {
  console.error('Unhandled API error:', error.message)
  if (res.headersSent) return
  res.status(errorStatus(error)).json({ error: error.message || 'Unexpected server error' })
})

if (require.main === module) {
  const port = Number(process.env.PORT || 3001)
  app.listen(port, () => console.log(`API: http://localhost:${port}`))
  const configuredInterval = Number(process.env.SOURCE_HEALTH_CHECK_INTERVAL_MS || 21600000)
  const intervalMs = Number.isFinite(configuredInterval) ? Math.max(configuredInterval, 300000) : 21600000
  setTimeout(runScheduledSourceHealthChecks, 30000).unref()
  setInterval(runScheduledSourceHealthChecks, intervalMs).unref()
}

module.exports = app
