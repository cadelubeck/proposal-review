const OPENAI_URL = 'https://api.openai.com/v1/responses'
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

function isConfiguredKey(key) {
  return Boolean(key && !/(your.*key|replace.*key|placeholder)/i.test(key))
}

function apiKey() {
  const key = process.env.OPENAI_API_KEY
  if (!isConfiguredKey(key)) throw new Error('OPENAI_API_KEY is not configured')
  return key
}

function aiConfiguration() {
  const key = process.env.OPENAI_API_KEY
  return {
    enabled: process.env.AI_ENABLED === 'true',
    configured: isConfiguredKey(key),
    webSearchEnabled: process.env.AI_WEB_SEARCH_ENABLED === 'true',
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna'
  }
}

async function checkConnection() {
  const configuration = aiConfiguration()
  if (!configuration.configured) return { ...configuration, reachable: false, error: 'OPENAI_API_KEY is not configured' }
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(configuration.model)}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(10000)
    })
    const body = await response.json()
    return response.ok
      ? { ...configuration, reachable: true, error: null }
      : { ...configuration, reachable: false, error: body.error?.message || `OpenAI API returned ${response.status}` }
  } catch (error) {
    return { ...configuration, reachable: false, error: error.message }
  }
}

function requireAiEnabled() {
  if (process.env.AI_ENABLED !== 'true') {
    const error = new Error('AI analysis is disabled to prevent usage charges. An administrator must explicitly set AI_ENABLED=true after approving an API budget.')
    error.statusCode = 503
    throw error
  }
}

function responseText(payload) {
  if (payload.output_text) return payload.output_text
  return (payload.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text)
    .join('')
}

function responseSources(payload) {
  const sources = []
  for (const item of payload.output || []) {
    for (const source of item.action?.sources || []) {
      if (source.url) sources.push({ title: source.title || source.url, url: source.url })
    }
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        const citation = annotation.url_citation || annotation
        if (citation.url) sources.push({ title: citation.title || citation.url, url: citation.url })
      }
    }
  }
  return [...new Map(sources.map(source => [source.url, source])).values()]
}

function responseRequest({ name, schema, instructions, input, maxOutputTokens = 5000, webSearchDomains = [] }) {
  requireAiEnabled()
  const request = {
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name,
        strict: true,
        schema
      }
    }
  }
  if (webSearchDomains.length && process.env.AI_WEB_SEARCH_ENABLED === 'true') {
    request.tools = [{ type: 'web_search', filters: { allowed_domains: webSearchDomains } }]
    request.tool_choice = 'required'
    request.include = ['web_search_call.action.sources']
  }
  return request
}

function completedResponse(body) {
  const text = responseText(body)
  if (!text) throw new Error('OpenAI returned no structured output')
  return {
    data: JSON.parse(text), responseId: body.id, model: body.model,
    sources: responseSources(body), status: body.status || 'completed',
    usage: body.usage ? {
      inputTokens: body.usage.input_tokens || 0,
      outputTokens: body.usage.output_tokens || 0,
      totalTokens: body.usage.total_tokens || 0
    } : null
  }
}

async function structuredResponse(options) {
  const request = responseRequest(options)
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || `OpenAI API error ${response.status}`)
  return completedResponse(body)
}

async function startBackgroundStructuredResponse(options) {
  const request = { ...responseRequest(options), background: true }
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(45000)
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || `OpenAI API error ${response.status}`)
  if (!body.id) throw new Error('OpenAI did not return a background response ID')
  return { responseId: body.id, model: body.model, status: body.status || 'queued' }
}

async function retrieveBackgroundStructuredResponse(responseId) {
  if (!/^resp_[a-zA-Z0-9_-]+$/.test(responseId || '')) throw new Error('Invalid OpenAI background response ID')
  const response = await fetch(`${OPENAI_URL}/${encodeURIComponent(responseId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(15000)
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || `OpenAI API error ${response.status}`)
  if (['queued', 'in_progress'].includes(body.status)) return { responseId: body.id, model: body.model, status: body.status }
  if (body.status !== 'completed') {
    throw new Error(body.error?.message || body.incomplete_details?.reason || `OpenAI background response ended with status ${body.status || 'unknown'}`)
  }
  return completedResponse(body)
}

async function cancelBackgroundResponse(responseId) {
  if (!/^resp_[a-zA-Z0-9_-]+$/.test(responseId || '')) throw new Error('Invalid OpenAI background response ID')
  const response = await fetch(`${OPENAI_URL}/${encodeURIComponent(responseId)}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(15000)
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || `OpenAI cancel error ${response.status}`)
  return { responseId: body.id, status: body.status || 'cancelled' }
}

async function embedTexts(input) {
  if (!input.length) return []
  requireAiEnabled()
  const response = await fetch(EMBEDDINGS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input })
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || `OpenAI embeddings error ${response.status}`)
  return body.data.sort((a, b) => a.index - b.index).map(x => x.embedding)
}

module.exports = { aiConfiguration, cancelBackgroundResponse, checkConnection, retrieveBackgroundStructuredResponse, startBackgroundStructuredResponse, structuredResponse, embedTexts }
