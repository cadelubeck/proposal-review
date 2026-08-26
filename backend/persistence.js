const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, 'data')
const UPLOADS_DIR = path.join(__dirname, 'uploads')
const STANDARDS_DIR = path.join(__dirname, 'standards')
const AUTH_DATA_DIR = process.env.AUTH_DATA_DIR
  ? path.resolve(process.env.AUTH_DATA_DIR)
  : path.join(__dirname, '.private')

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const cloud = Boolean(supabaseUrl && serviceKey)
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'proposal-files'

if (process.env.NODE_ENV === 'production' && !cloud) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production so application data is not written to temporary disk.')
}

if (!cloud) {
  ;[DATA_DIR, UPLOADS_DIR, STANDARDS_DIR, AUTH_DATA_DIR].forEach(directory => {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode: directory === AUTH_DATA_DIR ? 0o700 : undefined })
  })
}

function localRead(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function localWrite(file, value, privateFile = false) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), privateFile ? { mode: 0o600 } : undefined)
}

function headers(extra = {}) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra }
}

async function supabaseRequest(route, options = {}) {
  const response = await fetch(`${supabaseUrl}${route}`, { ...options, headers: headers(options.headers) })
  if (!response.ok) {
    const detail = await response.text()
    console.error(`Supabase request failed (${response.status}): ${detail.slice(0, 500)}`)
    const error = new Error('The database or file-storage service is temporarily unavailable.')
    error.statusCode = 503
    throw error
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return null
  const type = response.headers.get('content-type') || ''
  return type.includes('application/json') ? response.json() : response.arrayBuffer()
}

async function listRecords(kind, companyId) {
  const query = new URLSearchParams({ select: 'data', kind: `eq.${kind}`, order: 'updated_at.asc' })
  if (companyId !== undefined) query.set('company_id', `eq.${companyId}`)
  const rows = await supabaseRequest(`/rest/v1/app_records?${query}`)
  return rows.map(row => row.data)
}

async function getRecord(kind, id) {
  const query = new URLSearchParams({ select: 'data', kind: `eq.${kind}`, id: `eq.${id}`, limit: '1' })
  const rows = await supabaseRequest(`/rest/v1/app_records?${query}`)
  return rows[0]?.data || null
}

async function upsertRecord(kind, id, companyId, data) {
  await supabaseRequest('/rest/v1/app_records?on_conflict=kind,id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ kind, id, company_id: companyId || null, data, updated_at: new Date().toISOString() })
  })
}

async function deleteRecord(kind, id) {
  const query = new URLSearchParams({ kind: `eq.${kind}`, id: `eq.${id}` })
  await supabaseRequest(`/rest/v1/app_records?${query}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
}

async function replaceRecords(kind, values, companyId) {
  const existing = await listRecords(kind, companyId)
  const retained = new Set(values.map(value => value.id))
  await Promise.all(values.map(value => upsertRecord(kind, value.id, companyId === undefined ? value.companyId : companyId, value)))
  await Promise.all(existing.filter(value => !retained.has(value.id)).map(value => deleteRecord(kind, value.id)))
}

function proposalSummary(proposal) {
  const fields = ['id', 'name', 'company', 'location', 'status', 'companyId', 'created_at', 'updated_at', 'assignedTo', 'assignedToId', 'dueDate', 'priority']
  return Object.fromEntries(fields.filter(field => proposal[field] !== undefined).map(field => [field, proposal[field]]))
}

async function readIndex() {
  if (cloud) return (await listRecords('proposal')).map(proposalSummary)
  return localRead(path.join(DATA_DIR, 'index.json'))
}

async function writeIndex(value) {
  if (!cloud) localWrite(path.join(DATA_DIR, 'index.json'), value)
}

async function readProposal(id) {
  if (cloud) return getRecord('proposal', id)
  return localRead(path.join(DATA_DIR, `${id}.json`), null)
}

async function writeProposal(id, value) {
  if (cloud) return upsertRecord('proposal', id, value.companyId, value)
  localWrite(path.join(DATA_DIR, `${id}.json`), value)
}

async function deleteProposal(id) {
  if (cloud) return deleteRecord('proposal', id)
  const file = path.join(DATA_DIR, `${id}.json`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

async function readStandards(companyId) {
  if (cloud) return listRecords('standard', companyId)
  return localRead(path.join(STANDARDS_DIR, `${companyId}.json`))
}

async function writeStandards(companyId, values) {
  if (cloud) return replaceRecords('standard', values, companyId)
  localWrite(path.join(STANDARDS_DIR, `${companyId}.json`), values)
}

async function readUsers() {
  if (cloud) return listRecords('user')
  return localRead(path.join(AUTH_DATA_DIR, 'users.json'))
}

async function writeUsers(values) {
  if (cloud) return replaceRecords('user', values)
  const file = path.join(AUTH_DATA_DIR, 'users.json')
  const temporary = `${file}.${process.pid}.tmp`
  localWrite(temporary, values, true)
  fs.renameSync(temporary, file)
}

async function readCompanies() {
  if (cloud) return listRecords('company')
  return localRead(path.join(AUTH_DATA_DIR, 'companies.json'))
}

async function writeCompanies(values) {
  if (cloud) return replaceRecords('company', values)
  localWrite(path.join(AUTH_DATA_DIR, 'companies.json'), values, true)
}

async function readInvites() {
  if (cloud) return listRecords('invite')
  return localRead(path.join(AUTH_DATA_DIR, 'invites.json'))
}

async function writeInvites(values) {
  if (cloud) return replaceRecords('invite', values)
  localWrite(path.join(AUTH_DATA_DIR, 'invites.json'), values, true)
}

async function writeAudit(entry) {
  const safeEntry = { timestamp: new Date().toISOString(), ...entry }
  if (cloud) {
    return supabaseRequest('/rest/v1/audit_events', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ payload: safeEntry })
    })
  }
  try { fs.appendFileSync(path.join(AUTH_DATA_DIR, 'audit.jsonl'), `${JSON.stringify(safeEntry)}\n`, { mode: 0o600 }) } catch (error) {
    console.error('Audit log write failed:', error.message)
  }
}

async function readAudit() {
  if (cloud) {
    const rows = await supabaseRequest('/rest/v1/audit_events?select=payload,created_at&order=created_at.desc&limit=5000')
    return rows.map(row => ({ timestamp: row.created_at, ...row.payload }))
  }
  try { return fs.readFileSync(path.join(AUTH_DATA_DIR, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) } catch { return [] }
}

function safeObjectName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160)
}

async function saveUpload(file, companyId, recordId) {
  if (!file) return null
  if (!cloud) return { path: file.path, storage: 'local', contentType: file.mimetype, originalName: file.originalname }
  const objectPath = `${companyId}/${recordId}/${Date.now()}-${safeObjectName(file.originalname)}`
  await supabaseRequest(`/storage/v1/object/${STORAGE_BUCKET}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: { 'Content-Type': file.mimetype || 'application/octet-stream', 'x-upsert': 'false' }, body: file.buffer
  })
  return { path: objectPath, storage: 'supabase', contentType: file.mimetype, originalName: file.originalname }
}

async function readUpload(filePath, storage = cloud ? 'supabase' : 'local') {
  if (storage === 'supabase') {
    const data = await supabaseRequest(`/storage/v1/object/${STORAGE_BUCKET}/${filePath.split('/').map(encodeURIComponent).join('/')}`)
    return Buffer.from(data)
  }
  return fs.readFileSync(filePath)
}

async function deleteUpload(filePath, storage = cloud ? 'supabase' : 'local') {
  if (!filePath) return
  if (storage === 'supabase') {
    await supabaseRequest(`/storage/v1/object/${STORAGE_BUCKET}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [filePath] })
    })
    return
  }
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

async function standardStoreKeys() {
  if (cloud) {
    const rows = await supabaseRequest('/rest/v1/app_records?select=company_id&kind=eq.standard')
    return [...new Set(rows.map(row => row.company_id).filter(Boolean))]
  }
  return fs.readdirSync(STANDARDS_DIR).filter(name => name.endsWith('.json')).map(name => path.basename(name, '.json'))
}

module.exports = {
  cloud, DATA_DIR, UPLOADS_DIR, STANDARDS_DIR, AUTH_DATA_DIR,
  readIndex, writeIndex, readProposal, writeProposal, deleteProposal,
  readStandards, writeStandards, readUsers, writeUsers, readCompanies, writeCompanies,
  readInvites, writeInvites, writeAudit, readAudit,
  saveUpload, readUpload, deleteUpload, standardStoreKeys
}
