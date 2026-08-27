const assert = require('node:assert/strict')
const { parseCatalogMarkdown } = require('./catalog-import')
const catalog = require('./catalogs/utah-source-catalog.json')

const sample = `## 4. Jones Civil client index and published files
### Brigham City
- [Public Works Standards — full set](https://example.gov/standards.pdf)
- [Hazard Communication Standard](https://example.gov/hazcom.pdf)
`
const parsed = parseCatalogMarkdown(sample)
assert.equal(parsed.length, 2)
assert.equal(parsed[0].jurisdiction, 'Brigham City, Utah')
assert.equal(parsed[0].sourceCategory, 'city_engineering')
assert.equal(parsed[1].sourceCategory, 'contract_requirements')
assert.ok(catalog.sourceCount >= 170)
assert.equal(catalog.records.length, catalog.sourceCount)
assert.ok(catalog.records.some(record => record.sourceCategory === 'city_engineering' && record.jurisdiction.includes('Brigham City')))
assert.ok(catalog.records.some(record => record.sourceCategory === 'natural_hazards' && record.sourceUrl.includes('geology.utah.gov')))
assert.ok(catalog.records.some(record => record.sourceCategory === 'site_subsurface' && record.sourceUrl.includes('wellsearch')))

console.log('Utah catalog import: ok')
