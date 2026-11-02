import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApiFetch, useAuth } from '../context/AuthContext'
import Icon from '../components/Icon'

const ACTIVE = new Set(['queued', 'in_progress', 'running'])
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

export default function AiReview() {
  const { id } = useParams()
  const nav = useNavigate()
  const apiFetch = useApiFetch()
  const { token } = useAuth()
  const alive = useRef(true)
  const polling = useRef(false)
  const runNumber = useRef(0)
  const initialHashScroll = useRef(false)
  const [proposal, setProposal] = useState(null)
  const [sources, setSources] = useState(null)
  const [runtime, setRuntime] = useState(null)
  const [jobs, setJobs] = useState({ document_review: null, standards_comparison: null, diagram_analysis: null })
  const [results, setResults] = useState({ document_review: null, standards_comparison: null, diagram_analysis: null })
  const [error, setError] = useState('')
  const [starting, setStarting] = useState('')
  const [section, setSection] = useState(() => window.location.hash || '#overview')

  const readJson = async response => {
    try { return await response.json() } catch { return { error: `The server returned an unreadable response (${response.status}).` } }
  }
  const setJob = (type, job) => setJobs(current => ({ ...current, [type]: job || null }))
  const setResult = (type, result) => setResults(current => ({ ...current, [type]: result || null }))

  const refresh = async () => {
    const [proposalResponse, sourceResponse, healthResponse, statusResponse] = await Promise.all([
      apiFetch(`/api/proposals/${id}`),
      apiFetch(`/api/proposals/${id}/analysis-sources`),
      apiFetch('/api/health'),
      apiFetch(`/api/proposals/${id}/ai-status`)
    ])
    if (!proposalResponse.ok) return nav('/')
    const proposalData = await proposalResponse.json()
    setProposal(proposalData)
    if (sourceResponse.ok) setSources(await sourceResponse.json())
    if (healthResponse.ok) setRuntime(await healthResponse.json())
    if (statusResponse.ok) {
      const status = await statusResponse.json()
      setJobs({
        document_review: status.documentReviewJob,
        standards_comparison: status.standardsComparisonJob,
        diagram_analysis: status.diagramAnalysisJob
      })
      setResults({
        document_review: status.documentReview,
        standards_comparison: status.standardsComparison,
        diagram_analysis: status.diagramAnalysis
      })
    }
  }

  useEffect(() => {
    alive.current = true
    initialHashScroll.current = false
    refresh().catch(failure => setError(failure.message))
    return () => { alive.current = false; runNumber.current += 1 }
  }, [id])

  const activeEntry = Object.entries(jobs).find(([, job]) => ACTIVE.has(job?.status))
  const activeType = activeEntry?.[0] || ''

  useEffect(() => {
    if (activeType && !polling.current) continueOperation(activeType)
  }, [activeType])

  useEffect(() => {
    if (results.standards_comparison && window.location.hash === '#controlling-standards') {
      requestAnimationFrame(() => document.getElementById('controlling-standards')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [results.standards_comparison])

  useEffect(() => {
    const syncHash = () => setSection(window.location.hash || '#overview')
    window.addEventListener('hashchange', syncHash)
    return () => window.removeEventListener('hashchange', syncHash)
  }, [])

  useEffect(() => {
    if (!proposal || initialHashScroll.current) return
    initialHashScroll.current = true
    if (window.location.hash) requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block:'start' }))
  }, [proposal])

  const request = async (url, options) => {
    const response = await apiFetch(url, options)
    const data = await readJson(response)
    if (!response.ok) {
      if (data.job) {
        const type = url.includes('document-review') ? 'document_review' : url.includes('compliance-review') ? 'standards_comparison' : 'diagram_analysis'
        setJob(type, data.job)
      }
      throw new Error(data.error || 'AI request failed.')
    }
    return { response, data }
  }

  const pollDocument = async nonce => {
    while (alive.current && nonce === runNumber.current) {
      const { response, data } = await request(`/api/proposals/${id}/document-review/status`)
      setJob('document_review', data.job)
      if (data.review) setResult('document_review', data.review)
      if (response.status !== 202) return
      if (data.readyForNextBatch) {
        const advanced = await request(`/api/proposals/${id}/document-review/advance`, { method: 'POST' })
        setJob('document_review', advanced.data.job)
        if (advanced.data.review) setResult('document_review', advanced.data.review)
        if (advanced.response.status !== 202) return
      }
      await wait(4000)
    }
  }

  const pollComparison = async nonce => {
    while (alive.current && nonce === runNumber.current) {
      await wait(5000)
      const { response, data } = await request(`/api/proposals/${id}/compliance-review/status`)
      if (response.status === 202) setJob('standards_comparison', data.job)
      else { setJob('standards_comparison', null); setResult('standards_comparison', data); return }
    }
  }

  const pollDiagrams = async nonce => {
    while (alive.current && nonce === runNumber.current) {
      await wait(5000)
      const { response, data } = await request(`/api/proposals/${id}/analyze-diagrams/status`)
      if (response.status === 202) setJob('diagram_analysis', data.job)
      else { setJob('diagram_analysis', null); setResult('diagram_analysis', data); return }
    }
  }

  const continueOperation = async type => {
    if (polling.current) return
    polling.current = true
    const nonce = ++runNumber.current
    setError('')
    try {
      if (type === 'document_review') await pollDocument(nonce)
      if (type === 'standards_comparison') await pollComparison(nonce)
      if (type === 'diagram_analysis') await pollDiagrams(nonce)
    } catch (failure) {
      setError(failure.message)
    } finally {
      if (nonce === runNumber.current) polling.current = false
      if (alive.current) await refresh().catch(() => {})
    }
  }

  const startDocumentReview = async () => {
    setStarting('document_review'); setError('')
    try {
      const { data } = await request(`/api/proposals/${id}/document-review/start`, { method: 'POST' })
      setJob('document_review', data.job)
      await continueOperation('document_review')
    } catch (failure) { setError(failure.message) }
    finally { setStarting('') }
  }

  const startComparison = async () => {
    setStarting('standards_comparison'); setError('')
    try {
      const { response, data } = await request(`/api/proposals/${id}/compliance-review`, { method: 'POST' })
      if (response.status === 202) { setJob('standards_comparison', data.job); await continueOperation('standards_comparison') }
      else setResult('standards_comparison', data)
    } catch (failure) { setError(failure.message) }
    finally { setStarting('') }
  }

  const startDiagrams = async () => {
    setStarting('diagram_analysis'); setError('')
    try {
      const { response, data } = await request(`/api/proposals/${id}/analyze-diagrams`, { method: 'POST' })
      if (response.status === 202) { setJob('diagram_analysis', data.job); await continueOperation('diagram_analysis') }
      else setResult('diagram_analysis', data)
    } catch (failure) { setError(failure.message) }
    finally { setStarting('') }
  }

  const stopActive = async () => {
    setError('')
    runNumber.current += 1
    polling.current = false
    try {
      await request(`/api/proposals/${id}/ai/cancel`, { method: 'POST' })
      await refresh()
    } catch (failure) { setError(failure.message) }
  }

  if (!proposal) return <div className="civic-page" role="status" style={{ display:'grid', placeItems:'center', minHeight:'100vh' }}>Loading compliance review…</div>
  const aiReady = runtime?.aiEnabled !== false && runtime?.aiConfigured !== false
  const activeLabel = labels[activeType] || ''
  const locked = Boolean(activeType || starting)
  const buttonText = type => {
    if (!aiReady) return 'AI disabled — cost control'
    if (activeType === type) {
      if (type === 'document_review') {
        const job = jobs[type]
        const start = job?.currentStartPage || Math.min((job?.completedPages || 0) + 1, job?.reviewPageLimit || 1)
        const end = job?.currentEndPage || Math.min(start + 2, job?.reviewPageLimit || start)
        return `Running pages ${start}–${end}…`
      }
      return `${labels[type]} running…`
    }
    if (starting === type) return 'Starting…'
    if (locked) return `Locked — ${activeLabel || 'AI task'} running`
    return results[type] ? `Re-run ${labels[type]}` : runLabels[type]
  }

  const document = results.document_review
  const comparison = results.standards_comparison
  const diagrams = results.diagram_analysis
  const criticalCount = (document?.counts?.red || 0) + (comparison?.summary?.fail || 0) + (diagrams?.criticalIssues?.length || 0)
  const reviewCount = (document?.counts?.yellow || 0) + (comparison?.summary?.review || 0) + (diagrams?.diagrams || []).filter(item => item.compliance === 'yellow').length
  const completedCount = Object.values(results).filter(Boolean).length
  const assessment = criticalCount ? 'Needs updates' : reviewCount ? 'Engineer review' : completedCount ? 'No concern flagged' : 'Awaiting review'
  const lastReview = [document?.generatedAt, comparison?.generatedAt, diagrams?.generatedAt].filter(Boolean).sort().at(-1)
  const sections = [
    ['#overview', 'Overview', 'grid', null],
    ['#document-review-results', 'Document review', 'file', document?.reviewedPages],
    ['#controlling-standards', 'Standards comparison', 'scales', comparison?.matrix?.length],
    ['#diagram-analysis-results', 'Diagram analysis', 'diagram', diagrams?.diagrams?.length]
  ]
  const sectionLinks = sections.map(([href, title, icon, count]) => <a key={href} href={href} onClick={() => setSection(href)} className={`civic-section-link ${section === href ? 'active' : ''}`}><Icon name={icon} size={17} />{title}{count != null && <span className="count">{count}</span>}</a>)

  return <div className="civic-page">
    <header className="civic-header">
      <button onClick={() => nav(`/proposal/${id}`)} className="civic-btn civic-icon-btn" title="Back to proposal" aria-label="Back to proposal"><Icon name="arrow" /></button>
      <a href="/" className="civic-brand"><span className="civic-brand-mark"><Icon name="civic" size={18} /></span><span>CivicReview AI</span></a>
      <div className="civic-header-meta"><strong title={proposal.name}>{proposal.name}</strong><span className="jurisdiction">{[proposal.location, proposal.postalCode].filter(Boolean).join(' · ') || 'Jurisdiction not set'}</span></div>
      {activeType && <button onClick={stopActive} className="civic-btn civic-btn-danger">Stop AI task</button>}
    </header>
    <nav className="civic-mobile-nav" aria-label="Review sections">{sectionLinks}</nav>
    <div className="civic-review-layout">
      <aside className="civic-review-sidebar"><div className="civic-eyebrow" style={{ padding:'0 12px 12px' }}>Review workspace</div><nav aria-label="Review sections">{sectionLinks}</nav><div className="civic-sidebar-foot"><strong>{completedCount} of 3 analyses complete</strong><div>{assessment}</div><p style={{ marginTop:10 }}>AI findings support review. Final approval remains with the responsible engineer.</p></div></aside>
    <main className="civic-review-main">
      <section id="overview">
        <div className="civic-overview-heading"><div><div className="civic-eyebrow">AI review workspace</div><h1 className="civic-title">Compliance review</h1><p className="civic-muted" style={{ fontSize:14 }}>{proposal.name} · {[proposal.location, proposal.postalCode].filter(Boolean).join(' ') || 'Jurisdiction not set'}{lastReview && <> · Last reviewed {new Date(lastReview).toLocaleString()}</>}</p></div><a className="civic-btn" href="#review-coverage" onClick={() => setSection('#overview')}>Review actions <Icon name="chevron" size={15} /></a></div>
        <div className="civic-card civic-summary"><div className="assessment"><div className="civic-eyebrow">Overall assessment</div><strong>{assessment}</strong><p>{activeType ? `${activeLabel} is running.` : completedCount ? `${completedCount} of 3 analyses have saved results.` : 'Run an analysis to begin reviewing evidence.'}</p></div><div className="critical"><div className="civic-eyebrow">Critical / fail</div><strong>{criticalCount}</strong><p>Needs attention</p></div><div className="review"><div className="civic-eyebrow">Engineer review</div><strong>{reviewCount}</strong><p>Needs judgment</p></div><div><div className="civic-eyebrow">Diagrams</div><strong>{diagrams?.diagrams?.length || 0}</strong><p>Visual elements found</p></div></div>
      </section>
      {error && <div className="civic-notice error" role="alert" style={{ marginBottom:16 }}>{error}</div>}
      {!aiReady && <div className="civic-notice warning" style={{ marginBottom:16 }}>AI is disabled or its API key is unavailable. No paid request can start.</div>}
      <div aria-live="polite" className="sr-only">{activeType ? buttonText(activeType) : starting ? `Starting ${labels[starting]}` : 'AI review idle'}</div>
      <section id="review-coverage"><div className="civic-section-heading"><div><div className="civic-eyebrow">Review coverage</div><h2 className="civic-section-title">Run an analysis</h2></div><p className="civic-muted" style={{ fontSize:12, maxWidth:330 }}>Only one AI task can run at a time. Other actions unlock when it finishes.</p></div>
      <div className="civic-action-grid">
        <ActionCard
          icon="file" title="Document review" tooltip="Reviews the proposal in exact three-page batches. It records findings for each page, saves after every batch, resumes after reload, and stops at the configured time, page, or token limit."
          description="Review the document three pages at a time and save page-by-page engineering findings."
          state={document ? `${document.reviewedPages || 0} pages reviewed · ${document.counts?.red || 0} critical` : 'Not run yet'} buttonText={buttonText('document_review')} disabled={!aiReady || locked} active={activeType === 'document_review'} onRun={startDocumentReview}
        />
        <ActionCard
          icon="scales" title="Standards comparison" tooltip="Checks the project state first and then only the named city. It compares the proposal with the governed standards catalog and excludes unrelated cities, counties, districts, and publishers."
          description="Compare the proposal against the applicable state and city standards repository."
          state={comparison ? `${comparison.matrix?.length || 0} requirements compared` : 'Not run yet'} buttonText={buttonText('standards_comparison')} disabled={!aiReady || locked} active={activeType === 'standards_comparison'} onRun={startComparison}
        />
        <ActionCard
          icon="diagram" title="Diagram analysis" tooltip="Reads the attached PDF for plans, details, tables, schedules, and diagrams. It flags visible concerns and checks them against jurisdiction-filtered sources."
          description="Inspect drawings and visual document elements that text extraction may miss."
          state={diagrams ? `${diagrams.diagrams?.length || 0} diagrams found` : 'Not run yet'} buttonText={buttonText('diagram_analysis')} disabled={!aiReady || locked || !proposal.file_path} disabledReason={!proposal.file_path ? 'Attach a proposal file to analyze diagrams.' : ''} active={activeType === 'diagram_analysis'} onRun={startDiagrams}
        />
      </div>
      </section>
      <PageTracker job={jobs.document_review} review={results.document_review} limits={runtime?.aiReviewLimits} />
      <SourceSummary sources={sources} />
      <DocumentReviewDetails review={results.document_review} />
      <StandardsComparison review={results.standards_comparison} />
      <DiagramAnalysisDetails analysis={results.diagram_analysis} fileUrl={proposal.file_path ? `/api/proposals/${id}/file?token=${encodeURIComponent(token || '')}` : ''} proposalUrl={`/proposal/${id}`} />
    </main>
    </div>
  </div>
}

function ActionCard({ icon, title, tooltip, description, state, buttonText, disabled, disabledReason, active, onRun }) {
  return <div className={`civic-card civic-action-card ${active ? 'active' : ''}`}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span className="civic-action-icon">{active ? <span className="spin">◌</span> : <Icon name={icon} />}</span>
      <h3 style={{ flex: 1 }}>{title}</h3>
      <span className="ai-tooltip" tabIndex="0" aria-label={`About ${title}`}><Icon name="info" size={14} />
        <span className="ai-tooltip-content">{tooltip}</span>
      </span>
    </div>
    <p>{description}</p><div className="civic-action-state">{active ? buttonText : state}</div>
    <button onClick={onRun} disabled={disabled} title={disabled ? disabledReason || buttonText : undefined} className="civic-btn civic-btn-primary">
      {buttonText}
    </button>
  </div>
}

function PageTracker({ job, review, limits }) {
  if (!job) return null
  const total = job?.reviewPageLimit || review?.reviewedPages || 0
  const completed = job?.completedPages ?? review?.reviewedPages ?? 0
  const batchSize = job?.batchSize || limits?.batchSize || 3
  const batches = total ? Math.ceil(total / batchSize) : 0
  const terminal = job && !ACTIVE.has(job.status)
  const percent = total ? Math.round(completed / total * 100) : 0
  return <section style={{ ...card, marginBottom: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <div><div style={eyebrow}>Three-page AI tracker</div><h2 style={{ fontSize: 19, marginTop: 5 }}>{job ? statusHeading(job) : 'Ready to review'}</h2></div>
      <div style={{ color: '#087d73', fontWeight: 850, fontSize: 20 }}>{job ? `${percent}%` : '—'}</div>
    </div>
    <div style={{ height: 8, borderRadius: 10, background: '#e2e8f0', overflow: 'hidden', margin: '16px 0 18px' }}>
      <div style={{ height: '100%', width: `${percent}%`, background: terminal && job.status !== 'completed' ? '#f59e0b' : '#087d73', transition: 'width .3s ease' }} />
    </div>
    {job ? <>
      <div className="batch-tracker">
        {Array.from({ length: batches }, (_, index) => {
          const start = index * batchSize + 1
          const end = Math.min(start + batchSize - 1, total)
          const done = completed >= end
          const current = !terminal && !done && index === Math.floor(completed / batchSize)
          return <div className="batch-step-wrap" key={start}>
            <div className={`batch-step ${done ? 'done' : current ? 'current' : ''}`}>{done ? '✓' : index + 1}</div>
            <div className="batch-label">{start}–{end}</div>
          </div>
        })}
      </div>
      <div style={{ color: '#66717d', fontSize: 12, marginTop: 14 }}>
        {completed} of {total} reviewable pages saved · {batches} batch{batches === 1 ? '' : 'es'} · three pages maximum per request
        {job.totalPages > job.reviewPageLimit && <> · document has {job.totalPages} pages; automatic cap is {job.reviewPageLimit}</>}
      </div>
      {job.stoppedReason && <div style={{ ...warningStyle, margin: '14px 0 0' }}>{job.stoppedReason} Partial results were saved.</div>}
    </> : <div className="batch-tracker preview">
      {['Prepare', 'Pages 1–3', 'Pages 4–6', 'Continue', 'Results'].map((label, index) => <div className="batch-step-wrap" key={label}><div className="batch-step">{index + 1}</div><div className="batch-label">{label}</div></div>)}
    </div>}
    <div style={{ fontSize: 11, color: '#66717d', marginTop: 15 }}>Automatic safeguards: {limits?.maxMinutes || 5} minutes · {limits?.maxPages || 30} pages · {(limits?.maxTokens || 75000).toLocaleString()} tokens.</div>
  </section>
}

function statusHeading(job) {
  if (job.status === 'completed') return 'Review complete'
  if (job.status === 'stopped') return 'Review stopped at the safety limit'
  if (job.status === 'cancelled') return 'Review stopped by user'
  if (job.status === 'failed') return 'Review failed'
  const start = job.currentStartPage || Math.min(job.completedPages + 1, job.reviewPageLimit)
  const end = job.currentEndPage || Math.min(start + job.batchSize - 1, job.reviewPageLimit)
  return `Reviewing pages ${start}–${end}`
}

function SourceSummary({ sources }) {
  if (!sources) return null
  return <section style={{ ...card, marginBottom: 16 }}>
    <div style={eyebrow}>Jurisdiction filter</div>
    <div style={{ fontSize: 18, fontWeight: 850, marginTop: 6 }}>{sources.jurisdiction?.resolved ? `${sources.jurisdiction.state} → ${sources.jurisdiction.city}` : 'City and state required'}</div>
    <div style={{ color: '#66717d', fontSize: 12, marginTop: 5 }}>{sources.stateDocumentCount || 0} state records · {sources.cityDocumentCount || 0} city records · {sources.excludedJurisdictionDocumentCount || 0} unrelated records excluded</div>
  </section>
}

function DocumentReviewDetails({ review }) {
  if (!review) return <section id="document-review-results" className="civic-card civic-section-bar"><div className="civic-eyebrow">Document review</div><h2 className="civic-section-title" style={{ marginTop:6 }}>Page-by-page findings</h2><p className="civic-muted" style={{ fontSize:12, marginTop:7 }}>Run document review to see saved page findings here.</p></section>
  const pages = review.pageReviews || []
  const rank = { critical:0, review:1, informational:2 }
  return <section id="document-review-results" className="civic-card civic-result-section">
    <div className="civic-section-bar"><div className="civic-eyebrow">Document review</div><div className="civic-section-heading" style={{ margin:'6px 0 0' }}><div><h2 className="civic-section-title">Page-by-page findings</h2><p className="civic-muted" style={{ fontSize:12, marginTop:5 }}>{review.reviewedPages || pages.length} pages reviewed in batches of {review.batchSize || 3}{review.usage?.totalTokens ? ` · ${review.usage.totalTokens.toLocaleString()} tokens used` : ''}</p></div><div className="civic-counts"><span className="civic-pill red">{review.counts?.red || 0} needs updates</span><span className="civic-pill amber">{review.counts?.yellow || 0} engineer review</span><span className="civic-pill green">{review.counts?.green || 0} no concern</span></div></div>{review.stoppedReason && <div className="civic-notice warning" style={{ marginTop:12 }}>{review.stoppedReason} The findings completed before the stop were saved below.</div>}</div>
    <div className="civic-page-list">{pages.length ? pages.map(page => <details key={page.pageNumber} className="civic-page-detail" open={page.score !== 'green'}><summary><strong style={{ whiteSpace:'nowrap' }}>Page {page.pageNumber}</strong><span className={`civic-pill ${page.score === 'red' ? 'red' : page.score === 'green' ? 'green' : 'amber'}`}>{scoreLabels[page.score] || 'Engineer review'}</span><span className="civic-muted" style={{ fontSize:12, flex:1, minWidth:140 }}>{page.summary}</span><span className="civic-muted" style={{ fontSize:11, whiteSpace:'nowrap' }}>{page.findings?.length || 0} findings</span><Icon name="chevron" size={16} /></summary><div className="civic-findings">{page.findings?.length ? [...page.findings].sort((a,b) => (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2)).map((finding,index) => <div className="civic-finding" key={`${finding.category}-${index}`}><div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:7 }}><span className={`civic-pill ${finding.severity === 'critical' ? 'red' : finding.severity === 'review' ? 'amber' : ''}`}>{humanize(finding.severity || 'informational')}</span><span className="civic-eyebrow">{humanize(finding.category)}</span></div><strong style={{ fontSize:14, color:'var(--navy)' }}>{finding.finding}</strong><div className="civic-evidence-grid"><div className="civic-evidence"><div className="civic-eyebrow" style={{ marginBottom:5 }}>Proposal evidence</div>{finding.evidence || 'No evidence provided.'}</div><div className="civic-evidence action"><div className="civic-eyebrow" style={{ marginBottom:5, color:'var(--teal)' }}>Recommended action</div>{finding.recommendation || 'No action provided.'}</div></div></div>) : <p className="civic-muted" style={{ paddingTop:12, fontSize:12 }}>No specific findings were returned for this page.</p>}</div></details>) : <div className="civic-notice">No page-level findings were returned. Run the document review again to create the detailed page record.</div>}</div>
  </section>
}

function StandardsComparison({ review }) {
  if (!review) return <section id="controlling-standards" className="civic-card civic-section-bar"><div className="civic-eyebrow">Standards comparison</div><h2 className="civic-section-title" style={{ marginTop:6 }}>State and city requirements</h2><p className="civic-muted" style={{ fontSize:12, marginTop:7 }}>Run standards comparison to see applicable requirements here.</p></section>
  const matrix = review.matrix || []
  const status = review.sourceStatus || {}
  return <section id="controlling-standards" className="civic-card civic-result-section"><div className="civic-section-bar"><div className="civic-eyebrow">Standards comparison</div><h2 className="civic-section-title" style={{ marginTop:6 }}>State and city requirements</h2><p className="civic-muted" style={{ fontSize:12, marginTop:5 }}>{(review.jurisdiction?.state || status.jurisdiction?.state || 'State')} → {(review.jurisdiction?.city || status.jurisdiction?.city || 'City')} · {(review.projectScope || []).join(', ') || 'Scope not identified'}</p><div className="civic-counts" style={{ marginTop:14 }}><span className="civic-pill">{status.stateDocumentCount || 0} state records</span><span className="civic-pill">{status.cityDocumentCount || 0} city records</span><span className="civic-pill">{status.excludedJurisdictionDocumentCount || 0} excluded</span><span className="civic-pill green">{review.summary?.pass || 0} pass</span><span className="civic-pill red">{review.summary?.fail || 0} fail</span><span className="civic-pill amber">{review.summary?.review || 0} engineer review</span></div></div>
    <div className="civic-standards-list">{matrix.length ? matrix.map((row,index) => <details className="civic-standard-row" key={row.id || `${row.subject}-${index}`}><summary><div><strong style={{ color:'var(--navy)', fontSize:13 }}>{row.subject || 'Requirement'}</strong><div className="civic-muted" style={{ fontSize:11, marginTop:3 }}>{row.requirement}</div></div><span className={`civic-pill ${row.result === 'pass' ? 'green' : row.result === 'fail' ? 'red' : 'amber'}`}>{row.result === 'review' ? 'Engineer review' : humanize(row.result || 'review')}</span><Icon name="chevron" size={16} /></summary><div className="fields"><Field label="City / client standard" value={row.cityStandard} /><Field label="Site-specific standard" value={row.siteRequirement} /><Field label="Proposal evidence" value={row.proposalValue} /><Field label="Controlling value" value={row.controllingValue || 'Unresolved'} /><Field label="Review reason" value={row.reason} wide /><div className="field correction"><b style={{ color:'var(--teal)' }}>Recommended correction</b>{row.recommendedCorrection || 'No correction specified.'}</div><div className="field wide"><b>Citation / source</b>{row.source ? <><strong>{row.source.title}</strong> · Page {row.source.page || 'not identified'}{row.source.excerpt && <p style={{ marginTop:6 }}>{row.source.excerpt}</p>}{row.source.url && <a href={row.source.url} target="_blank" rel="noreferrer" style={{ color:'var(--teal)', display:'inline-flex', gap:4, marginTop:6 }}>Open source <Icon name="external" size={13} /></a>}</> : 'No controlling citation'}</div></div></details>) : <div className="civic-notice">The comparison completed without returning matrix rows. Engineer review is required.</div>}</div><div style={{ padding:'14px 20px', borderTop:'1px solid var(--border)', background:'var(--subtle)', fontSize:12 }}><strong>Decision policy:</strong> {review.decisionPolicy || 'Final approval remains with the responsible engineer.'}</div>
  </section>
}

function Field({ label, value, wide = false }) { return <div className={`field ${wide ? 'wide' : ''}`}><b>{label}</b>{value || '—'}</div> }

function DiagramAnalysisDetails({ analysis, fileUrl, proposalUrl }) {
  if (!analysis) return <section id="diagram-analysis-results" className="civic-card civic-section-bar"><div className="civic-eyebrow">Diagram analysis</div><h2 className="civic-section-title" style={{ marginTop:6 }}>Visual findings</h2><p className="civic-muted" style={{ fontSize:12, marginTop:7 }}>Analyze diagrams to see visual findings here.</p></section>
  const diagrams = analysis.diagrams || []
  const overall = analysis.overallCompliance || 'yellow'
  return <section id="diagram-analysis-results" className="civic-card civic-result-section">
    <div className="civic-section-bar">
      <div className="civic-eyebrow">Diagram analysis</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 760 }}>
          <h2 className="civic-section-title" style={{ marginBottom: 7 }}>Plans, details, tables, and diagrams</h2>
          <p style={{ color: '#475569', fontSize: 13, lineHeight: 1.6 }}>{analysis.summary || 'No overall summary was returned.'}</p>
        </div>
        <span className={`civic-pill ${overall === 'red' ? 'red' : overall === 'green' ? 'green' : 'amber'}`}>{diagramScoreLabels[overall] || 'Engineer review'}</span>
      </div>
    </div>

    <div className="civic-diagram-grid"><div className="civic-pdf-viewer">{fileUrl ? <iframe title="Proposal document" src={fileUrl} /> : <div className="civic-notice">No source file is attached to this proposal.</div>}</div><div className="civic-diagram-findings">
      <div style={{ marginBottom:12 }}><a href={proposalUrl} className="civic-btn">Open proposal viewer <Icon name="external" size={15} /></a></div>
      {analysis.criticalIssues?.length > 0 && <FindingList title="Critical issues" items={analysis.criticalIssues} color="#dc2626" background="#fef2f2" border="#fecaca" />}
      {analysis.recommendations?.length > 0 && <FindingList title="Recommendations" items={analysis.recommendations} color="#087d73" background="#e7f5f2" border="#c8e5df" />}

      <div style={{ ...eyebrow, margin: '18px 0 9px' }}>Diagram findings ({diagrams.length})</div>
      {diagrams.length ? diagrams.map((diagram, index) => <details key={`${diagram.location}-${diagram.type}-${index}`} className="civic-page-detail" open={diagram.compliance !== 'green'}>
        <summary>
          <span className="civic-pill teal">{index + 1}</span>
          <span style={{ fontWeight: 750, color:'var(--navy)' }}>{diagram.type || `Diagram ${index + 1}`}</span>
          <span className={`civic-pill ${diagram.compliance === 'red' ? 'red' : diagram.compliance === 'green' ? 'green' : 'amber'}`}>{diagramScoreLabels[diagram.compliance] || 'Engineer review'}</span>
          <span style={{ color: '#66717d', fontSize: 12, flex: 1 }}>{diagram.location || 'Location not identified'}</span>
          <Icon name="chevron" size={16} />
        </summary>
        <div style={{ padding: '0 14px 14px' }}>
          <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, margin: '10px 0' }}>{diagram.description}</p>
          {diagram.concerns?.length > 0 && <FindingList title="Concerns" items={diagram.concerns} color="#dc2626" background="#fef2f2" border="#fecaca" compact />}
          {diagram.missingElements?.length > 0 && <FindingList title="Missing elements" items={diagram.missingElements} color="#a16207" background="#fffbeb" border="#fde68a" compact />}
          {diagram.positives?.length > 0 && <FindingList title="Positive findings" items={diagram.positives} color="#15803d" background="#f0fdf4" border="#bbf7d0" compact />}
          {diagram.codes?.length > 0 && <div style={{ marginTop: 12 }}><div style={{ ...eyebrow, marginBottom: 6 }}>Codes and standards referenced</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{diagram.codes.map((code, codeIndex) => <span key={`${code}-${codeIndex}`} style={{ padding: '5px 8px', borderRadius: 6, background: '#e7f5f2', color: '#087d73', border: '1px solid #c7d2fe', fontSize: 11, fontWeight: 700 }}>{code}</span>)}</div></div>}
        </div>
      </details>) : <div style={{ color: '#66717d', fontSize: 12 }}>No individual diagrams were returned.</div>}

      {analysis.researchFindings?.length > 0 && <div style={{ marginTop: 20 }}>
        <div style={{ ...eyebrow, marginBottom: 9 }}>Location research and sources</div>
        {analysis.researchFindings.map((finding, index) => <div key={`${finding.sourceUrl}-${index}`} style={{ padding: '11px 13px', border: '1px solid #c7d2fe', background: '#e7f5f2', borderRadius: 9, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}><b style={{ fontSize: 12, color: '#3730a3' }}>{humanize(finding.category)}</b><span style={{ fontSize: 10, color: '#6366f1', textTransform: 'uppercase', fontWeight: 800 }}>{finding.confidence} confidence</span></div>
          <div style={{ color: '#334155', fontSize: 12.5, lineHeight: 1.55, marginTop: 5 }}>{finding.finding}</div>
          <a href={finding.sourceUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 6, color: '#087d73', fontSize: 11.5, fontWeight: 800 }}>{finding.sourceTitle || 'Open verified source'} ↗</a>
        </div>)}
      </div>}
    </div></div>
  </section>
}

function FindingList({ title, items, color, background, border, compact = false }) {
  return <div style={{ marginBottom: compact ? 10 : 16 }}>
    <div style={{ ...eyebrow, color, marginBottom: 7 }}>{title}</div>
    {items.map((item, index) => <div key={`${item}-${index}`} style={{ padding: compact ? '7px 10px' : '9px 12px', background, border: `1px solid ${border}`, color, borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, marginBottom: 6 }}>• {item}</div>)}
  </div>
}

const labels = { document_review: 'Document review', standards_comparison: 'Standards comparison', diagram_analysis: 'Diagram analysis' }
const runLabels = { document_review: 'Run document review', standards_comparison: 'Run standards comparison', diagram_analysis: 'Analyze diagrams' }
const card = { background: 'white', border: '1px solid #dde2e7', borderRadius: 13, padding: 18 }
const eyebrow = { fontSize: 10, color: '#66717d', textTransform: 'uppercase', letterSpacing: .9, fontWeight: 750 }
const warningStyle = { padding: 13, background: '#fff4df', border: '1px solid #efdbb8', color: '#94570e', borderRadius: 9, marginBottom: 16 }
const scoreLabels = { green: 'No concern', yellow: 'Engineer review', red: 'Needs updates' }
const diagramScoreLabels = { green: 'No concern', yellow: 'Engineer review', red: 'Needs updates' }
const humanize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
