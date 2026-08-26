const assert = require('node:assert/strict')
const { buildSourceStatus, locationMatches, matchingDocuments } = require('./source-context')

assert.equal(locationMatches('Brigham City', 'Brigham City, UT'), true)
assert.equal(locationMatches('Box Elder, Utah', 'Box Elder County, UT'), false)
assert.equal(locationMatches('Layton, Utah', 'Brigham City, UT'), false)

const proposal = { location: 'Brigham City', company: "McDonald's" }
const documents = [
  { id: 'city', title: 'Brigham City Standards', documentType: 'city_standard', jurisdiction: 'Brigham City, UT', extractionStatus: 'complete', requirements: [{ id: 1 }] },
  { id: 'water', title: 'Groundwater Report', documentType: 'groundwater', jurisdiction: 'Brigham City', extractionStatus: 'complete', requirements: [{ id: 2 }, { id: 3 }] },
  { id: 'pending', title: 'Seismic Report', documentType: 'seismic', jurisdiction: 'Brigham City', extractionStatus: 'pending', requirements: [] },
  { id: 'other', title: 'Layton Standards', documentType: 'city_standard', jurisdiction: 'Layton, UT', extractionStatus: 'complete', requirements: [{ id: 4 }] }
]

assert.deepEqual(matchingDocuments(documents, proposal).map(doc => doc.id), ['city', 'water'])
const status = buildSourceStatus(documents, proposal)
assert.equal(status.matchedDocumentCount, 2)
assert.equal(status.matchedRequirementCount, 3)
assert.equal(status.coverage.length, 17)
assert.equal(status.coverage.find(area => area.key === 'site_subsurface').status, 'available')
assert.equal(status.coverage.find(area => area.key === 'natural_hazards').status, 'missing')
assert.equal(status.pendingDocuments.length, 1)

console.log('source context: ok')
