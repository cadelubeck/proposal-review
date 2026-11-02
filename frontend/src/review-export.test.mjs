import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { buildReviewReport, reportText, reportPdf } from './review-export.mjs'
const require = createRequire(import.meta.url)
const parsePdf = require('../../backend/node_modules/pdf-parse')

const proposal = { id:'test', name:'Ogden / Bore <script>', company:'Test', location:'Ogden, UT' }
const results = {
  document_review:{status:'completed',totalPages:29,reviewedPages:29,pageReviews:[{pageNumber:29,score:'yellow',summary:'Final page summary',findings:[{finding:'DOCUMENT MARKER',evidence:'Quoted document evidence',recommendation:'Revise the plan'}]}]},
  standards_comparison:{matrix:[{subject:'STANDARD MARKER',requirement:'24-inch cover',source:{page:84,url:'https://www.ogdencity.gov/standards',excerpt:'Minimum allowable cover'},calculationChecks:[{status:'mismatch',reason:'CALCULATION MARKER'}]}]},
  diagram_analysis:{summary:'Diagram summary',validationNotes:['VALIDATION MARKER'],standardsChecks:[{subject:'DIAGRAM STANDARD',requirement:'3-foot offset'}],researchFindings:[{finding:'RESEARCH MARKER',sourceUrl:'https://example.gov/requirement'}],diagrams:[{type:'Plan',location:'A2',missingElements:['MISSING MARKER'],positives:['POSITIVE MARKER'],concerns:['DIAGRAM MARKER']}]}
}
for (const type of Object.keys(results)) {
  const text = reportText(buildReviewReport(proposal, results, type))
  const own = type === 'document_review' ? 'DOCUMENT MARKER' : type === 'standards_comparison' ? 'STANDARD MARKER' : 'DIAGRAM MARKER'
  assert.ok(text.includes(own))
  for(const marker of ['DOCUMENT MARKER','STANDARD MARKER','DIAGRAM MARKER']) if(marker !== own) assert.ok(!text.includes(marker), 'Individual downloads must not include another review')
}
const all = buildReviewReport(proposal, results)
const combined = reportText(all)
for(const marker of ['DOCUMENT MARKER','STANDARD MARKER','DIAGRAM MARKER','CALCULATION MARKER','RESEARCH MARKER','MISSING MARKER','POSITIVE MARKER','VALIDATION MARKER','https://www.ogdencity.gov/standards']) assert.ok(combined.includes(marker), marker)
assert.ok(!all.filename.includes('/'))
assert.ok(reportText(buildReviewReport(proposal, {}, 'all')).includes('No saved results'))
assert.ok(reportText(buildReviewReport(proposal, {document_review:{status:'stopped',reviewedPages:3,totalPages:29}}, 'document_review')).includes('PARTIAL REVIEW'))
assert.ok(reportText(buildReviewReport(proposal, results, 'diagram_analysis', {diagram_analysis:{status:'running'}})).includes('previous saved results'))
const long = buildReviewReport(proposal, results)
long.blocks.push({kind:'body',text:('Long recommendation with evidence and source details. ').repeat(2500) + 'END OF LONG REPORT'})
const pdf = await reportPdf(long)
assert.ok(pdf.getNumberOfPages() > 10)
const parsed = await parsePdf(Buffer.from(pdf.output('arraybuffer')))
assert.ok(parsed.text.includes('END OF LONG REPORT'), 'Pagination must preserve the final content')
assert.ok(parsed.text.includes('DOCUMENT MARKER'))
assert.ok(parsed.text.includes('CALCULATION MARKER'))
console.log('Review exports: individual isolation, complete combined content, citations, partial status and multipage PDF: ok')
