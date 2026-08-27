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
  'utah.gov',
  'le.utah.gov',
  'commerce.utah.gov',
  'deq.utah.gov',
  'waterrights.utah.gov',
  'gis.utah.gov',
  'geology.utah.gov',
  'floodhazards.utah.gov',
  'ffsl.utah.gov',
  'udot.utah.gov',
  'connect.udot.utah.gov',
  'udottraffic.utah.gov',
  'atlas.utah.gov',
  'ushpo.utah.gov',
  'wfrc.utah.gov',
  'magutah.gov',
  'cachempo.gov',
  'jonescivil.com'
]

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\but\b/g, 'utah').trim()
}

function locationMatches(proposalLocation, sourceJurisdiction) {
  if (!sourceJurisdiction) return true
  const proposal = normalized(proposalLocation)
  const source = normalized(sourceJurisdiction)
  if (!proposal) return false
  if (/\bcounty\b/.test(proposal) !== /\bcounty\b/.test(source) && (/\bcounty\b/.test(proposal) || /\bcounty\b/.test(source))) return false
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

function researchMatchesProposal(doc, proposal) {
  if (!doc.sourceUrl || (doc.sensitivity || 'public') === 'restricted') return false
  if (['statewide', 'federal'].includes(doc.catalogScope)) return true
  const jurisdiction = normalized(doc.jurisdiction)
  if (!jurisdiction || ['utah', 'state of utah', 'united states', 'usa', 'federal'].includes(jurisdiction)) return true
  return locationMatches(proposal.location, doc.jurisdiction)
}

function matchingDocuments(documents, proposal) {
  return documents.filter(doc => doc.extractionStatus === 'complete' && matchesProposal(doc, proposal))
}

function researchDocuments(documents, proposal) {
  return documents.filter(doc => researchMatchesProposal(doc, proposal))
}

function sourceCoverage(extractedDocuments, catalogDocuments = extractedDocuments) {
  return SOURCE_CATEGORIES.map(area => {
    const matches = extractedDocuments.filter(doc => documentCategory(doc) === area.key)
    const catalogMatches = catalogDocuments.filter(doc => documentCategory(doc) === area.key)
    return {
      key: area.key,
      label: area.label,
      description: area.description,
      sensitive: !!area.sensitive,
      status: matches.length ? 'available' : catalogMatches.length ? 'catalogued' : 'missing',
      documentIds: matches.map(doc => doc.id),
      documents: matches.map(doc => ({ id: doc.id, title: doc.title, documentType: doc.documentType, jurisdiction: doc.jurisdiction || '' })),
      catalogSourceIds: catalogMatches.map(doc => doc.id),
      catalogSources: catalogMatches.slice(0, 20).map(doc => ({ id: doc.id, title: doc.title, sourceUrl: doc.sourceUrl, jurisdiction: doc.jurisdiction || '', authorityLevel: doc.authorityLevel || 'unknown' }))
    }
  })
}

function buildSourceStatus(allDocuments, proposal) {
  const complete = allDocuments.filter(doc => doc.extractionStatus === 'complete')
  const matched = matchingDocuments(allDocuments, proposal)
  const research = researchDocuments(allDocuments, proposal)
  const pending = allDocuments.filter(doc => doc.extractionStatus !== 'complete')
  return {
    repositoryDocumentCount: allDocuments.length,
    extractedDocumentCount: complete.length,
    matchedDocumentCount: matched.length,
    matchedRequirementCount: matched.reduce((total, doc) => total + (doc.requirements?.length || 0), 0),
    researchSourceCount: research.length,
    pendingDocuments: pending.map(doc => ({ id: doc.id, title: doc.title, extractionStatus: doc.extractionStatus })),
    matchedDocuments: matched.map(doc => ({
      id: doc.id,
      title: doc.title,
      documentType: doc.documentType,
      jurisdiction: doc.jurisdiction || '',
      client: doc.client || '',
      requirementCount: doc.requirements?.length || 0
    })),
    researchSources: research.slice(0, 250).map(doc => ({
      id: doc.id,
      title: doc.title,
      sourceCategory: documentCategory(doc),
      sourceUrl: doc.sourceUrl,
      jurisdiction: doc.jurisdiction || '',
      authorityLevel: doc.authorityLevel || 'unknown',
      documentStatus: doc.documentStatus || 'unknown',
      notes: doc.notes || ''
    })),
    coverage: sourceCoverage(matched, research),
    researchDomains: RESEARCH_DOMAINS
  }
}

module.exports = { RESEARCH_DOMAINS, buildSourceStatus, clientMatches, locationMatches, matchingDocuments, matchesProposal, researchDocuments, researchMatchesProposal, sourceCoverage }
