const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { structuredResponse, embedTexts } = require('./openai')
const { buildMatrix } = require('./compliance')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

const DATA_DIR = path.join(__dirname, 'data')
const UPLOADS = path.join(__dirname, 'uploads')
const STANDARDS_DIR = path.join(__dirname, 'standards')
const AUTH_DATA_DIR = process.env.AUTH_DATA_DIR
  ? path.resolve(process.env.AUTH_DATA_DIR)
  : path.join(__dirname, '.private')
;[DATA_DIR, UPLOADS, STANDARDS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) })
if (!fs.existsSync(AUTH_DATA_DIR)) fs.mkdirSync(AUTH_DATA_DIR, { recursive: true, mode: 0o700 })
try { fs.chmodSync(AUTH_DATA_DIR, 0o700) } catch {}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-please-set-JWT_SECRET-in-env'
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-please-set-JWT_SECRET-in-env') {
  throw new Error('JWT_SECRET must be set to a long, random value in production')
}

// ── JSON stores ──
const INDEX_FILE = path.join(DATA_DIR, 'index.json')
const LEGACY_USERS_FILE = path.join(DATA_DIR, 'users.json')
const USERS_FILE = path.join(AUTH_DATA_DIR, 'users.json')
const COMPANIES_FILE = path.join(AUTH_DATA_DIR, 'companies.json')
const INVITES_FILE = path.join(AUTH_DATA_DIR, 'invites.json')
const AUDIT_FILE = path.join(AUTH_DATA_DIR, 'audit.jsonl')

// Move existing accounts out of the general application data directory.
if (!fs.existsSync(USERS_FILE) && fs.existsSync(LEGACY_USERS_FILE)) {
  fs.copyFileSync(LEGACY_USERS_FILE, USERS_FILE, fs.constants.COPYFILE_EXCL)
}
if (fs.existsSync(USERS_FILE)) {
  try { fs.chmodSync(USERS_FILE, 0o600) } catch {}
}
if (fs.existsSync(LEGACY_USERS_FILE) && fs.existsSync(USERS_FILE)) {
  // Only remove the old copy after confirming the protected copy is valid JSON.
  JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'))
  fs.unlinkSync(LEGACY_USERS_FILE)
}

function readIndex() { try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')) } catch { return [] } }
function writeIndex(arr) { fs.writeFileSync(INDEX_FILE, JSON.stringify(arr, null, 2)) }
function readProposal(id) { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${id}.json`), 'utf-8')) } catch { return null } }
function writeProposal(id, data) { fs.writeFileSync(path.join(DATA_DIR, `${id}.json`), JSON.stringify(data, null, 2)) }
function standardsFile(companyId) { return path.join(STANDARDS_DIR, `${companyId}.json`) }
function readStandards(companyId) { try { return JSON.parse(fs.readFileSync(standardsFile(companyId), 'utf-8')) } catch { return [] } }
function writeStandards(companyId, data) { fs.writeFileSync(standardsFile(companyId), JSON.stringify(data, null, 2)) }
function readUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) } catch { return [] } }
function readCompanies() { try { return JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf-8')) } catch { return [] } }
function writeCompanies(arr) { fs.writeFileSync(COMPANIES_FILE, JSON.stringify(arr, null, 2), { mode: 0o600 }) }
function readInvites() { try { return JSON.parse(fs.readFileSync(INVITES_FILE, 'utf-8')) } catch { return [] } }
function writeInvites(arr) { fs.writeFileSync(INVITES_FILE, JSON.stringify(arr, null, 2), { mode: 0o600 }) }
function writeUsers(arr) {
  const temporaryFile = `${USERS_FILE}.${process.pid}.tmp`
  fs.writeFileSync(temporaryFile, JSON.stringify(arr, null, 2), { mode: 0o600 })
  fs.renameSync(temporaryFile, USERS_FILE)
  try { fs.chmodSync(USERS_FILE, 0o600) } catch {}
}

function writeAudit(entry) {
  try {
    const safeEntry = {
      timestamp: new Date().toISOString(),
      ...entry
    }
    // JSON Lines keeps the log append-only and avoids storing request bodies, passwords, or tokens.
    fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(safeEntry)}\n`, { mode: 0o600 })
    try { fs.chmodSync(AUDIT_FILE, 0o600) } catch {}
  } catch (error) {
    console.error('Audit log write failed:', error.message)
  }
}

function readAudit() {
  try {
    return fs.readFileSync(AUDIT_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
  } catch {
    return []
  }
}

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
    writeAudit({
      event: 'api_request',
      userId: req.user?.id || sessionUser?.id || null,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      isAiRequest: ['/api/proposals/:id/ai-review', '/api/proposals/:id/analyze-diagrams']
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
const storage = multer.diskStorage({
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
        required: ['category', 'subject', 'description', 'valueType', 'value', 'unit', 'comparison', 'page', 'excerpt'],
        properties: {
          category: { type: 'string' }, subject: { type: 'string' }, description: { type: 'string' },
          valueType: { type: 'string', enum: ['number', 'text'] },
          value: { type: ['number', 'string'] }, unit: { type: ['string', 'null'] },
          comparison: { type: 'string', enum: ['max', 'min', 'exact'] },
          page: { type: ['integer', 'null'] }, excerpt: { type: 'string' }
        }
      }
    }
  }
}

async function extractRequirements(text, context) {
  return structuredResponse({
    name: 'civil_engineering_requirements',
    schema: requirementSchema,
    instructions: `You extract explicit civil-engineering requirements and submitted design values. Never invent values. "max" means the submitted value must be greater than or equal to the requirement (minimum depth, thickness, strength, compaction, diameter). "min" means it must be less than or equal (maximum slope, maximum spacing). "exact" is categorical or exact. Preserve units. Page numbers must come from visible page markers; otherwise null. Excerpts must be short verbatim evidence. Identify roadway, pavement, storm drain, sanitary sewer, water, trench, frost, soils, groundwater, seismic, floodplain, slope, drainage, and utility scope.`,
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

app.post('/api/auth/dev-login', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' })
  const companies = readCompanies()
  let company = companies.find(c => c.id === 'local-preview-company')
  if (!company) {
    company = { id: 'local-preview-company', name: 'Local Preview Company', created_at: new Date().toISOString() }
    companies.push(company); writeCompanies(companies)
  }
  const users = readUsers()
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
    users.push(user); writeUsers(users)
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

    const users = readUsers()
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }

    // Passwords are deliberately hashed (not reversibly encrypted) and never stored or logged.
    const passwordHash = await bcrypt.hash(password, 12)
    let companies = readCompanies()
    let invites = readInvites()
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
      writeCompanies(companies)
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
    writeUsers(users)
    if (invite) {
      invite.accepted_at = new Date().toISOString()
      writeInvites(invites)
    }
    writeAudit({ event: 'account_created', userId: user.id })

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

    const users = readUsers()
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim())
    if (!user) {
      writeAudit({ event: 'login_failed', userId: null })
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      writeAudit({ event: 'login_failed', userId: user.id })
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Migrate older accounts into a private company without exposing existing data to new accounts.
    if (!user.companyId) {
      const companies = readCompanies()
      const company = { id: crypto.randomUUID(), name: `${user.name}'s Company`, created_at: new Date().toISOString() }
      companies.push(company); writeCompanies(companies)
      user.companyId = company.id; user.companyName = company.name; writeUsers(users)
      const idx = readIndex()
      idx.forEach(p => {
        if (!p.companyId) {
          p.companyId = company.id
          const proposal = readProposal(p.id)
          if (proposal && !proposal.companyId) { proposal.companyId = company.id; writeProposal(p.id, proposal) }
        }
      })
      writeIndex(idx)
    }
    const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, companyName: user.companyName }
    const token = jwt.sign(publicUser, JWT_SECRET, { expiresIn: '7d' })
    writeAudit({ event: 'login_succeeded', userId: user.id })
    res.json({ token, user: publicUser })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════
// ── PROTECTED ROUTES (token required) ──
// ═══════════════════════════════════════════════
app.use(requireAuth)

function currentUser(req) {
  return readUsers().find(u => u.id === req.user.id)
}
function companyList(req) {
  const user = currentUser(req)
  return readIndex().filter(p => p.companyId === user?.companyId)
}
function canAccess(req, proposal) {
  const user = currentUser(req)
  return !!user && proposal?.companyId === user.companyId
}

// ── Standards and site-document library ──
app.get('/api/standards', (req, res) => {
  res.json(readStandards(currentUser(req)?.companyId).map(({ textContent, ...doc }) => doc))
})

app.post('/api/standards', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF or text file required' })
    let textContent = ''
    if (req.file.mimetype === 'application/pdf') {
      const parsed = await require('pdf-parse')(fs.readFileSync(req.file.path))
      textContent = parsed.text
    } else {
      textContent = fs.readFileSync(req.file.path, 'utf-8')
    }
    const companyId = currentUser(req)?.companyId
    const docs = readStandards(companyId)
    const doc = {
      id: crypto.randomUUID(),
      title: req.body.title?.trim() || req.file.originalname,
      documentType: req.body.documentType || 'city_standard',
      jurisdiction: req.body.jurisdiction?.trim() || '',
      client: req.body.client?.trim() || '',
      projectTypes: (req.body.projectTypes || '').split(',').map(x => x.trim()).filter(Boolean),
      effectiveDate: req.body.effectiveDate || null,
      originalName: req.file.originalname,
      filePath: req.file.path,
      textContent,
      requirements: [],
      extractionStatus: 'pending',
      createdAt: new Date().toISOString(),
      createdById: req.user.id
    }
    docs.push(doc); writeStandards(companyId, docs)
    res.json({ ...doc, textContent: undefined })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/standards/:documentId/extract', async (req, res) => {
  try {
    const companyId = currentUser(req)?.companyId
    const docs = readStandards(companyId)
    const doc = docs.find(x => x.id === req.params.documentId)
    if (!doc) return res.status(404).json({ error: 'Document not found' })
    const extracted = await extractRequirements(doc.textContent, `SOURCE TYPE: ${doc.documentType}\nTITLE: ${doc.title}\nJURISDICTION: ${doc.jurisdiction}`)
    const embedded = await addRequirementEmbeddings(extracted.data.requirements)
    doc.requirements = embedded.map(rule => ({ ...rule, documentId: doc.id }))
    doc.detectedJurisdiction = extracted.data.jurisdiction
    doc.projectScope = extracted.data.projectScope
    doc.extractionStatus = 'complete'
    doc.extractedAt = new Date().toISOString()
    doc.openai = { responseId: extracted.responseId, model: extracted.model }
    writeStandards(companyId, docs)
    res.json({ ...doc, textContent: undefined })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/standards/:documentId', (req, res) => {
  const companyId = currentUser(req)?.companyId
  const docs = readStandards(companyId)
  const doc = docs.find(x => x.id === req.params.documentId)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  if (doc.filePath && fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath)
  writeStandards(companyId, docs.filter(x => x.id !== doc.id))
  res.json({ success: true })
})

app.get('/api/auth/me', (req, res) => {
  const users = readUsers()
  const user = users.find(u => u.id === req.user.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, companyName: user.companyName })
})

app.get('/api/company', (req, res) => {
  const user = currentUser(req)
  const company = readCompanies().find(c => c.id === user?.companyId)
  const members = readUsers().filter(u => u.companyId === user?.companyId).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
  const invites = readInvites().filter(i => i.companyId === user?.companyId && !i.accepted_at).map(({ token, ...i }) => i)
  res.json({ company, members, invites })
})

app.post('/api/company/invites', (req, res) => {
  const user = currentUser(req)
  if (user?.role !== 'manager') return res.status(403).json({ error: 'Only company managers can invite members' })
  const email = req.body.email?.toLowerCase().trim()
  if (!email) return res.status(400).json({ error: 'Email is required' })
  if (readUsers().some(u => u.email === email)) return res.status(409).json({ error: 'That email already has an account' })
  const invites = readInvites()
  const existing = invites.find(i => i.companyId === user.companyId && i.email === email && !i.accepted_at)
  if (existing) return res.json({ success: true, inviteToken: existing.token })
  const invite = { id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('hex'), companyId: user.companyId, email, role: 'reviewer', invitedById: user.id, created_at: new Date().toISOString() }
  invites.push(invite); writeInvites(invites)
  res.json({ success: true, inviteToken: invite.token })
})

app.get('/api/clients', (req, res) => {
  const clients = [...new Set(companyList(req).map(p => p.company).filter(Boolean))].sort()
  res.json(clients)
})

app.get('/api/profile/usage', (req, res) => {
  const now = Date.now()
  const requests = readAudit()
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
app.get('/api/users', (req, res) => {
  const me = currentUser(req)
  const users = readUsers().filter(u => u.companyId === me?.companyId).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
  res.json(users)
})

// My workload: proposals assigned to me + unassigned ones I can pick up
app.get('/api/me/proposals', (req, res) => {
  const userId = req.user.id
  const list = companyList(req)
  const mine = list.filter(p => p.assignedToId === userId)
  const available = list.filter(p => !p.assignedToId && !['accepted', 'rejected'].includes(p.status))
  const recent = [...list].filter(p => p.assignedToId !== userId).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 10)

  const statusCounts = {}
  mine.forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1 })

  res.json({ mine, available, recent, statusCounts })
})

// ── Proposals ──
app.get('/api/proposals', (req, res) => {
  const { search, status, location, company, assignedToId } = req.query
  let list = companyList(req)
  if (search) { const q = search.toLowerCase(); list = list.filter(p => [p.name, p.company, p.location].some(v => (v || '').toLowerCase().includes(q))) }
  if (status) list = list.filter(p => p.status === status)
  if (location) list = list.filter(p => (p.location || '').toLowerCase().includes(location.toLowerCase()))
  if (company) list = list.filter(p => (p.company || '').toLowerCase().includes(company.toLowerCase()))
  if (assignedToId) list = list.filter(p => p.assignedToId === assignedToId)
  list.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  res.json(list)
})

app.use('/api/proposals/:id', (req, res, next) => {
  const proposal = readProposal(req.params.id)
  if (!proposal) return res.status(404).json({ error: 'Not found' })
  if (!canAccess(req, proposal)) return res.status(403).json({ error: 'Access denied' })
  next()
})

app.get('/api/proposals/:id', (req, res) => {
  const p = readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  if (!canAccess(req, p)) return res.status(403).json({ error: 'Access denied' })
  res.json(p)
})

app.post('/api/proposals', upload.single('file'), async (req, res) => {
  try {
    const { name, company, location } = req.body
    if (!name) return res.status(400).json({ error: 'Name required' })
    const id = crypto.randomUUID()
    let text = req.body.text_content || ''
    let filePath = null

    if (req.file) {
      filePath = req.file.path
      if (req.file.mimetype === 'application/pdf') {
        try { const d = await require('pdf-parse')(fs.readFileSync(req.file.path)); text = d.text }
        catch { text = '[PDF uploaded — text extraction unavailable. Add sections manually.]' }
      } else { text = fs.readFileSync(req.file.path, 'utf-8') }
    }

    const now = new Date().toISOString()
    const proposal = {
      id, name, company: company || '', location: location || '',
      status: 'pending', file_path: filePath, text_content: text,
      sections: detectSections(text), highlights: [],
      createdById: req.user.id, createdByName: req.user.name, companyId: currentUser(req)?.companyId,
      created_at: now, updated_at: now
    }
    writeProposal(id, proposal)
    const idx = readIndex()
    idx.push({ id, name, company: proposal.company, location: proposal.location, status: proposal.status, companyId: proposal.companyId, created_at: now, updated_at: now })
    writeIndex(idx)
    res.json({ id, sections: proposal.sections })
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }) }
})

app.put('/api/proposals/:id', (req, res) => {
  const p = readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  const allowed = ['name', 'company', 'location', 'status', 'sections', 'highlights', 'diagramAnalysis', 'assignedTo', 'assignedToId', 'dueDate', 'priority']
  for (const k of allowed) { if (req.body[k] !== undefined) p[k] = req.body[k] }
  p.updated_at = new Date().toISOString()
  writeProposal(req.params.id, p)
  const idx = readIndex().map(i => i.id === req.params.id
    ? { ...i, name: p.name, company: p.company, location: p.location, status: p.status, assignedTo: p.assignedTo || '', assignedToId: p.assignedToId || '', dueDate: p.dueDate || '', priority: p.priority || '', updated_at: p.updated_at }
    : i)
  writeIndex(idx)
  res.json({ success: true })
})

app.delete('/api/proposals/:id', (req, res) => {
  const p = readProposal(req.params.id)
  if (p?.file_path && fs.existsSync(p.file_path)) fs.unlinkSync(p.file_path)
  const f = path.join(DATA_DIR, `${req.params.id}.json`)
  if (fs.existsSync(f)) fs.unlinkSync(f)
  writeIndex(readIndex().filter(i => i.id !== req.params.id))
  res.json({ success: true })
})

app.post('/api/proposals/:id/sections', (req, res) => {
  const p = readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  const sec = { id: crypto.randomUUID(), title: req.body.title || 'New Section', startLine: req.body.startLine ?? 0, score: 'green', notes: '', statutes: [] }
  p.sections.push(sec)
  p.updated_at = new Date().toISOString()
  writeProposal(req.params.id, p)
  writeIndex(readIndex().map(i => i.id === req.params.id ? { ...i, updated_at: p.updated_at } : i))
  res.json(sec)
})

// ── Serve proposal file (token accepted as query param for iframe) ──
app.get('/api/proposals/:id/file', (req, res) => {
  const p = readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  let filePath
  const vIdx = req.query.version
  if (vIdx !== undefined && p.versions?.length) {
    const v = p.versions[parseInt(vIdx)]
    if (!v?.file_path) return res.status(404).json({ error: 'Version not found' })
    filePath = path.resolve(v.file_path)
  } else {
    if (!p.file_path) return res.status(404).json({ error: 'No file attached' })
    filePath = path.resolve(p.file_path)
  }
  const uploadsDir = path.resolve(UPLOADS)
  if (!filePath.startsWith(uploadsDir)) return res.status(403).json({ error: 'Access denied' })
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' })
  res.setHeader('Content-Disposition', 'inline')
  res.sendFile(filePath)
})

// ── Upload new document version ──
app.post('/api/proposals/:id/versions', upload.single('file'), async (req, res) => {
  try {
    const p = readProposal(req.params.id)
    if (!p) return res.status(404).json({ error: 'Not found' })
    if (!req.file) return res.status(400).json({ error: 'File required' })
    const versions = p.versions || []
    if (p.file_path) versions.push({ version: versions.length + 1, label: req.body.label || `v${versions.length + 1}`, file_path: p.file_path, uploaded_at: p.updated_at || p.created_at, uploadedById: req.user.id, uploadedByName: req.user.name })
    let text = ''
    if (req.file.mimetype === 'application/pdf') {
      try { const d = await require('pdf-parse')(fs.readFileSync(req.file.path)); text = d.text }
      catch { text = '[PDF uploaded — text extraction unavailable.]' }
    } else { text = fs.readFileSync(req.file.path, 'utf-8') }
    const now = new Date().toISOString()
    p.file_path = req.file.path; p.text_content = text; p.versions = versions; p.updated_at = now
    if (req.body.resetSections === 'true') p.sections = detectSections(text)
    writeProposal(req.params.id, p)
    writeIndex(readIndex().map(i => i.id === req.params.id ? { ...i, updated_at: now } : i))
    res.json({ success: true, versionCount: versions.length + 1 })
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }) }
})

// ── Full deterministic compliance analysis ──
app.post('/api/proposals/:id/compliance-review', async (req, res) => {
  try {
    const p = readProposal(req.params.id)
    const docs = readStandards(currentUser(req)?.companyId)
      .filter(doc => doc.extractionStatus === 'complete')
      .filter(doc => {
        const jurisdictionMatch = !doc.jurisdiction || (p.location || '').toLowerCase().includes(doc.jurisdiction.toLowerCase()) ||
          doc.jurisdiction.toLowerCase().includes((p.location || '').toLowerCase())
        const clientMatch = !doc.client || (p.company || '').toLowerCase() === doc.client.toLowerCase()
        return jurisdictionMatch && clientMatch
      })
    if (!docs.length) return res.status(400).json({ error: 'No extracted standards or site reports match this proposal jurisdiction/client.' })

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
      matrix,
      summary,
      generatedAt: new Date().toISOString(),
      openai: { responseId: extracted.responseId, model: extracted.model },
      decisionPolicy: 'City/client baseline; site-specific source controls only when deterministically stricter; conflicts require engineer review.'
    }
    p.updated_at = new Date().toISOString()
    writeProposal(p.id, p)
    res.json(p.complianceReview)
  } catch (error) {
    console.error('Compliance review error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// ── Diagram analysis ──
app.post('/api/proposals/:id/analyze-diagrams', async (req, res) => {
  const p = readProposal(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  if (!p.file_path) return res.status(400).json({ error: 'No PDF file attached' })
  const filePath = path.resolve(p.file_path)
  const uploadsDir = path.resolve(UPLOADS)
  if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' })
  if (fs.statSync(filePath).size > 25 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 25MB)' })

  try {
    const diagramSchema = {
      type: 'object', additionalProperties: false,
      required: ['summary', 'diagrams', 'overallCompliance', 'criticalIssues', 'recommendations'],
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
        recommendations: { type: 'array', items: { type: 'string' } }
      }
    }
    const analyzed = await structuredResponse({
      name: 'diagram_analysis', schema: diagramSchema,
      instructions: 'Analyze every visible civil plan, detail, section, table, and diagram. Cite page or sheet identifiers. Do not invent a code requirement or claim compliance with an unavailable source.',
      input: [{ role: 'user', content: [
        { type: 'input_file', filename: path.basename(filePath), file_data: `data:application/pdf;base64,${fs.readFileSync(filePath).toString('base64')}` },
        { type: 'input_text', text: `Review ${p.name}, ${p.company || ''}, ${p.location || ''}.` }
      ]}],
      maxOutputTokens: 8000
    })
    const result = { ...analyzed.data, generatedAt: new Date().toISOString(), openai: { responseId: analyzed.responseId, model: analyzed.model } }
    p.diagramAnalysis = result; p.updated_at = new Date().toISOString()
    writeProposal(req.params.id, p)
    res.json(result)
  } catch (e) { console.error('Diagram analysis error:', e.message); res.status(500).json({ error: e.message }) }
})

// ── AI section review ──
app.post('/api/proposals/:id/ai-review', async (req, res) => {
  const p = readProposal(req.params.id)
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
    const docs = readStandards(currentUser(req)?.companyId).filter(x => x.extractionStatus === 'complete')
    const sources = docs.flatMap(doc => (doc.requirements || []).map(rule => ({
      title: doc.title, jurisdiction: doc.jurisdiction, page: rule.page, description: rule.description,
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
      instructions: 'Assist an engineer. Use only supplied sources. If a controlling comparison is not deterministic, score yellow. Never fabricate a citation or URL.',
      input: `PROPOSAL: ${p.name}\nLOCATION: ${p.location}\nSECTION: ${sec.title}\n${contextText}\n\nRETRIEVED LIBRARY REQUIREMENTS:\n${JSON.stringify(sources)}`,
      maxOutputTokens: 2500
    })
    res.json({ ...reviewed.data, generatedAt: new Date().toISOString(), openai: { responseId: reviewed.responseId, model: reviewed.model } })
  } catch (e) { console.error('AI review error:', e.message); res.status(500).json({ error: e.message }) }
})

// ── Dashboard stats ──
app.get('/api/dashboard', (req, res) => {
  const list = companyList(req)
  const me = currentUser(req)
  const users = readUsers().filter(u => u.companyId === me?.companyId).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
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

if (require.main === module) {
  const port = Number(process.env.PORT || 3001)
  app.listen(port, () => console.log(`API: http://localhost:${port}`))
}

module.exports = app

module.exports = app
