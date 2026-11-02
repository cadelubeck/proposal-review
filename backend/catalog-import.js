const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { SOURCE_CATEGORY_KEYS } = require('./source-catalog')

const CATALOG_VERSION = '2026-11-01'
const MARKDOWN_LINK = /\[([^\]]+)\]\(\s*<?(https?:\/\/[^)>]+)>?\s*\)/g

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

function markdownLinks(value) {
  return [...value.matchAll(MARKDOWN_LINK)].map(match => ({
    title: plainText(match[1]),
    url: match[2]
  }))
}

function validHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function publisherFor(value) {
  if (!validHttpUrl(value)) return null
  return new URL(value).hostname.replace(/^www\./, '')
}

function parseCategories(value) {
  return value
    .split(',')
    .map(item => item.trim().replace(/\..*$/, ''))
    .filter(item => SOURCE_CATEGORY_KEYS.includes(item))
}

function parseMunicipalityInventory(markdown) {
  const municipalities = []
  const records = []
  let inSection = false
  let municipality = null

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      if (municipality) municipalities.push(municipality)
      municipality = null
      inSection = /^## 8\./.test(line)
      continue
    }
    if (!inSection) continue

    if (line.startsWith('### ')) {
      if (municipality) municipalities.push(municipality)
      municipality = {
        name: line.slice(4).trim(),
        state: 'Utah',
        counties: [],
        placeFips: null,
        baselineRecords: 0,
        officialSourceUrl: null,
        categoriesWithSources: [],
        categoriesWithoutSources: [],
        resourceLinkCount: 0,
        sourceInventoryStatus: 'unverified'
      }
      continue
    }
    if (!municipality) continue

    const metadata = line.match(/State:\s*([^.]+)\.\s*Nation:[^.]+\.\s*Counties:\s*([^.]+)\.\s*Boundary-layer place FIPS:\s*`([^`]+)`[^.]*\.\s*Baseline records:\s*(\d+)\./)
    if (metadata) {
      municipality.state = metadata[1].trim()
      municipality.counties = metadata[2].split(',').map(value => value.trim()).filter(Boolean)
      municipality.placeFips = metadata[3].trim()
      municipality.baselineRecords = Number(metadata[4])
      continue
    }

    if (line.startsWith('Starting source:')) {
      municipality.officialSourceUrl = markdownLinks(line)[0]?.url ?? null
      continue
    }

    const withSources = line.match(/^Categories with discovery links:\s*(.+)\.$/)
    if (withSources) {
      municipality.categoriesWithSources = parseCategories(withSources[1])
      continue
    }

    const withoutSources = line.match(/^Categories without a city-specific link in this inventory:\s*(.+)\.$/)
    if (withoutSources) {
      municipality.categoriesWithoutSources = parseCategories(withoutSources[1])
      continue
    }

    if (!line.startsWith('|')) continue
    const rawCells = line.split('|').slice(1, -1)
    const cells = rawCells.map(plainText)
    if (cells.length < 5 || !SOURCE_CATEGORY_KEYS.includes(cells[0])) continue
    const exactSource = markdownLinks(rawCells[2] || '')
    const source = exactSource[0]
    if (!source) continue

    const discoveredFrom = markdownLinks(rawCells[3] || '')[0]?.url ?? null
    const sourceCategory = cells[0]
    const title = cells[1]
    const accessCheck = cells[4]
    const jurisdiction = `${municipality.name}, Utah`
    const id = stableId(source.url, sourceCategory, jurisdiction)
    const sourceUrl = validHttpUrl(source.url) ? source.url : null
    const sourceAccessCheck = sourceUrl
      ? accessCheck
      : `Invalid URL recorded in inventory: ${source.url}. ${accessCheck}`
    records.push({
      id,
      title: `${municipality.name} — ${title}`,
      documentType: /\.pdf(?:$|[?#])/i.test(source.url) ? 'published_document' : 'authoritative_portal',
      sourceCategory,
      jurisdiction,
      counties: municipality.counties,
      client: '',
      projectTypes: [],
      sourceUrl,
      reportedUrl: sourceUrl ? undefined : source.url,
      publisher: publisherFor(source.url),
      authorityLevel: 'screening',
      documentStatus: 'unknown',
      catalogScope: 'municipal',
      catalogSection: 'Utah municipal source inventory',
      discoveryStatus: 'unverified',
      discoveredFrom,
      accessCheck: sourceAccessCheck,
      notes: `Discovery record only. ${sourceAccessCheck} Adoption, current status, project applicability, and requirements have not been verified.`,
      visibility: 'shared',
      sensitivity: 'public',
      requirements: [],
      extractionStatus: 'url_only',
      retrievedAt: `${CATALOG_VERSION}T00:00:00.000Z`,
      createdAt: `${CATALOG_VERSION}T00:00:00.000Z`,
      createdById: 'system-catalog-import',
      health: { status: 'unchecked', checkedAt: null, changed: false }
    })
    municipality.resourceLinkCount += 1
  }

  if (municipality) municipalities.push(municipality)
  return { municipalities, records }
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
    if (sectionNumber.startsWith('8.')) continue
    if (!line.includes('](')) continue

    const cells = line.startsWith('|') ? line.split('|').map(plainText).filter(Boolean) : []
    const need = cells[0] && cells[0] !== 'Need' ? cells[0] : ''
    const guidance = cells.length >= 3 ? cells[cells.length - 1] : ''
    for (const match of markdownLinks(line)) {
      const linkTitle = match.title
      const displayTitle = sectionNumber.startsWith('4.') || sectionNumber.startsWith('5.')
        ? `${context} — ${linkTitle}`
        : linkTitle
      const category = categoryFor(section, `${linkTitle} ${need}`, sectionNumber.startsWith('4.') || sectionNumber.startsWith('5.') ? context : '')
      const url = match.url
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
        sourceUrl: validHttpUrl(url) ? url : null,
        reportedUrl: validHttpUrl(url) ? undefined : url,
        publisher: publisherFor(url),
        authorityLevel: authorityLevel(displayTitle, url),
        documentStatus: documentStatus(displayTitle),
        catalogScope: sectionNumber.startsWith('5.') ? 'project' : sectionNumber.startsWith('4.') ? 'municipal' : 'statewide',
        catalogSection: section || sectionNumber,
        discoveryStatus: 'unverified',
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

  records.push(...parseMunicipalityInventory(markdown).records)
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
  const markdown = fs.readFileSync(path.resolve(inputPath), 'utf8')
  const records = parseCatalogMarkdown(markdown)
  const { municipalities } = parseMunicipalityInventory(markdown)
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify({
    version: CATALOG_VERSION,
    sourceCount: records.length,
    municipalityCount: municipalities.length,
    municipalities,
    records
  }, null, 2)}\n`)
  console.log(`Wrote ${records.length} source records and ${municipalities.length} municipalities to ${outputPath}`)
}

if (require.main === module) main()

module.exports = { categoryFor, parseCatalogMarkdown, parseMunicipalityInventory }
