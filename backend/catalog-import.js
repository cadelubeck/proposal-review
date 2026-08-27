const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const CATALOG_VERSION = '2026-08-26'

function plainText(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^[-|\s]+|[-|\s]+$/g, '')
    .trim()
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}

function stableId(url, category, context) {
  const digest = crypto.createHash('sha256').update(`${url}|${category}|${context}`).digest('hex').slice(0, 12)
  return `utah-catalog-${slug(context) || 'source'}-${digest}`
}

function categoryFor(section, title, context) {
  const value = `${title} ${context}`.toLowerCase()
  if (/bid tab|awarded price|estimate|commodity|labor rate|impact fee|fee report/.test(value)) return 'cost_schedule'
  if (/prequalification|license|disciplin|entity information|exclusion|osha|safety history/.test(value)) return 'vendor_qualifications'
  if (/hazard communication|buy america|baba|contract term|prevailing wage|certified payroll|bonding requirement|insurance requirement/.test(value)) return 'contract_requirements'
  if (/plan holder|purchasing|procurement|solicitation/.test(value)) return 'procurement_rules'
  if (/addendum|project manual|project page|current projects|preview/.test(value)) return 'project_documents'
  if (/capital facilities|master plan|general plan|land use|forecast|planning study|planned project/.test(value)) return 'capital_planning'
  if (/traffic|crash|transportation|street plan|roadway/.test(value)) return 'transportation'
  if (/wetland|species|environment|water quality|drinking.water|watershed|air|noise|cleanup|echo|shpo|cultural/.test(value)) return 'water_environment'
  if (/groundwater|well log|water table|soil|geotechnical|brownfield|contamination/.test(value)) return 'site_subsurface'
  if (/earthquake|hazard|fault|liquefaction|flood|wildfire|climate|landslide/.test(value)) return 'natural_hazards'
  if (/parcel|gis|map|survey|monument|elevation|topograph|imagery|boundary|zoning map/.test(value)) return 'gis_survey'
  if (/utility|water right|irrigation service|blue stakes|811/.test(value)) return 'utilities'
  if (/permit|agency coordination|review workflow|checklist/.test(value)) return 'permitting_coordination'
  if (/contract/.test(value)) return 'contract_requirements'
  if (/public works standard|standard drawing|specification|standards —|standards$|design criteria/.test(value)) return 'city_engineering'
  if (/code|ada|mutcd|r309|r317|ordinance|resolution|dopl uniform/.test(value)) return 'applicable_codes'
  if (section === 'Geography, parcels, terrain, and survey control') return 'gis_survey'
  if (section === 'Earthquake and other natural hazards') return 'natural_hazards'
  if (section === 'Groundwater, soils, water resources, and utilities') return 'site_subsurface'
  if (section === 'Environmental and cultural resources') return 'water_environment'
  if (section === 'Transportation and growth') return 'transportation'
  if (section === 'Procurement, contracts, vendors, cost, and performance') return 'procurement_rules'
  if (section === 'Standards and design criteria') return 'applicable_codes'
  if (section === 'City standards, codes, permits, and plans') return 'applicable_codes'
  return 'project_documents'
}

function jurisdictionFor(sectionNumber, context, title, url) {
  if (sectionNumber.startsWith('4.') || sectionNumber.startsWith('5.')) {
    if (context.includes('—')) return context.split('—').pop().trim()
    if (/North Ogden/i.test(context)) return 'North Ogden City, Utah'
    return `${context}, Utah`
  }
  const county = `${title} ${context}`.match(/(Box Elder|Cache|Davis|Utah|Weber|Morgan) County/i)
  if (county) return `${county[1]} County, Utah`
  if (/\.gov|jonescivil\.com|bluestakes\.org/.test(url)) return 'Utah'
  return 'Utah'
}

function authorityLevel(title, url) {
  const value = `${title} ${url}`.toLowerCase()
  if (/addendum|clarification/.test(value)) return 'controlling'
  if (/adopted|ddw-approved|utah code|laws and rules|r309|r317/.test(value)) return 'adopted'
  if (/standards|specification|drawing|contract/.test(value)) return 'incorporated'
  if (/map|portal|search|data|index|client page|project page|preview|plan holder/.test(value)) return 'screening'
  return 'guidance'
}

function documentStatus(title) {
  const value = title.toLowerCase()
  if (/watermarked|preview|plan holders?/.test(value)) return 'bidding-only'
  if (/addendum/.test(value)) return 'construction-issued'
  if (/adopted|approved|current edition/.test(value)) return 'current'
  return 'unknown'
}

function parseCatalogMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/)
  const records = []
  let sectionNumber = ''
  let section = ''
  let context = ''

  for (const line of lines) {
    if (line.startsWith('## ')) {
      sectionNumber = line.slice(3).trim()
      section = ''
      context = ''
      continue
    }
    if (line.startsWith('### ')) {
      context = line.slice(4).trim()
      if (sectionNumber.startsWith('2.')) section = context
      continue
    }
    if (!line.includes('](')) continue

    const cells = line.startsWith('|') ? line.split('|').map(plainText).filter(Boolean) : []
    const need = cells[0] && cells[0] !== 'Need' ? cells[0] : ''
    const guidance = cells.length >= 3 ? cells[cells.length - 1] : ''
    for (const match of line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
      const linkTitle = plainText(match[1])
      const displayTitle = sectionNumber.startsWith('4.') || sectionNumber.startsWith('5.')
        ? `${context} — ${linkTitle}`
        : linkTitle
      const category = categoryFor(section, `${linkTitle} ${need}`, sectionNumber.startsWith('4.') || sectionNumber.startsWith('5.') ? context : '')
      const url = match[2]
      const notes = [need, guidance, sectionNumber.startsWith('4.') || sectionNumber.startsWith('5.') ? plainText(line) : '']
        .filter(Boolean).filter((item, index, items) => items.indexOf(item) === index).join(' — ')
      records.push({
        id: stableId(url, category, context || section),
        title: displayTitle,
        documentType: url.toLowerCase().includes('.pdf') ? 'published_document' : 'authoritative_portal',
        sourceCategory: category,
        jurisdiction: jurisdictionFor(sectionNumber, context, displayTitle, url),
        client: '',
        projectTypes: [],
        sourceUrl: url,
        publisher: new URL(url).hostname.replace(/^www\./, ''),
        authorityLevel: authorityLevel(displayTitle, url),
        documentStatus: documentStatus(displayTitle),
        catalogScope: sectionNumber.startsWith('5.') ? 'project' : sectionNumber.startsWith('4.') ? 'municipal' : 'statewide',
        catalogSection: section || sectionNumber,
        notes,
        visibility: 'shared',
        sensitivity: 'public',
        requirements: [],
        extractionStatus: 'url_only',
        retrievedAt: `${CATALOG_VERSION}T00:00:00.000Z`,
        createdAt: `${CATALOG_VERSION}T00:00:00.000Z`,
        createdById: 'system-catalog-import',
        health: { status: 'unchecked', checkedAt: null, changed: false }
      })
    }
  }

  const byKey = new Map()
  for (const record of records) {
    const key = `${record.sourceUrl}|${record.sourceCategory}|${record.jurisdiction}`
    const existing = byKey.get(key)
    if (!existing) byKey.set(key, record)
    else if (!existing.notes.includes(record.notes)) existing.notes = [existing.notes, record.notes].filter(Boolean).join(' | ')
  }
  return [...byKey.values()]
}

function main() {
  const inputPath = process.argv[2]
  const outputPath = process.argv[3] || path.join(__dirname, 'catalogs', 'utah-source-catalog.json')
  if (!inputPath) throw new Error('Usage: node catalog-import.js <catalog.md> [output.json]')
  const records = parseCatalogMarkdown(fs.readFileSync(path.resolve(inputPath), 'utf8'))
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify({ version: CATALOG_VERSION, sourceCount: records.length, records }, null, 2)}\n`)
  console.log(`Wrote ${records.length} governed sources to ${outputPath}`)
}

if (require.main === module) main()

module.exports = { categoryFor, parseCatalogMarkdown }
