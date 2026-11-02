const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const AUDIENCE = 'document-upload'

function uploadError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}

function uploadMetadata({ name, size, contentType }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 255) throw uploadError('Choose a PDF or text file.')
  if (!Number.isSafeInteger(size) || size <= 0) throw uploadError('The selected file is empty.')
  if (size > MAX_UPLOAD_BYTES) throw uploadError('Files must be 50 MB or smaller.', 413)
  const extension = name.toLowerCase().split('.').pop()
  if (!['pdf', 'txt'].includes(extension)) throw uploadError('Only PDF and text files are supported.')
  const mimetype = extension === 'pdf' ? 'application/pdf' : 'text/plain'
  if (contentType && ![mimetype, 'application/octet-stream'].includes(contentType)) throw uploadError('The file type does not match its extension.')
  return { originalname: name, size, mimetype }
}

function createDirectUploads({ secret, createUploadUrl, readUpload }) {
  return {
    async prepare(user, input) {
      if (!user?.id || !user.companyId) throw uploadError('Your account needs an organization before uploading.', 403)
      if (!['proposal', 'standard', 'version'].includes(input.purpose)) throw uploadError('Invalid upload destination.')
      if (input.purpose === 'version' && typeof input.proposalId !== 'string') throw uploadError('Proposal required for a new version.')
      const metadata = uploadMetadata(input)
      const safeName = metadata.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160)
      const storagePath = `${user.companyId}/direct/${user.id}/${crypto.randomUUID()}/${safeName}`
      const uploadUrl = await createUploadUrl(storagePath)
      const receipt = jwt.sign({
        ...metadata, storagePath, userId: user.id, companyId: user.companyId,
        purpose: input.purpose, proposalId: input.purpose === 'version' ? input.proposalId : null
      }, secret, { audience: AUDIENCE, expiresIn: '2h' })
      return { uploadUrl, receipt, contentType: metadata.mimetype, maxBytes: MAX_UPLOAD_BYTES }
    },

    async resolve(receipt, user, purpose, proposalId) {
      let claims
      try { claims = jwt.verify(receipt, secret, { audience: AUDIENCE, algorithms: ['HS256'] }) }
      catch { throw uploadError('Upload authorization expired or is invalid. Please select the file and try again.') }
      if (!user || claims.userId !== user.id || claims.companyId !== user.companyId || claims.purpose !== purpose
        || (purpose === 'version' && claims.proposalId !== proposalId)) {
        throw uploadError('This upload belongs to a different account or document.', 403)
      }
      const buffer = await readUpload(claims.storagePath, 'supabase')
      if (buffer.length !== claims.size || buffer.length > MAX_UPLOAD_BYTES) throw uploadError('The uploaded file is incomplete or exceeds the 50 MB limit.')
      if (claims.mimetype === 'application/pdf' && !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw uploadError('The uploaded file is not a valid PDF.')
      return { buffer, storagePath: claims.storagePath, originalname: claims.originalname, mimetype: claims.mimetype, size: claims.size }
    }
  }
}

module.exports = { createDirectUploads, uploadMetadata, MAX_UPLOAD_BYTES }
