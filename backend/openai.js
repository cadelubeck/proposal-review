const OPENAI_URL = 'https://api.openai.com/v1/responses'
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

function apiKey() {
  const key = process.env.OPENAI_API_KEY
  if (!key || key === 'your_key_here') throw new Error('OPENAI_API_KEY is not configured')
  return key
}

function aiConfiguration() {
  const key = process.env.OPENAI_API_KEY
  return {
    enabled: process.env.AI_ENABLED === 'true',
    configured: Boolean(key && key !== 'your_key_here'),
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

async function structuredResponse({ name, schema, instructions, input, maxOutputTokens = 5000, webSearchDomains = [] }) {
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
  const text = responseText(body)
  if (!text) throw new Error('OpenAI returned no structured output')
  return { data: JSON.parse(text), responseId: body.id, model: body.model, sources: responseSources(body) }
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

module.exports = { aiConfiguration, checkConnection, structuredResponse, embedTexts }
