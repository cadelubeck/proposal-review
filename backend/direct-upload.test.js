const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')
const { createDirectUploads, MAX_UPLOAD_BYTES } = require('./direct-upload')

async function main() {
  const secret = 'test-only-upload-secret'
  const user = { id: 'alice', companyId: 'city-a' }
  const bytes = Buffer.alloc(6 * 1024 * 1024, ' ')
  bytes.write('%PDF-1.7\n')
  let storedPath
  let reads = 0
  const uploads = createDirectUploads({ secret,
    createUploadUrl: async path => { storedPath = path; return `https://storage.example.test/${path}?token=upload-only` },
    readUpload: async path => { assert.equal(path, storedPath); reads++; return bytes }
  })
  const input = { name: 'plan set.pdf', contentType: 'application/pdf', size: bytes.length, purpose: 'proposal' }
  const prepared = await uploads.prepare(user, input)
  assert.match(prepared.uploadUrl, /city-a\/direct\/alice\//)
  assert.ok(!prepared.uploadUrl.includes(secret))
  const file = await uploads.resolve(prepared.receipt, user, 'proposal')
  assert.equal(file.buffer.length, bytes.length)
  assert.equal(file.storagePath, storedPath)
  assert.equal(file.mimetype, 'application/pdf')
  const before = reads
  await assert.rejects(uploads.resolve(prepared.receipt, { ...user, id: 'bob' }, 'proposal'), /different account/)
  await assert.rejects(uploads.resolve(prepared.receipt, { ...user, companyId: 'city-b' }, 'proposal'), /different account/)
  await assert.rejects(uploads.resolve(prepared.receipt, user, 'standard'), /different account/)
  await assert.rejects(uploads.resolve(`${prepared.receipt}tampered`, user, 'proposal'), /invalid/)
  assert.equal(reads, before, 'Unauthorized receipts must not download an object')
  const expired = jwt.sign({ ...jwt.decode(prepared.receipt), exp: 1 }, secret)
  await assert.rejects(uploads.resolve(expired, user, 'proposal'), /expired/)
  await assert.rejects(uploads.prepare(user, { ...input, size: MAX_UPLOAD_BYTES + 1 }), /50 MB/)
  await assert.rejects(uploads.prepare(user, { ...input, name: 'file.exe' }), /Only PDF/)
  await assert.rejects(uploads.prepare(user, { ...input, size: 0 }), /empty/)
  const version = await uploads.prepare(user, { ...input, purpose: 'version', proposalId: 'proposal-1' })
  await assert.rejects(uploads.resolve(version.receipt, user, 'version', 'proposal-2'), /different account/)
  assert.equal((await uploads.resolve(version.receipt, user, 'version', 'proposal-1')).buffer.length, bytes.length)
  const incomplete = await uploads.prepare(user, { ...input, size: bytes.length - 1 })
  await assert.rejects(uploads.resolve(incomplete.receipt, user, 'proposal'), /incomplete/)
  bytes.write('NOT-A-PDF')
  const invalid = await uploads.prepare(user, input)
  await assert.rejects(uploads.resolve(invalid.receipt, user, 'proposal'), /valid PDF/)
  console.log('Direct uploads: size limits, ownership, purpose, tampering, expiry, and PDF validation: ok')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
