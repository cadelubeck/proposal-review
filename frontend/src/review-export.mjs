export const REVIEW_TITLES = { document_review: 'Document review', standards_comparison: 'Standards comparison', diagram_analysis: 'Diagram analysis' }
const label = key => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const display = value => typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
const statusLabel = value => ({ green:'No concern', yellow:'Engineer review', red:'Needs updates', pass:'Meets stated requirement', fail:'Conflict', review:'Engineer review', critical:'Critical', info:'Informational' }[value] || value)

export function buildReviewReport(proposal, results, selection = 'all', jobs = {}, exportedAt = new Date().toISOString()) {
  const types = selection === 'all' ? Object.keys(REVIEW_TITLES) : [selection]
  if (types.some(type => !REVIEW_TITLES[type])) throw new Error('Unknown review type.')
  const blocks = []
  const add = (text, kind = 'body') => { if (text !== undefined && text !== null && text !== '') blocks.push({ kind, text: String(text) }) }
  const fields = (item, excluded = []) => {
    for (const [key, value] of Object.entries(item || {})) {
      if (key === 'id' || excluded.includes(key) || value === undefined || value === null || value === '') continue
      if (Array.isArray(value)) {
        if (!value.length) continue
        add(label(key), 'subheading')
        value.forEach((entry, index) => {
          if (entry && typeof entry === 'object') { add(`${label(key)} ${index + 1}`, 'subheading'); fields(entry) }
          else add(`- ${display(entry)}`)
        })
      } else if (typeof value === 'object') { add(label(key), 'subheading'); fields(value) }
      else if (/^https?:\/\//i.test(String(value))) blocks.push({ kind: 'link', text: `${label(key)}: ${value}`, url: String(value) })
      else add(`${label(key)}: ${display(['score', 'severity', 'result', 'compliance', 'overallCompliance'].includes(key) ? statusLabel(value) : value)}`)
    }
  }
  add(selection === 'all' ? 'Combined AI review report' : REVIEW_TITLES[selection], 'title')
  add(proposal.name || 'Untitled proposal', 'heading')
  fields({ client: proposal.company, location: proposal.location, postalCode: proposal.postalCode, proposalId: proposal.id, exportedAt })
  add('AI-assisted findings for professional review. This report does not constitute engineering approval. Recommendations are proposed changes; they have not been applied to the original document.')
  for (const type of types) {
    const review = results[type]
    const job = jobs[type]
    add(REVIEW_TITLES[type], 'heading')
    if (!review) { add(`No saved results. ${job ? `Review status: ${job.status || 'unknown'}. Completed pages: ${job.completedPages || 0}.` : 'This analysis has not been run.'}`); continue }
    const status = review.status || 'completed'
    const running = ['queued', 'in_progress', 'running'].includes(job?.status)
    fields({ status, generatedAt: review.generatedAt, ...(running ? { snapshot: type === 'document_review' && status !== 'completed' ? 'Partial saved batches from the current run.' : 'A new analysis is running. This export contains the previous saved results.' } : {}) })
    if (type === 'document_review') {
      fields({ reviewedPages: review.reviewedPages, totalPages: review.totalPages, stoppedReason: review.stoppedReason, ...(review.counts ? { pageOutcomes: { needsUpdates:review.counts.red, noConcern:review.counts.green, engineerReview:review.counts.yellow } } : {}) })
      if (status !== 'completed' || review.reviewedPages < review.totalPages) add('PARTIAL REVIEW: this report does not cover every document page.', 'subheading')
      for (const page of review.pageReviews || []) {
        add(`Page ${page.pageNumber} - ${statusLabel(page.score || 'review')}`, 'subheading')
        add(page.summary)
        ;(page.findings || []).forEach((finding, index) => { add(`D-P${page.pageNumber}-F${index + 1}`, 'subheading'); fields(finding) })
      }
    } else if (type === 'standards_comparison') {
      fields(review, ['matrix', 'sourceStatus', 'openai', 'matchedDocumentIds', 'generatedAt', 'status'])
      ;(review.matrix || []).forEach((row, index) => { add(`S-${index + 1}: ${row.subject || 'Requirement'}`, 'subheading'); fields(row, ['id', 'subject']) })
    } else {
      fields(review, ['diagrams', 'sourceStatus', 'openai', 'referenceSources', 'generatedAt', 'status'])
      ;(review.diagrams || []).forEach((diagram, index) => { add(`G-${index + 1}: ${diagram.type || 'Diagram'}`, 'subheading'); fields(diagram, ['type']) })
    }
    if (review.sourceStatus) fields({ jurisdiction: review.sourceStatus.jurisdiction, stateSourceCount: review.sourceStatus.stateDocumentCount, citySourceCount: review.sourceStatus.cityDocumentCount, officialReferences: review.sourceStatus.referenceSources })
  }
  return { title: blocks[0].text, blocks, filename: `${(proposal.name || 'proposal').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'proposal'}-${selection}-review` }
}

export function reportText(report) {
  return report.blocks.map(block => block.kind === 'title' || block.kind === 'heading' ? `\n${block.text}\n${'='.repeat(Math.min(block.text.length, 72))}` : block.kind === 'subheading' ? `\n${block.text}\n` : block.text).join('\n\n') + '\n'
}

function pdfText(text) {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2010-\u2015]/g, '-').replace(/\u2032/g, "'").replace(/\u2033/g, '"').replace(/\u2022/g, '-').replace(/\u2192/g, ' -> ').replace(/\u2264/g, '<=').replace(/\u2265/g, '>=').replace(/\u2260/g, '!=').replace(/\u2212/g, '-').replace(/\u2248/g, 'approx. ').replace(/\u03bc/g, 'u').replace(/\u03c0/g, 'pi').replace(/\u03c3/g, 'sigma').replace(/[\u03c6\u03a6]/g, 'phi').replace(/\u0394/g, 'Delta').replace(/\u2026/g, '...').replace(/[^\x20-\x7e\xa0-\xff\n\r\t]/g, '?')
}

export async function reportPdf(report) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  pdf.setProperties({ title: report.title, subject: 'AI-assisted proposal review', creator: 'City Form Reviewer' })
  const margin = 18, width = 174, bottom = 277
  let y = 22
  for (const block of report.blocks) {
    const heading = ['title', 'heading', 'subheading'].includes(block.kind)
    const size = block.kind === 'title' ? 22 : block.kind === 'heading' ? 15 : block.kind === 'subheading' ? 11 : 10
    pdf.setFont('helvetica', heading ? 'bold' : 'normal')
    pdf.setFontSize(size)
    pdf.setTextColor(...(heading ? [20, 50, 74] : [40, 49, 58]))
    const lines = pdf.splitTextToSize(pdfText(block.text), width)
    const lineHeight = size * 0.48
    if (y + Math.min(lines.length, heading ? lines.length : 2) * lineHeight + (heading ? 10 : 0) > bottom) { pdf.addPage(); y = 22 }
    if (heading) y += 3
    for (const line of lines) {
      if (y + lineHeight > bottom) { pdf.addPage(); y = 22 }
      pdf.text(line, margin, y)
      if (block.url && /^https?:\/\//i.test(block.url)) pdf.link(margin, y - lineHeight + 1, Math.min(width, pdf.getTextWidth(line)), lineHeight, { url: block.url })
      y += lineHeight
    }
    y += heading ? 3 : 2
  }
  const pages = pdf.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100)
    pdf.text('City Form Reviewer | AI-assisted review', margin, 288)
    pdf.text(`${page} / ${pages}`, 192, 288, { align: 'right' })
  }
  return pdf
}

export async function downloadReviewReport(report, format) {
  if (format === 'pdf') { const pdf = await reportPdf(report); pdf.save(`${report.filename}.pdf`); return }
  const blob = new Blob(['\ufeff', reportText(report)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = `${report.filename}.txt`
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
