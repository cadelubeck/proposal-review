const assert = require('node:assert/strict')

process.env.OPENAI_API_KEY = 'test-key'
process.env.AI_ENABLED = 'true'
process.env.AI_WEB_SEARCH_ENABLED = 'true'
let requestBody
global.fetch = async (_url, options) => {
  requestBody = JSON.parse(options.body)
  return {
    ok: true,
    json: async () => ({
      id: 'response-test',
      model: 'test-model',
      output: [
        { type: 'web_search_call', action: { sources: [{ title: 'USGS', url: 'https://www.usgs.gov/example' }] } },
        { type: 'message', content: [{ type: 'output_text', text: '{"result":"ok"}', annotations: [] }] }
      ]
    })
  }
}

const { structuredResponse } = require('./openai')

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
  console.log('OpenAI request wiring: ok')
})().catch(error => {
  console.error(error)
  process.exit(1)
})
