const pdfParse = require('pdf-parse')

const DEFAULT_TEXT_PAGE_CHARS = 5000

async function renderPdfPage(pageData) {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  })
  let lastY
  let text = ''
  for (const item of textContent.items || []) {
    const y = item.transform?.[5]
    text += lastY === undefined || lastY === y ? item.str : `\n${item.str}`
    lastY = y
  }
  return text.trim()
}

function splitTextPages(text, pageChars = DEFAULT_TEXT_PAGE_CHARS) {
  if (!text?.trim()) return [{ pageNumber: 1, text: '' }]
  const explicitPages = text.split('\f')
  if (explicitPages.length > 1) {
    return explicitPages.map((page, index) => ({ pageNumber: index + 1, text: page.trim() }))
  }

  const pages = []
  let current = ''
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > pageChars) {
      pages.push({ pageNumber: pages.length + 1, text: current.trim() })
      current = ''
    }
    current += `${current ? '\n' : ''}${line}`
  }
  if (current || !pages.length) pages.push({ pageNumber: pages.length + 1, text: current.trim() })
  return pages
}

async function pdfPageCount(buffer) {
  const parsed = await pdfParse(buffer, { max: 1, pagerender: async () => '' })
  return parsed.numpages || 1
}

async function pdfPageBatch(buffer, startPage, endPage) {
  let pageNumber = 0
  const pages = []
  const parsed = await pdfParse(buffer, {
    max: endPage,
    pagerender: async pageData => {
      pageNumber += 1
      if (pageNumber < startPage) return ''
      const text = await renderPdfPage(pageData)
      pages.push({ pageNumber, text })
      return ''
    }
  })
  return { totalPages: parsed.numpages || pages.length || 1, pages }
}

module.exports = { pdfPageBatch, pdfPageCount, renderPdfPage, splitTextPages }
