const OPENAI_URL = 'https://api.openai.com/v1/responses'
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

function apiKey() {
  const key = process.env.OPENAI_API_KEY
  if (!key || key === 'your_key_here') throw new Error('OPENAI_API_KEY is not configured')
  return key
}

function responseText(payload) {
  if (payload.output_text) return payload.output_text
  return (payload.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text)
    .join('')
}

async function structuredResponse({ name, schema, instructions, input, maxOutputTokens = 5000 }) {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-sol',
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
    })
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || `OpenAI API error ${response.status}`)
  const text = responseText(body)
  if (!text) throw new Error('OpenAI returned no structured output')
  return { data: JSON.parse(text), responseId: body.id, model: body.model }
}

async function embedTexts(input) {
  if (!input.length) return []
  const response = await fetch(EMBEDDINGS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input })
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || `OpenAI embeddings error ${response.status}`)
  return body.data.sort((a, b) => a.index - b.index).map(x => x.embedding)
}

module.exports = { structuredResponse, embedTexts }
