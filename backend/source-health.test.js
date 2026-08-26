const assert = require('node:assert/strict')
const { isPrivateAddress, mergeHealth } = require('./source-health')

assert.equal(isPrivateAddress('127.0.0.1'), true)
assert.equal(isPrivateAddress('10.4.5.6'), true)
assert.equal(isPrivateAddress('192.168.1.2'), true)
assert.equal(isPrivateAddress('8.8.8.8'), false)
assert.equal(isPrivateAddress('::1'), true)

const first = mergeHealth(null, { status: 'broken', checkedAt: '2026-01-01T00:00:00.000Z', httpStatus: 404, error: 'Not found' })
assert.equal(first.firstDetectedAt, first.checkedAt)
const acknowledged = { ...first, acknowledgedAt: '2026-01-02T00:00:00.000Z', acknowledgedById: 'admin' }
const repeated = mergeHealth(acknowledged, { status: 'broken', checkedAt: '2026-01-03T00:00:00.000Z', httpStatus: 404, error: 'Not found' })
assert.equal(repeated.acknowledgedById, 'admin')
const changed = mergeHealth(repeated, { status: 'changed', checkedAt: '2026-01-04T00:00:00.000Z', httpStatus: 200, error: null })
assert.equal(changed.acknowledgedAt, null)
const stillChanged = mergeHealth(changed, { status: 'healthy', checkedAt: '2026-01-05T00:00:00.000Z', httpStatus: 200, error: null })
assert.equal(stillChanged.status, 'changed')
const cleared = mergeHealth({ ...changed, acknowledgedAt: '2026-01-05T01:00:00.000Z' }, { status: 'healthy', checkedAt: '2026-01-06T00:00:00.000Z', httpStatus: 200, error: null })
assert.equal(cleared.status, 'healthy')

console.log('source health: ok')
