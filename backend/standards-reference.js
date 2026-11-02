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
      const heading = text.slice(0, 450).replace(/\s+/g, '')
      if (/bore|boring|directional/i.test(query) && /directionalbore|borepath/.test(heading)) score += 150
      // Contents pages list every topic without supplying the actual provisions.
      if (/table of contents/i.test(page.text)) score = 0
      return { ...page, score }
    }).filter(page => page.score > 0).sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber)
    let remaining = maxChars
    // Spend the budget on the best matches first. Sorting by page before
    // budgeting can discard the key later chapter in favor of general pages.
    const pages = ranked.slice(0, maxPages).flatMap(page => {
      if (remaining < page.text.length) return []
      remaining -= page.text.length
      return [{ page: page.pageNumber, text: page.text }]
    }).sort((a, b) => a.page - b.page)
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
// PDF extraction often joins adjacent words ("intheborepath", "boredepth").
// Topic retrieval must survive that without inventing missing plan evidence.
const TOPICS = [/bore|boring|directional/i, /vault|handhole|cabinet/i, /conduit|telecom/i, /restoration|repair/i, /traffic\s*control/i, /storm/i, /sanitary|sewer/i]

const REQUIREMENT_INSTRUCTIONS = 'State the actual applicable published requirement, numeric limit and units where present, source title/edition, section and page, then compare it to the submitted evidence. Do not replace an available requirement with a generic instruction to consult or obtain the city standards. Distinguish a missing standard from missing project evidence, an unconfirmed incorporated edition, or a needed approval. Preserve exceptions and scope: for example, street-light conduit requirements must not be applied to telecommunications conduit. Normalize unit conventions before comparison. US engineering scale notation 1:50 may mean 1 inch = 50 feet; do not compare a converted dimensionless 1:504 from 1 inch = 42 feet with an unqualified 1:50 as though their conventions were identical. If the convention is not established, report review rather than a conflict. Missing construction/closeout records are not design violations unless they are required at the submitted project phase. Supplied official reference passages are source evidence even when no structured extraction exists. Never invent a threshold or claim a published standard alone proves compliance.'

function guardDiagramComparisons(analysis) {
  let corrected = false
  const scaleNote = 'Confirm the scale convention before deciding compliance. The plan uses feet per inch while the reference uses engineering scale notation. A dimensionless conversion must not be compared directly with an unqualified engineering scale; that conversion alone does not establish a violation.'
  const standardsChecks = (analysis.standardsChecks || []).map(check => {
    if (check.sourceUrl === ogden.sourceUrl && /scale/i.test(check.subject) && check.result === 'fail'
      && /inch[\s\S]*(?:feet|ft)/i.test(check.submittedEvidence) && /1\s*:\s*\d+/.test(check.requirement)) {
      corrected = true
      return { ...check, result: 'review', reason: scaleNote }
    }
    return check
  })
  if (!corrected) return analysis
  return {
    ...analysis, standardsChecks,
    summary: analysis.summary?.replace(/noncompliant or ambiguous scale/gi, 'unconfirmed scale convention'),
    criticalIssues: (analysis.criticalIssues || []).map(issue => /scale/i.test(issue) ? scaleNote : issue),
    diagrams: (analysis.diagrams || []).map(diagram => ({ ...diagram,
      concerns: (diagram.concerns || []).map(concern => /scale/i.test(concern) ? scaleNote : concern),
      missingElements: (diagram.missingElements || []).map(item => /scale/i.test(item) ? 'Confirmation of the scale convention and drawing legibility' : item)
    })),
    validationNotes: [...(analysis.validationNotes || []), 'A mixed-unit scale comparison was changed to engineer review; no scale conflict is established by that conversion.']
  }
}

module.exports = { analysisDocuments, referenceContext, REQUIREMENT_INSTRUCTIONS, guardDiagramComparisons }
