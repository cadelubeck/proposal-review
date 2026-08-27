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

function stateFrom(value) {
  const text = normalized(value)
  if (/\butah\b/.test(text)) return 'Utah'
  return null
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

function municipalJurisdictions(documents) {
  return [...new Set(documents
    .filter(doc => ['municipal', 'project'].includes(doc.catalogScope) || /\bcity\b/i.test(doc.jurisdiction || ''))
    .map(doc => String(doc.jurisdiction || '').trim())
    .filter(value => value && !/\b(county|district|company)\b/i.test(value)))]
}

function resolveProposalJurisdiction(documents, proposal) {
  const location = String(proposal?.location || '').trim()
  const localLocation = normalized(location).replace(/\butah\b/g, '').trim()
  const candidates = municipalJurisdictions(documents)
    .filter(jurisdiction => {
      const localJurisdiction = normalized(jurisdiction).replace(/\butah\b/g, '').trim()
      return localLocation && locationMatches(localLocation, localJurisdiction)
    })
    .sort((a, b) => {
      const aHasState = stateFrom(a) ? 1 : 0
      const bHasState = stateFrom(b) ? 1 : 0
      return bHasState - aHasState || b.length - a.length
    })
  const selected = candidates[0] || null
  const state = stateFrom(location) || stateFrom(selected)
  const city = selected ? selected.replace(/,?\s+(Utah|UT)$/i, '').trim() : null
  return { state, city, resolved: Boolean(state && city), submittedLocation: location }
}

function isGenericPublisherIndex(doc) {
  if (doc.catalogScope !== 'statewide') return false
  try {
    const url = new URL(doc.sourceUrl)
    return url.hostname.replace(/^www\./, '') === 'jonescivil.com' && url.pathname === '/'
  } catch { return false }
}

function jurisdictionTier(doc, jurisdiction) {
  if (!jurisdiction.resolved || !doc.jurisdiction) return null
  if (isGenericPublisherIndex(doc)) return null
  const source = normalized(doc.jurisdiction)
  const state = normalized(jurisdiction.state)
  if (source === state || source === `state of ${state}`) return 'state'
  if (/\b(county|district|company)\b/i.test(doc.jurisdiction)) return null
  if (locationMatches(`${jurisdiction.city}, ${jurisdiction.state}`, doc.jurisdiction)) return 'city'
  return null
}

function jurisdictionDocuments(documents, proposal) {
  const jurisdiction = resolveProposalJurisdiction(documents, proposal)
  return documents
    .map(doc => ({ doc, tier: jurisdictionTier(doc, jurisdiction) }))
    .filter(item => item.tier)
    .sort((a, b) => {
      const tierOrder = { state: 0, city: 1 }
      const authorityOrder = { controlling: 0, adopted: 1, incorporated: 2, guidance: 3, screening: 4, unknown: 5 }
      return tierOrder[a.tier] - tierOrder[b.tier]
        || (authorityOrder[a.doc.authorityLevel] ?? 5) - (authorityOrder[b.doc.authorityLevel] ?? 5)
        || a.doc.title.localeCompare(b.doc.title)
    })
}

function matchingDocuments(documents, proposal) {
  return jurisdictionDocuments(documents, proposal)
    .filter(({ doc }) => doc.extractionStatus === 'complete' && clientMatches(proposal.company, doc.client))
    .map(({ doc, tier }) => ({ ...doc, jurisdictionTier: tier }))
}

function researchDocuments(documents, proposal) {
  return jurisdictionDocuments(documents, proposal)
    .filter(({ doc }) => doc.sourceUrl && (doc.sensitivity || 'public') !== 'restricted')
    .map(({ doc, tier }) => ({ ...doc, jurisdictionTier: tier }))
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
  const jurisdiction = resolveProposalJurisdiction(allDocuments, proposal)
  const selected = jurisdictionDocuments(allDocuments, proposal)
  const complete = allDocuments.filter(doc => doc.extractionStatus === 'complete')
  const matched = matchingDocuments(allDocuments, proposal)
  const research = researchDocuments(allDocuments, proposal)
  const pending = selected.map(item => item.doc).filter(doc => doc.extractionStatus !== 'complete')
  return {
    jurisdiction,
    repositoryDocumentCount: allDocuments.length,
    jurisdictionDocumentCount: selected.length,
    excludedJurisdictionDocumentCount: allDocuments.length - selected.length,
    stateDocumentCount: selected.filter(item => item.tier === 'state').length,
    cityDocumentCount: selected.filter(item => item.tier === 'city').length,
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
      jurisdictionTier: doc.jurisdictionTier,
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
      notes: doc.notes || '',
      jurisdictionTier: doc.jurisdictionTier
    })),
    coverage: sourceCoverage(matched, research),
    researchDomains: RESEARCH_DOMAINS
  }
}

module.exports = { RESEARCH_DOMAINS, buildSourceStatus, clientMatches, jurisdictionDocuments, jurisdictionTier, locationMatches, matchingDocuments, matchesProposal, researchDocuments, resolveProposalJurisdiction, sourceCoverage }
