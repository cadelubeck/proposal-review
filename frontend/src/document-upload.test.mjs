import assert from 'node:assert/strict'
import { readUploadResponse, uploadDocument } from './document-upload.mjs'

await assert.rejects(readUploadResponse(new Response('Request Entity Too Large', { status: 413 })), /server limit/)
await assert.rejects(readUploadResponse(new Response('<html>Bad gateway</html>', { status: 502 })), /502/)
await assert.rejects(readUploadResponse(Response.json({ error: 'Session expired' }, { status: 401 })), /Session expired/)

const file = new File([new Uint8Array(6 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' })
const calls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://storage.example.test/upload?token=one-object')
  assert.equal(options.method, 'PUT')
  assert.equal(options.headers?.Authorization, undefined)
  assert.equal(options.body.get('').size, file.size)
  calls.push('storage')
  return Response.json({ Key: 'private/object' })
}
try {
  const apiFetch = async (url, options) => {
    calls.push(url)
    const body = JSON.parse(options.body)
    if (url === '/api/uploads/prepare') {
      assert.equal(body.size, file.size)
      return Response.json({ direct: true, uploadUrl: 'https://storage.example.test/upload?token=one-object', receipt: 'signed-receipt' })
    }
    assert.equal(body.uploadReceipt, 'signed-receipt')
    assert.equal(body.name, 'Plan set')
    assert.ok(options.body.length < 1000, 'Final API request must not contain the large file')
    return Response.json({ id: 'new-proposal' })
  }
  assert.deepEqual(await uploadDocument(apiFetch, '/api/proposals', { file, purpose: 'proposal', fields: { name: 'Plan set' } }), { id: 'new-proposal' })
  assert.deepEqual(calls, ['/api/uploads/prepare', 'storage', '/api/proposals'])
  await assert.rejects(uploadDocument(apiFetch, '/api/proposals', { file: { size: 51 * 1024 * 1024, name: 'large.pdf' } }), /50 MB/)
  const local = await uploadDocument(async (url, options) => {
    if (url === '/api/uploads/prepare') return Response.json({ direct: false })
    assert.equal(options.body.get('file').size, file.size)
    return Response.json({ id: 'local-proposal' })
  }, '/api/proposals', { file, purpose: 'proposal' })
  assert.equal(local.id, 'local-proposal')
  console.log('Browser uploads: large files bypass API, session stays private, local fallback, readable errors: ok')
} finally { globalThis.fetch = originalFetch }
