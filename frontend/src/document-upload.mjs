const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export async function readUploadResponse(response) {
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch {
    if (response.status === 413) throw new Error('The upload exceeded the server limit. Refresh the page and try again. Files must be 50 MB or smaller.')
    throw new Error(`The upload service returned an unexpected response (${response.status}). Please try again.`)
  }
  if (!response.ok) throw new Error(data.error || data.message || `Upload failed (${response.status}).`)
  return data
}

export async function uploadDocument(apiFetch, url, { file, fields = {}, purpose, proposalId }) {
  let receipt
  if (file) {
    if (!file.size) throw new Error('The selected file is empty.')
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('Files must be 50 MB or smaller.')
    if (!/\.(pdf|txt)$/i.test(file.name)) throw new Error('Only PDF and text files are supported.')
    const prepared = await readUploadResponse(await apiFetch('/api/uploads/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type, purpose, proposalId })
    }))
    if (prepared.direct) {
      // This request deliberately uses fetch, not apiFetch: the application session
      // must not be sent to Storage. The URL authorizes only this new object.
      const body = new FormData()
      body.append('cacheControl', '3600')
      body.append('', file)
      await readUploadResponse(await fetch(prepared.uploadUrl, { method: 'PUT', body }))
      receipt = prepared.receipt
    }
  }
  if (receipt || !file) {
    return readUploadResponse(await apiFetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, ...(receipt ? { uploadReceipt: receipt } : {}) })
    }))
  }
  const body = new FormData()
  body.append('file', file)
  Object.entries(fields).forEach(([key, value]) => body.append(key, value))
  return readUploadResponse(await apiFetch(url, { method: 'POST', body }))
}
