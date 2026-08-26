const SOURCE_CATEGORIES = [
  { key: 'city_engineering', label: 'City engineering standards', description: 'Specifications, drawings, manuals, materials, construction details, inspection, and acceptance criteria.' },
  { key: 'applicable_codes', label: 'Applicable codes', description: 'Municipal, zoning, building, fire, DOT, AASHTO, MUTCD, ASTM, ACI, and ADA requirements.' },
  { key: 'natural_hazards', label: 'Natural hazards', description: 'Earthquake, liquefaction, flood, wildfire, landslide, erosion, expansive soils, heat, snow, wind, and climate resilience.' },
  { key: 'site_subsurface', label: 'Site and subsurface conditions', description: 'Groundwater, geology, soils, geotechnical reports, contamination, brownfields, and historic boreholes.' },
  { key: 'gis_survey', label: 'GIS and survey data', description: 'Parcels, rights-of-way, easements, ownership, topography, imagery, benchmarks, coordinate systems, and monuments.' },
  { key: 'utilities', label: 'Utilities', description: 'Water, wastewater, stormwater, power, gas, telecommunications, conflicts, capacity, connections, and owner contacts.', sensitive: true },
  { key: 'transportation', label: 'Transportation', description: 'Traffic, crashes, pavement, transit, active transportation, parking, truck routes, and planned street projects.' },
  { key: 'water_environment', label: 'Water and environmental requirements', description: 'Watersheds, wetlands, drainage, stormwater quality, drinking water, species, trees, air, noise, and environmental review.' },
  { key: 'capital_planning', label: 'Capital planning', description: 'Master plans, capital programs, asset management, development forecasts, and nearby planned projects.' },
  { key: 'permitting_coordination', label: 'Permitting and agency coordination', description: 'Permits, workflows, checklists, review times, and responsible government, railroad, and utility agencies.' },
  { key: 'procurement_rules', label: 'Procurement rules', description: 'Solicitation instructions, evaluation, scoring, conflicts, protests, public records, and communication restrictions.' },
  { key: 'contract_requirements', label: 'Contract requirements', description: 'Insurance, bonding, indemnity, wages, payroll, hiring, DBE/SBE, cybersecurity, records, and change orders.' },
  { key: 'cost_schedule', label: 'Cost and schedule evidence', description: 'Estimates, bid tabs, awards, change orders, claims, indices, labor, review durations, and seasonal constraints.' },
  { key: 'vendor_qualifications', label: 'Vendor qualifications', description: 'Licenses, experience, credentials, safety, financial capacity, references, disclosures, and past performance.' },
  { key: 'project_documents', label: 'Project documents', description: 'Scope, plans, specifications, quantities, reports, addenda, Q&A, permits, funding, grants, and evaluation forms.' },
  { key: 'lessons_learned', label: 'Lessons learned', description: 'Design issues, field conflicts, claims, audits, maintenance problems, and final outcomes.' },
  { key: 'definitions_dictionary', label: 'Definitions and data dictionary', description: 'Fields, acronyms, units, coordinate systems, scoring rules, and missing-value conventions.' }
]

const SOURCE_CATEGORY_KEYS = SOURCE_CATEGORIES.map(category => category.key)

const LEGACY_TYPE_CATEGORY = {
  city_standard: 'city_engineering',
  client_standard: 'applicable_codes',
  manual: 'applicable_codes',
  seismic: 'natural_hazards',
  floodplain: 'natural_hazards',
  groundwater: 'site_subsurface',
  geotechnical: 'site_subsurface',
  geological: 'site_subsurface',
  topographic: 'gis_survey',
  elevation: 'gis_survey',
  engineering_report: 'project_documents',
  web_reference: 'definitions_dictionary'
}

const BASELINE_CATEGORIES = new Set([
  'city_engineering', 'applicable_codes', 'permitting_coordination', 'procurement_rules',
  'contract_requirements', 'project_documents', 'definitions_dictionary'
])

function documentCategory(doc) {
  return SOURCE_CATEGORY_KEYS.includes(doc.sourceCategory) ? doc.sourceCategory : (LEGACY_TYPE_CATEGORY[doc.documentType] || 'project_documents')
}

function categoryDefinition(key) {
  return SOURCE_CATEGORIES.find(category => category.key === key) || null
}

function isBaselineDocument(doc) {
  return BASELINE_CATEGORIES.has(documentCategory(doc))
}

module.exports = { SOURCE_CATEGORIES, SOURCE_CATEGORY_KEYS, LEGACY_TYPE_CATEGORY, categoryDefinition, documentCategory, isBaselineDocument }
