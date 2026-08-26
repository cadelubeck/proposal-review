const fs = require('fs')
const path = require('path')
const {
  cloud, readIndex, readUsers, readCompanies, readInvites, readStandards,
  writeUsers, writeCompanies, writeInvites, writeProposal, writeStandards, saveUpload
} = require('./persistence')

function readJson(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function mimeType(file) {
  return path.extname(file).toLowerCase() === '.pdf' ? 'application/pdf' : 'text/plain'
}

async function migrateFile(record, fileKey, storageKey, contentTypeKey, companyId, recordId) {
  const source = record[fileKey]
  if (!source || !fs.existsSync(source)) return
  const uploaded = await saveUpload({
    buffer: fs.readFileSync(source),
    originalname: path.basename(source),
    mimetype: record[contentTypeKey] || mimeType(source)
  }, companyId, recordId)
  record[fileKey] = uploaded.path
  record[storageKey] = uploaded.storage
  record[contentTypeKey] = uploaded.contentType
}

async function main() {
  if (!cloud) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this migration.')
  if (process.env.MIGRATE_CONFIRM !== 'EMPTY_SUPABASE_PROJECT') {
    throw new Error('Refusing to migrate. Set MIGRATE_CONFIRM=EMPTY_SUPABASE_PROJECT after confirming the target contains no application data.')
  }

  const remoteSharedStandards = await readStandards('_shared')
  const remoteCounts = {
    proposals: (await readIndex()).length,
    users: (await readUsers()).length,
    companies: (await readCompanies()).length,
    invites: (await readInvites()).length,
    nonSeedSharedStandards: remoteSharedStandards.filter(document => document.createdById !== 'system-seed').length
  }
  if (Object.values(remoteCounts).some(Boolean)) {
    throw new Error(`Target is not empty; migration stopped to prevent overwriting data: ${JSON.stringify(remoteCounts)}`)
  }

  const privateDirectory = path.join(__dirname, '.private')
  const users = readJson(path.join(privateDirectory, 'users.json'))
  const companies = readJson(path.join(privateDirectory, 'companies.json'))
  const invites = readJson(path.join(privateDirectory, 'invites.json'))
  await writeCompanies(companies)
  await writeUsers(users)
  await writeInvites(invites)

  const index = readJson(path.join(__dirname, 'data', 'index.json'))
  for (const summary of index) {
    const proposal = readJson(path.join(__dirname, 'data', `${summary.id}.json`), null)
    if (!proposal) continue
    await migrateFile(proposal, 'file_path', 'file_storage', 'file_content_type', proposal.companyId, proposal.id)
    for (const version of proposal.versions || []) {
      await migrateFile(version, 'file_path', 'file_storage', 'file_content_type', proposal.companyId, `${proposal.id}-version`)
    }
    await writeProposal(proposal.id, proposal)
  }

  const standardsDirectory = path.join(__dirname, 'standards')
  const standardFiles = fs.existsSync(standardsDirectory)
    ? fs.readdirSync(standardsDirectory).filter(name => name.endsWith('.json'))
    : []
  for (const name of standardFiles) {
    const storeKey = path.basename(name, '.json')
    const localDocuments = readJson(path.join(standardsDirectory, name))
    const documents = storeKey === '_shared'
      ? [...remoteSharedStandards, ...localDocuments.filter(document => !remoteSharedStandards.some(seed => seed.id === document.id))]
      : localDocuments
    for (const document of documents) {
      await migrateFile(document, 'filePath', 'fileStorage', 'fileContentType', document.createdByCompanyId || storeKey, `standard-${document.id}`)
    }
    await writeStandards(storeKey, documents)
  }

  console.log(`Migrated ${companies.length} companies, ${users.length} users, ${index.length} proposals, and ${standardFiles.length} standards stores.`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
