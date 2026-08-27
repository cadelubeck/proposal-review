const assert = require('node:assert/strict')

process.env.OPENAI_API_KEY = 'test-key'
process.env.AI_ENABLED = 'true'
process.env.AI_WEB_SEARCH_ENABLED = 'true'
let requestBody
global.fetch = async (url, options = {}) => {
  if (options.method === 'GET' || !options.body) {
    return {
      ok: true,
      json: async () => ({
        id: 'resp_backgroundtest', status: 'completed', model: 'test-model',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"result":"background ok"}', annotations: [] }] }]
      })
    }
  }
  requestBody = JSON.parse(options.body)
  return {
    ok: true,
    json: async () => ({
      id: requestBody.background ? 'resp_backgroundtest' : 'response-test',
      status: requestBody.background ? 'queued' : 'completed',
      model: 'test-model',
      output: [
        { type: 'web_search_call', action: { sources: [{ title: 'USGS', url: 'https://www.usgs.gov/example' }] } },
        { type: 'message', content: [{ type: 'output_text', text: '{"result":"ok"}', annotations: [] }] }
      ]
    })
  }
}

const { aiConfiguration, retrieveBackgroundStructuredResponse, startBackgroundStructuredResponse, structuredResponse } = require('./openai')

;(async () => {
  const response = await structuredResponse({
    name: 'test_output',
    schema: { type: 'object', additionalProperties: false, required: ['result'], properties: { result: { type: 'string' } } },
    instructions: 'Test',
    input: 'Test',
    webSearchDomains: ['usgs.gov']
  })
  assert.equal(requestBody.tools[0].type, 'web_search')
  assert.deepEqual(requestBody.tools[0].filters.allowed_domains, ['usgs.gov'])
  assert.equal(requestBody.tool_choice, 'required')
  assert.deepEqual(response.data, { result: 'ok' })
  assert.deepEqual(response.sources, [{ title: 'USGS', url: 'https://www.usgs.gov/example' }])
  const started = await startBackgroundStructuredResponse({
    name: 'background_test', schema: { type: 'object', additionalProperties: false, required: ['result'], properties: { result: { type: 'string' } } },
    instructions: 'Test', input: 'Test', webSearchDomains: ['usgs.gov']
  })
  assert.equal(requestBody.background, true)
  assert.equal(started.status, 'queued')
  const completed = await retrieveBackgroundStructuredResponse(started.responseId)
  assert.equal(completed.status, 'completed')
  assert.deepEqual(completed.data, { result: 'background ok' })
  process.env.AI_ENABLED = 'false'
  await assert.rejects(
    structuredResponse({
      name: 'disabled_test',
      schema: { type: 'object', additionalProperties: false, properties: {} },
      instructions: 'This request must not be sent.',
      input: 'Test'
    }),
    /disabled to prevent usage charges/
  )
  process.env.OPENAI_API_KEY = 'YOUR_OPENAI_API_KEY'
  assert.equal(aiConfiguration().configured, false)
  console.log('OpenAI request wiring: ok')
})().catch(error => {
  console.error(error)
  process.exit(1)
})
