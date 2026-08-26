const { SOURCE_CATEGORIES, documentCategory } = require('./source-catalog')

const RESEARCH_DOMAINS = [
  'usgs.gov',
  'waterdata.usgs.gov',
  'earthquake.usgs.gov',
  'ngmdb.usgs.gov',
  'fema.gov',
  'epa.gov',
  'dot.gov',
  'fhwa.dot.gov',
  'mutcd.fhwa.dot.gov',
  'ada.gov',
  'usace.army.mil',
  'fws.gov',
  'data.gov',
  'sam.gov',
  'acquisition.gov',
  'bls.gov',
  'jonescivil.com'
]

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function locationMatches(proposalLocation, sourceJurisdiction) {
  if (!sourceJurisdiction) return true
  const proposal = normalized(proposalLocation)
  const source = normalized(sourceJurisdiction)
  if (!proposal) return false
  if (proposal.includes(source) || source.includes(proposal)) return true
  const proposalTokens = new Set(proposal.split(' ').filter(Boolean))
  const sourceTokens = new Set(source.split(' ').filter(Boolean))
  const smaller = proposalTokens.size <= sourceTokens.size ? proposalTokens : sourceTokens
  const larger = smaller === proposalTokens ? sourceTokens : proposalTokens
  let overlap = 0
  for (const token of smaller) if (larger.has(token)) overlap++
  return smaller.size > 0 && overlap / smaller.size >= 0.75
}

function clientMatches(proposalClient, sourceClient) {
  if (!sourceClient) return true
  const proposal = normalized(proposalClient)
  const source = normalized(sourceClient)
  return !!proposal && (proposal === source || proposal.includes(source) || source.includes(proposal))
}

function matchesProposal(doc, proposal) {
  return locationMatches(proposal.location, doc.jurisdiction) && clientMatches(proposal.company, doc.client)
}

function matchingDocuments(documents, proposal) {
  return documents.filter(doc => doc.extractionStatus === 'complete' && matchesProposal(doc, proposal))
}

function sourceCoverage(documents) {
  return SOURCE_CATEGORIES.map(area => {
    const matches = documents.filter(doc => documentCategory(doc) === area.key)
    return {
      key: area.key,
      label: area.label,
      description: area.description,
      sensitive: !!area.sensitive,
      status: matches.length ? 'available' : 'missing',
      documentIds: matches.map(doc => doc.id),
      documents: matches.map(doc => ({ id: doc.id, title: doc.title, documentType: doc.documentType, jurisdiction: doc.jurisdiction || '' }))
    }
  })
}

function buildSourceStatus(allDocuments, proposal) {
  const complete = allDocuments.filter(doc => doc.extractionStatus === 'complete')
  const matched = matchingDocuments(allDocuments, proposal)
  const pending = allDocuments.filter(doc => doc.extractionStatus !== 'complete')
  return {
    repositoryDocumentCount: allDocuments.length,
    extractedDocumentCount: complete.length,
    matchedDocumentCount: matched.length,
    matchedRequirementCount: matched.reduce((total, doc) => total + (doc.requirements?.length || 0), 0),
    pendingDocuments: pending.map(doc => ({ id: doc.id, title: doc.title, extractionStatus: doc.extractionStatus })),
    matchedDocuments: matched.map(doc => ({
      id: doc.id,
      title: doc.title,
      documentType: doc.documentType,
      jurisdiction: doc.jurisdiction || '',
      client: doc.client || '',
      requirementCount: doc.requirements?.length || 0
    })),
    coverage: sourceCoverage(matched),
    researchDomains: RESEARCH_DOMAINS
  }
}

module.exports = { RESEARCH_DOMAINS, buildSourceStatus, clientMatches, locationMatches, matchingDocuments, matchesProposal, sourceCoverage }
