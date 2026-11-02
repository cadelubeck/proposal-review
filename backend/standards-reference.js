const catalog = require('./catalogs/utah-source-catalog.json')
const ogden = require('./catalogs/ogden-engineering-2025-reference.json')

function analysisDocuments(stored) {
  // Ship discovery records with the app so a deployment cannot silently omit
  // the municipal inventory. Stored extractions and organization records win.
  const documents = new Map([...catalog.records, ogden].map(doc => [doc.id, doc]))
  for (const doc of stored) documents.set(doc.id, { ...documents.get(doc.id), ...doc })
  return [...documents.values()].filter(doc => (doc.sensitivity || 'public') !== 'restricted')
}

function referenceContext(documents, proposal, { maxPages = 18, maxChars = 48000 } = {}) {
  const query = `${proposal.name || ''} ${proposal.text_content || ''}`.toLowerCase()
  const terms = [...new Set((query.match(/[a-z]{4,}/g) || []).filter(term => !STOP_WORDS.has(term)))].slice(0, 500)
  const references = []
  for (const doc of documents.filter(doc => doc.referencePages?.length)) {
    const ranked = doc.referencePages.map(page => {
      const text = page.text.toLowerCase()
      let score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
      for (const pattern of TOPICS) if (pattern.test(query) && pattern.test(text)) score += 30
      // Contents pages list every topic without supplying the actual provisions.
      if (/table of contents/i.test(page.text)) score = 0
      return { ...page, score }
    }).filter(page => page.score > 0).sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber)
    let remaining = maxChars
    const pages = ranked.slice(0, maxPages).sort((a, b) => a.pageNumber - b.pageNumber).flatMap(page => {
      if (remaining < page.text.length) return []
      remaining -= page.text.length
      return [{ page: page.pageNumber, text: page.text }]
    })
    if (pages.length) references.push({
      documentId: doc.id, title: doc.title, url: doc.sourceUrl,
      edition: doc.edition, jurisdiction: doc.jurisdiction, retrievedAt: doc.retrievedAt,
      applicability: 'Published official standard. Confirm project incorporation, scope, and approved exceptions; publication alone does not prove this project complies.',
      pages
    })
  }
  return references
}

const STOP_WORDS = new Set('this that with from have shall must will there their these those which where been also into each only other more than when work city ogden utah page standards engineering general requirements plans plan notes existing proposed document following shown project public'.split(' '))
const TOPICS = [/\b(bore|boring|directional)\b/i, /\b(vaults?|handholes?|cabinets?)\b/i, /\b(conduit|telecom|telecommunications)\b/i, /\b(restoration|repair)\b/i, /\b(traffic control)\b/i, /\b(storm|stormwater)\b/i, /\b(sanitary|sewer)\b/i]

const REQUIREMENT_INSTRUCTIONS = 'State the actual applicable published requirement, numeric limit and units where present, source title/edition, section and page, then compare it to the submitted evidence. Do not replace an available requirement with a generic instruction to consult or obtain the city standards. Distinguish a missing standard from missing project evidence, an unconfirmed incorporated edition, or a needed approval. Preserve exceptions and scope: for example, street-light conduit requirements must not be applied to telecommunications conduit. Supplied official reference passages are source evidence even when no structured extraction exists. Never invent a threshold or claim a published standard alone proves compliance.'

module.exports = { analysisDocuments, referenceContext, REQUIREMENT_INSTRUCTIONS }
