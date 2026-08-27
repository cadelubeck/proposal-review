const { readStandards, writeStandards } = require('./persistence')
const catalog = require('./catalogs/utah-source-catalog.json')

async function main() {
  const shared = await readStandards('_shared')
  const currentCatalogIds = new Set(catalog.records.map(record => record.id))
  const retained = shared.filter(record => record.createdById !== 'system-catalog-import' || currentCatalogIds.has(record.id))
  const byId = new Map(retained.map(record => [record.id, record]))
  for (const record of catalog.records) {
    const existing = byId.get(record.id)
    byId.set(record.id, existing ? { ...record, ...existing, health: existing.health || record.health } : record)
  }
  const merged = [...byId.values()]
  await writeStandards('_shared', merged)
  console.log(`Shared catalog contains ${merged.length} sources (${catalog.records.length} from Utah catalog ${catalog.version}).`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
