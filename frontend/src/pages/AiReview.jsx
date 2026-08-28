import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApiFetch } from '../context/AuthContext'

const ACTIVE = new Set(['queued', 'in_progress', 'running'])
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

export default function AiReview() {
  const { id } = useParams()
  const nav = useNavigate()
  const apiFetch = useApiFetch()
  const alive = useRef(true)
  const polling = useRef(false)
  const runNumber = useRef(0)
  const [proposal, setProposal] = useState(null)
  const [sources, setSources] = useState(null)
  const [runtime, setRuntime] = useState(null)
  const [jobs, setJobs] = useState({ document_review: null, standards_comparison: null, diagram_analysis: null })
  const [results, setResults] = useState({ document_review: null, standards_comparison: null, diagram_analysis: null })
  const [error, setError] = useState('')
  const [starting, setStarting] = useState('')

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

  if (!proposal) return null
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

  return <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
    <header style={{ height: 64, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14 }}>
      <button onClick={() => nav(`/proposal/${id}`)} style={darkButton}>← Proposal</button>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 850 }}>AI Review Center</div>
        <div style={{ fontSize: 11, color: '#a5b4fc' }}>{proposal.name} · {proposal.location}</div>
      </div>
      {activeType && <button onClick={stopActive} style={{ ...darkButton, background: '#7f1d1d', color: '#fecaca' }}>■ Stop AI task</button>}
    </header>

    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 26 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 25, marginBottom: 7 }}>One place for every AI action</h1>
        <p style={{ color: '#64748b', lineHeight: 1.6 }}>Only one AI task can run at a time. While it runs, every AI action locks and the active button shows its current work.</p>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {!aiReady && <div style={warningStyle}>AI is disabled or its API key is unavailable. No paid request can start.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14, marginBottom: 20 }}>
        <ActionCard
          icon="📄" title="Run AI API" tooltip="Reviews the proposal in exact three-page batches. It records findings for each page, saves after every batch, resumes after reload, and stops at the configured time, page, or token limit."
          description="Review the document three pages at a time and save page-by-page engineering findings."
          buttonText={buttonText('document_review')} disabled={!aiReady || locked} active={activeType === 'document_review'} onRun={startDocumentReview}
        />
        <ActionCard
          icon="⚖️" title="Structured standards comparison" tooltip="Checks the project state first and then only the named city. It compares the proposal with the governed standards catalog and excludes unrelated cities, counties, districts, and publishers."
          description="Compare the proposal against the applicable state and city standards repository."
          buttonText={buttonText('standards_comparison')} disabled={!aiReady || locked} active={activeType === 'standards_comparison'} onRun={startComparison}
        />
        <ActionCard
          icon="🏗️" title="Analyze diagrams" tooltip="Reads the attached PDF for plans, details, tables, schedules, and diagrams. It flags visible concerns and checks them against jurisdiction-filtered sources."
          description="Inspect drawings and visual document elements that text extraction may miss."
          buttonText={buttonText('diagram_analysis')} disabled={!aiReady || locked || !proposal.file_path} active={activeType === 'diagram_analysis'} onRun={startDiagrams}
        />
      </div>

      <PageTracker job={jobs.document_review} review={results.document_review} limits={runtime?.aiReviewLimits} />
      <SourceSummary sources={sources} />
      <Results results={results} />
      <StandardsComparison review={results.standards_comparison} />
    </main>
  </div>
}

function ActionCard({ icon, title, tooltip, description, buttonText, disabled, active, onRun }) {
  return <section style={{ ...card, borderColor: active ? '#818cf8' : '#e2e8f0', boxShadow: active ? '0 0 0 3px #e0e7ff' : card.boxShadow }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
      <span style={{ fontSize: 24 }}>{icon}</span>
      <h2 style={{ fontSize: 15, flex: 1 }}>{title}</h2>
      <span className="ai-tooltip" tabIndex="0" aria-label={`About ${title}`}>?
        <span className="ai-tooltip-content">{tooltip}</span>
      </span>
    </div>
    <p style={{ color: '#64748b', fontSize: 12.5, lineHeight: 1.55, minHeight: 58 }}>{description}</p>
    <button onClick={onRun} disabled={disabled} style={{ width: '100%', padding: '10px 12px', border: 0, borderRadius: 8, marginTop: 12, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer', background: active ? '#4338ca' : disabled ? '#cbd5e1' : '#4f46e5', color: disabled && !active ? '#64748b' : 'white' }}>
      {active && <span className="spin" style={{ marginRight: 7 }}>⟳</span>}{buttonText}
    </button>
  </section>
}

function PageTracker({ job, review, limits }) {
  const total = job?.reviewPageLimit || review?.reviewedPages || 0
  const completed = job?.completedPages ?? review?.reviewedPages ?? 0
  const batchSize = job?.batchSize || limits?.batchSize || 3
  const batches = total ? Math.ceil(total / batchSize) : 0
  const terminal = job && !ACTIVE.has(job.status)
  const percent = total ? Math.round(completed / total * 100) : 0
  return <section style={{ ...card, marginBottom: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <div><div style={eyebrow}>Three-page AI tracker</div><h2 style={{ fontSize: 19, marginTop: 5 }}>{job ? statusHeading(job) : 'Ready to review'}</h2></div>
      <div style={{ color: '#4338ca', fontWeight: 850, fontSize: 20 }}>{job ? `${percent}%` : '—'}</div>
    </div>
    <div style={{ height: 8, borderRadius: 10, background: '#e2e8f0', overflow: 'hidden', margin: '16px 0 18px' }}>
      <div style={{ height: '100%', width: `${percent}%`, background: terminal && job.status !== 'completed' ? '#f59e0b' : '#4f46e5', transition: 'width .3s ease' }} />
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
      <div style={{ color: '#64748b', fontSize: 12, marginTop: 14 }}>
        {completed} of {total} reviewable pages saved · {batches} batch{batches === 1 ? '' : 'es'} · three pages maximum per request
        {job.totalPages > job.reviewPageLimit && <> · document has {job.totalPages} pages; automatic cap is {job.reviewPageLimit}</>}
      </div>
      {job.stoppedReason && <div style={{ ...warningStyle, margin: '14px 0 0' }}>{job.stoppedReason} Partial results were saved.</div>}
    </> : <div className="batch-tracker preview">
      {['Prepare', 'Pages 1–3', 'Pages 4–6', 'Continue', 'Results'].map((label, index) => <div className="batch-step-wrap" key={label}><div className="batch-step">{index + 1}</div><div className="batch-label">{label}</div></div>)}
    </div>}
    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 15 }}>Automatic safeguards: {limits?.maxMinutes || 5} minutes · {limits?.maxPages || 30} pages · {(limits?.maxTokens || 75000).toLocaleString()} tokens.</div>
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
    <div style={{ color: '#64748b', fontSize: 12, marginTop: 5 }}>{sources.stateDocumentCount || 0} state records · {sources.cityDocumentCount || 0} city records · {sources.excludedJurisdictionDocumentCount || 0} unrelated records excluded</div>
  </section>
}

function Results({ results }) {
  const document = results.document_review
  const comparison = results.standards_comparison
  const diagrams = results.diagram_analysis
  if (!document && !comparison && !diagrams) return null
  return <section style={card}>
    <div style={eyebrow}>Saved AI results</div>
    {document && <div style={resultRow}><div><b>Document review</b><div style={resultText}>{document.reviewedPages} pages reviewed · {document.counts?.red || 0} red · {document.counts?.yellow || 0} yellow · {document.counts?.green || 0} green</div></div><span style={statusPill(document.status)}>{document.status}</span></div>}
    {comparison && <div style={resultRow}><div><b>Standards comparison</b><div style={resultText}>{comparison.summary?.fail || 0} fail · {comparison.summary?.review || 0} engineer review · {comparison.summary?.pass || 0} pass</div></div><span style={statusPill('completed')}>shown below</span></div>}
    {diagrams && <div style={resultRow}><div><b>Diagram analysis</b><div style={resultText}>{diagrams.diagrams?.length || 0} diagrams found · {diagrams.criticalIssues?.length || 0} critical issues</div></div><span style={statusPill('completed')}>complete</span></div>}
  </section>
}

function StandardsComparison({ review }) {
  if (!review) return null
  const matrix = review.matrix || []
  return <section id="controlling-standards" style={{ ...card, marginTop: 16, padding: 0, overflow: 'hidden' }}>
    <div style={{ padding: 18, borderBottom: '1px solid #e2e8f0' }}>
      <div style={eyebrow}>Controlling standards</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 5 }}>State and city standards comparison</h2>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {(review.jurisdiction?.state || review.sourceStatus?.jurisdiction?.state || 'State')} → {(review.jurisdiction?.city || review.sourceStatus?.jurisdiction?.city || 'City')} · {(review.projectScope || []).join(', ') || 'Scope not identified'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Count label="Pass" value={review.summary?.pass || 0} color="#15803d" />
          <Count label="Fail" value={review.summary?.fail || 0} color="#dc2626" />
          <Count label="Engineer review" value={review.summary?.review || 0} color="#a16207" />
        </div>
      </div>
    </div>
    {matrix.length ? <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{['Requirement', 'City / client', 'Site-specific', 'Proposal', 'Controlling', 'Result', 'Reason & correction', 'Citation'].map(column => <th key={column} style={tableHead}>{column}</th>)}</tr></thead>
        <tbody>{matrix.map((row, index) => <tr key={row.id || `${row.subject}-${index}`}>
          <td style={tableCell}><b>{row.subject}</b><div style={{ color: '#64748b', marginTop: 3 }}>{row.requirement}</div></td>
          <td style={tableCell}>{row.cityStandard || '—'}</td>
          <td style={tableCell}>{row.siteRequirement || '—'}</td>
          <td style={tableCell}>{row.proposalValue || '—'}</td>
          <td style={tableCell}><b>{row.controllingValue || 'Unresolved'}</b></td>
          <td style={tableCell}><span style={comparisonPill(row.result)}>{(row.result || 'review').toUpperCase()}</span></td>
          <td style={tableCell}>{row.reason}<div style={{ color: '#7c3aed', marginTop: 5 }}>{row.recommendedCorrection}</div></td>
          <td style={tableCell}>{row.source ? <><b>{row.source.title}</b><div style={{ marginTop: 3 }}>Page {row.source.page || 'not identified'}</div>{row.source.excerpt && <div style={{ color: '#64748b', marginTop: 4 }}>&ldquo;{row.source.excerpt}&rdquo;</div>}</> : 'No controlling citation'}</td>
        </tr>)}</tbody>
      </table>
    </div> : <div style={{ padding: 18, color: '#64748b' }}>The comparison completed without returning matrix rows. Engineer review is required.</div>}
    <div style={{ padding: '12px 18px', background: '#f8fafc', color: '#64748b', fontSize: 11, borderTop: '1px solid #e2e8f0' }}>
      Decision policy: {review.decisionPolicy || 'Final approval remains with the responsible engineer.'}
    </div>
  </section>
}

function Count({ label, value, color }) {
  return <div style={{ minWidth: 76, padding: '8px 10px', borderRadius: 9, background: `${color}10`, border: `1px solid ${color}30`, textAlign: 'center' }}>
    <div style={{ fontSize: 9, color, fontWeight: 850, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontSize: 20, color, fontWeight: 900, marginTop: 2 }}>{value}</div>
  </div>
}

const labels = { document_review: 'Document review', standards_comparison: 'Standards comparison', diagram_analysis: 'Diagram analysis' }
const runLabels = { document_review: 'Run AI API — 3 pages at a time', standards_comparison: 'Run structured standards comparison', diagram_analysis: 'Analyze diagrams' }
const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 13, padding: 18, boxShadow: '0 2px 8px rgba(15,23,42,.05)' }
const darkButton = { border: 0, borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontWeight: 750, background: '#1e293b', color: '#cbd5e1' }
const eyebrow = { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: .9, fontWeight: 850 }
const errorStyle = { padding: 13, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 9, marginBottom: 16 }
const warningStyle = { padding: 13, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 9, marginBottom: 16 }
const resultRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 0', borderBottom: '1px solid #f1f5f9' }
const resultText = { color: '#64748b', fontSize: 12, marginTop: 4 }
const statusPill = status => ({ padding: '5px 9px', borderRadius: 20, fontSize: 10, fontWeight: 850, textTransform: 'uppercase', background: status === 'completed' ? '#dcfce7' : '#fef3c7', color: status === 'completed' ? '#15803d' : '#a16207' })
const comparisonColors = { pass: '#15803d', fail: '#dc2626', review: '#a16207' }
const comparisonPill = result => ({ padding: '4px 8px', borderRadius: 20, fontWeight: 850, color: comparisonColors[result] || comparisonColors.review, background: `${comparisonColors[result] || comparisonColors.review}14` })
const tableHead = { textAlign: 'left', padding: 12, background: '#f8fafc', borderBottom: '1px solid #cbd5e1', color: '#475569', whiteSpace: 'nowrap' }
const tableCell = { padding: 12, borderBottom: '1px solid #e2e8f0', verticalAlign: 'top', minWidth: 110, lineHeight: 1.45 }
