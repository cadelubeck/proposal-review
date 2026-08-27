const assert = require('node:assert/strict')
const { buildSourceStatus, locationMatches, matchingDocuments, researchDocuments, resolveProposalJurisdiction } = require('./source-context')

assert.equal(locationMatches('Brigham City', 'Brigham City, UT'), true)
assert.equal(locationMatches('125 Main Street, Brigham City, UT', 'Brigham City, Utah'), true)
assert.equal(locationMatches('Box Elder, Utah', 'Box Elder County, UT'), false)
assert.equal(locationMatches('Layton, Utah', 'Brigham City, UT'), false)

const proposal = { location: 'Brigham City', company: "McDonald's" }
const documents = [
  { id: 'city', title: 'Brigham City Standards', documentType: 'city_standard', jurisdiction: 'Brigham City, UT', extractionStatus: 'complete', requirements: [{ id: 1 }] },
  { id: 'water', title: 'Groundwater Report', documentType: 'groundwater', jurisdiction: 'Brigham City', extractionStatus: 'complete', requirements: [{ id: 2 }, { id: 3 }] },
  { id: 'pending', title: 'Seismic Report', documentType: 'seismic', jurisdiction: 'Brigham City', extractionStatus: 'pending', requirements: [] },
  { id: 'other', title: 'Layton Standards', documentType: 'city_standard', jurisdiction: 'Layton, UT', extractionStatus: 'complete', requirements: [{ id: 4 }] },
  { id: 'utah-hazards', title: 'Utah Hazards', sourceCategory: 'natural_hazards', jurisdiction: 'Utah', catalogScope: 'statewide', sourceUrl: 'https://geology.utah.gov/hazards/', extractionStatus: 'url_only', requirements: [] },
  { id: 'county', title: 'Box Elder County Standards', sourceCategory: 'city_engineering', jurisdiction: 'Box Elder County, Utah', catalogScope: 'statewide', sourceUrl: 'https://example.gov/county.pdf', extractionStatus: 'url_only', requirements: [] },
  { id: 'other-city-url', title: 'Layton Portal', sourceCategory: 'city_engineering', jurisdiction: 'Layton City, Utah', catalogScope: 'municipal', sourceUrl: 'https://example.gov/layton', extractionStatus: 'url_only', requirements: [] },
  { id: 'jones-index', title: 'Jones client index', sourceCategory: 'city_engineering', jurisdiction: 'Utah', catalogScope: 'statewide', sourceUrl: 'https://jonescivil.com/', extractionStatus: 'url_only', requirements: [] }
]

assert.deepEqual(matchingDocuments(documents, proposal).map(doc => doc.id), ['city', 'water'])
assert.deepEqual(researchDocuments(documents, proposal).map(doc => doc.id), ['utah-hazards'])
const status = buildSourceStatus(documents, proposal)
assert.deepEqual(resolveProposalJurisdiction(documents, proposal), { state: 'Utah', city: 'Brigham City', resolved: true, submittedLocation: 'Brigham City' })
assert.equal(status.jurisdictionDocumentCount, 4)
assert.equal(status.excludedJurisdictionDocumentCount, 4)
assert.equal(status.stateDocumentCount, 1)
assert.equal(status.cityDocumentCount, 3)
assert.equal(status.matchedDocumentCount, 2)
assert.equal(status.matchedRequirementCount, 3)
assert.equal(status.coverage.length, 17)
assert.equal(status.coverage.find(area => area.key === 'site_subsurface').status, 'available')
assert.equal(status.coverage.find(area => area.key === 'natural_hazards').status, 'catalogued')
assert.equal(status.pendingDocuments.length, 2)
assert.equal(status.researchSourceCount, 1)

const unresolved = { location: 'Utah', company: 'Example' }
assert.equal(resolveProposalJurisdiction(documents, unresolved).resolved, false)
assert.deepEqual(researchDocuments(documents, unresolved), [])

console.log('source context: ok')
