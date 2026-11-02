const assert = require('node:assert/strict')

async function main() {
  const originalFetch = global.fetch
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_URL = 'https://database.example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
  const offsets = []
  let getCount = 0
  let activeWrites = 0
  let peakWrites = 0
  let upsertCount = 0

  global.fetch = async (input, options = {}) => {
    const url = new URL(input)
    const method = options.method || 'GET'
    if (method === 'GET') {
      getCount++
      const offset = Number(url.searchParams.get('offset') || 0)
      offsets.push(offset)
      let rows = []
      if (getCount <= 2) {
        const count = Math.max(0, Math.min(1000, 1001 - offset))
        rows = Array.from({ length: count }, (_, index) => ({ data: { id: `record-${offset + index}` } }))
      }
      return {
        ok: true,
        status: 200,
        headers: { get: name => name === 'content-length' ? '1' : 'application/json' },
        json: async () => rows
      }
    }

    if (method === 'POST') {
      upsertCount++
      activeWrites++
      peakWrites = Math.max(peakWrites, activeWrites)
      await new Promise(resolve => setTimeout(resolve, 1))
      activeWrites--
    }
    return { ok: true, status: 204, headers: { get: () => '0' } }
  }

  try {
    const { readStandards, writeStandards } = require('./persistence')
    const records = await readStandards('_shared')
    assert.equal(records.length, 1001)
    assert.deepEqual(offsets, [0, 1000])

    await writeStandards('_shared', Array.from({ length: 101 }, (_, index) => ({ id: `new-${index}` })))
    assert.equal(upsertCount, 101)
    assert.ok(peakWrites <= 50)
    assert.ok(peakWrites > 1)
  } finally {
    global.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  }
}

main().then(() => console.log('Supabase record pagination and batching: ok')).catch(error => {
  console.error(error)
  process.exitCode = 1
})
