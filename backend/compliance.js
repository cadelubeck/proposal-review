const crypto = require('crypto')

const STOP = new Set('a an and are as at be by for from has in is it of on or that the this to was with'.split(' '))

function tokens(value) {
  return new Set((value || '').toLowerCase().match(/[a-z0-9]+/g)?.filter(x => x.length > 1 && !STOP.has(x)) || [])
}

function similarity(a, b) {
  const aa = tokens(a); const bb = tokens(b)
  if (!aa.size || !bb.size) return 0
  let overlap = 0
  for (const token of aa) if (bb.has(token)) overlap++
  return overlap / Math.sqrt(aa.size * bb.size)
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let dot = 0; let aa = 0; let bb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2 }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}

function retrieve(requirement, documents, limit = 8) {
  const query = [requirement.category, requirement.subject, requirement.description, requirement.location].filter(Boolean).join(' ')
  return documents.flatMap(doc => (doc.requirements || []).map(rule => ({
    document: doc,
    rule,
    score: requirement.embedding && rule.embedding
      ? .72 * cosine(requirement.embedding, rule.embedding) + .28 * similarity(query, [rule.category, rule.subject, rule.description].join(' '))
      : similarity(query, [rule.category, rule.subject, rule.description].join(' '))
  }))).filter(x => x.score >= .2).sort((a, b) => b.score - a.score).slice(0, limit)
}

function normalizedUnit(unit) {
  const u = (unit || '').toLowerCase().trim()
  return ({ inch: 'in', inches: 'in', '"': 'in', feet: 'ft', foot: 'ft', "'": 'ft', percent: '%', psi: 'psi' })[u] || u
}

function numeric(value) {
  if (typeof value === 'number') return value
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function comparable(a, b) {
  return a.valueType === 'number' && b.valueType === 'number' &&
    normalizedUnit(a.unit) === normalizedUnit(b.unit) &&
    numeric(a.value) !== null && numeric(b.value) !== null
}

function strictnessWinner(baseline, site) {
  if (!baseline) return site
  if (!site) return baseline
  if (!comparable(baseline, site) || baseline.comparison !== site.comparison) return null
  const a = numeric(baseline.value); const b = numeric(site.value)
  if (baseline.comparison === 'max') return b > a ? site : baseline
  if (baseline.comparison === 'min') return b < a ? site : baseline
  return String(a) === String(b) ? baseline : null
}

function evaluate(proposal, controlling) {
  if (!proposal || !controlling) return { result: 'review', reason: 'A proposal value or controlling requirement is missing.' }
  if (controlling.valueType === 'number') {
    if (!comparable(proposal, controlling)) return { result: 'review', reason: 'Values or units are not deterministically comparable.' }
    const pv = numeric(proposal.value); const cv = numeric(controlling.value)
    const pass = controlling.comparison === 'max' ? pv >= cv
      : controlling.comparison === 'min' ? pv <= cv
      : pv === cv
    return { result: pass ? 'pass' : 'fail', reason: pass ? 'Submitted value meets the controlling requirement.' : 'Submitted value does not meet the controlling requirement.' }
  }
  const pass = String(proposal.value || '').trim().toLowerCase() === String(controlling.value || '').trim().toLowerCase()
  return { result: pass ? 'pass' : 'fail', reason: pass ? 'Submitted specification matches.' : 'Submitted specification does not match.' }
}

function buildMatrix(proposalRequirements, documents) {
  return proposalRequirements.map(submitted => {
    const candidates = retrieve(submitted, documents)
    const baselines = candidates.filter(x => ['city_standard', 'client_standard', 'manual'].includes(x.document.documentType))
    const sites = candidates.filter(x => ['geotechnical', 'seismic', 'groundwater', 'floodplain', 'engineering_report'].includes(x.document.documentType))
    const baseline = baselines[0]?.rule || null
    const site = sites[0]?.rule || null
    const controlling = strictnessWinner(baseline, site)
    const conflict = !!baseline && !!site && !controlling
    const outcome = conflict ? { result: 'review', reason: 'Sources conflict or cannot be compared deterministically.' } : evaluate(submitted, controlling)
    const sourceDoc = controlling
      ? documents.find(d => d.id === controlling.documentId)
      : null
    return {
      id: crypto.randomUUID(),
      category: submitted.category,
      subject: submitted.subject,
      requirement: controlling?.description || 'No controlling requirement retrieved',
      cityStandard: baseline ? `${baseline.value} ${baseline.unit || ''}`.trim() : null,
      siteRequirement: site ? `${site.value} ${site.unit || ''}`.trim() : null,
      proposalValue: `${submitted.value} ${submitted.unit || ''}`.trim(),
      controllingValue: controlling ? `${controlling.value} ${controlling.unit || ''}`.trim() : null,
      result: outcome.result,
      reason: outcome.reason,
      recommendedCorrection: outcome.result === 'fail' ? `Revise to meet ${controlling.value} ${controlling.unit || ''}.`.trim() : outcome.result === 'review' ? 'Engineer must resolve the source conflict or missing requirement.' : '',
      source: sourceDoc ? { documentId: sourceDoc.id, title: sourceDoc.title, page: controlling.page, excerpt: controlling.excerpt } : null,
      candidates: candidates.slice(0, 3).map(x => ({ documentId: x.document.id, title: x.document.title, page: x.rule.page, score: x.score }))
    }
  })
}

module.exports = { buildMatrix, retrieve, strictnessWinner, evaluate }
