const assert = require('node:assert/strict')
const { parseCatalogMarkdown, parseMunicipalityInventory } = require('./catalog-import')
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

const municipalSample = `## 8. Municipality-specific source details
### Example City

State: Utah. Nation: United States. Counties: Davis, Salt Lake. Boundary-layer place FIPS: \`12345\` (five-digit place code; verify authoritative identifiers before joining). Baseline records: 2.

Starting source: [Example City](<https://example.gov/>) — HTTP 200; HTML retrieved.

Categories with discovery links: city_engineering, applicable_codes.
Categories without a city-specific link in this inventory: natural_hazards, definitions_dictionary. None of the categories is certified complete.

| Provisional category | Source title | Exact source | Discovered from | Access check |
|---|---|---|---|---|
| city_engineering | Public Works Standards | [Source](<https://example.gov/standards.pdf>) | [Publisher page](<https://example.gov/engineering>) | Discovered; target not checked |
`
const municipal = parseMunicipalityInventory(municipalSample)
assert.equal(municipal.municipalities.length, 1)
assert.deepEqual(municipal.municipalities[0].counties, ['Davis', 'Salt Lake'])
assert.equal(municipal.municipalities[0].placeFips, '12345')
assert.equal(municipal.municipalities[0].resourceLinkCount, 1)
assert.deepEqual(municipal.municipalities[0].categoriesWithoutSources, ['natural_hazards', 'definitions_dictionary'])
assert.equal(municipal.records[0].jurisdiction, 'Example City, Utah')
assert.equal(municipal.records[0].sourceUrl, 'https://example.gov/standards.pdf')
assert.equal(municipal.records[0].discoveredFrom, 'https://example.gov/engineering')
assert.equal(municipal.records[0].authorityLevel, 'screening')
assert.equal(municipal.records[0].documentStatus, 'unknown')
assert.deepEqual(municipal.records[0].requirements, [])

assert.ok(catalog.sourceCount >= 170)
assert.equal(catalog.records.length, catalog.sourceCount)
assert.ok(catalog.records.some(record => record.sourceCategory === 'city_engineering' && record.jurisdiction.includes('Brigham City')))
assert.ok(catalog.records.some(record => record.sourceCategory === 'natural_hazards' && record.sourceUrl.includes('geology.utah.gov')))
assert.ok(catalog.records.some(record => record.sourceCategory === 'site_subsurface' && record.sourceUrl.includes('wellsearch')))
assert.equal(catalog.municipalityCount, 257)
assert.equal(catalog.municipalities.length, 257)
assert.equal(new Set(catalog.municipalities.map(municipality => municipality.name)).size, 257)
assert.ok(catalog.municipalities.some(municipality => municipality.name === 'Ogden Valley City'))
assert.ok(catalog.municipalities.some(municipality => municipality.name === 'Spring Lake'))
assert.ok(catalog.records.some(record =>
  record.jurisdiction === 'Ogden, Utah' &&
  record.title.includes('2025') &&
  record.discoveryStatus === 'unverified' &&
  record.requirements.length === 0
))

console.log('Utah catalog import: ok')
