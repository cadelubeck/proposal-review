import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApiFetch } from '../context/AuthContext'

export default function Compliance() {
  const { id } = useParams(); const nav = useNavigate(); const apiFetch = useApiFetch()
  const [proposal, setProposal] = useState(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const [sourceStatus, setSourceStatus] = useState(null)
  const [runtime, setRuntime] = useState(null)
  const load = async () => {
    const [proposalResponse, sourcesResponse, healthResponse] = await Promise.all([
      apiFetch(`/api/proposals/${id}`),
      apiFetch(`/api/proposals/${id}/analysis-sources`),
      apiFetch('/api/health')
    ])
    if (proposalResponse.ok) setProposal(await proposalResponse.json())
    if (sourcesResponse.ok) setSourceStatus(await sourcesResponse.json())
    if (healthResponse.ok) setRuntime(await healthResponse.json())
  }
  useEffect(() => { load() }, [id])
  const run = async () => {
    setLoading(true); setError('')
    const r = await apiFetch(`/api/proposals/${id}/compliance-review`, { method: 'POST' }); const data = await r.json(); setLoading(false)
    if (data.sourceStatus) setSourceStatus(data.sourceStatus)
    if (!r.ok) return setError(data.error); setProposal(p => ({ ...p, complianceReview: data }))
  }
  if (!proposal) return null
  const review = proposal.complianceReview
  return <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
    <header style={{ height: 60, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14 }}>
      <button onClick={() => nav(`/proposal/${id}`)} style={button}>← Proposal</button>
      <div style={{ flex: 1 }}><div style={{ fontWeight: 800 }}>Controlling Standards Review</div><div style={{ fontSize: 10, color: '#a5b4fc' }}>{proposal.name} · {proposal.location}</div></div>
      <button onClick={() => nav('/standards')} style={button}>Document library</button>
      <button onClick={run} disabled={loading || runtime?.aiEnabled === false} title={runtime?.aiEnabled === false ? 'AI is disabled to prevent usage charges.' : ''} style={{ ...button, background: runtime?.aiEnabled === false ? '#475569' : '#4f46e5', color: 'white', cursor: runtime?.aiEnabled === false ? 'not-allowed' : 'pointer' }}>{runtime?.aiEnabled === false ? 'AI disabled — cost control' : loading ? 'Comparing proposal to sources…' : review ? 'Re-run structured comparison' : 'Run structured standards comparison'}</button>
    </header>
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: 26 }}>
      {error && <div style={{ padding: 14, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, marginBottom: 16 }}>{error}</div>}
      {runtime?.aiEnabled === false && <div style={{ padding: 14, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 10, marginBottom: 16 }}>AI comparisons are intentionally disabled so this environment cannot generate API charges. The source catalog and link-health monitoring remain available.</div>}
      {sourceStatus && <SourceStatus status={sourceStatus} onOpenLibrary={() => nav('/standards')} />}
      {!review && <div style={{ ...card, marginTop: 16 }}><h2>Structured comparison</h2><p style={{ color: '#64748b' }}>This control extracts design values from the proposal, retrieves requirements from the matched document library shown above, and applies the stricter-of-sources rules engine. It does not silently treat a missing source as compliance.</p></div>}
      {review && <>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
          <div style={card}><div style={label}>Detected scope</div><div style={{ fontWeight: 700, marginTop: 8 }}>{review.projectScope.join(', ') || 'Not identified'}</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 7 }}>{review.jurisdiction.city || ''} {review.jurisdiction.state || ''} · confidence {Math.round(review.jurisdiction.confidence * 100)}%</div></div>
          {[['Pass', review.summary.pass, '#15803d'], ['Fail', review.summary.fail, '#dc2626'], ['Engineer review', review.summary.review, '#a16207']].map(([t,n,c]) => <div style={card} key={t}><div style={{ ...label, color: c }}>{t}</div><div style={{ fontSize: 30, fontWeight: 850, color: c, marginTop: 8 }}>{n}</div></div>)}
        </div>
        <div style={{ ...card, overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Requirement','City / client','Site-specific','Proposal','Controlling','Result','Reason & correction','Citation'].map(x => <th key={x} style={th}>{x}</th>)}</tr></thead>
            <tbody>{review.matrix.map(row => <tr key={row.id}>
              <td style={td}><b>{row.subject}</b><div style={{ color: '#64748b' }}>{row.requirement}</div></td>
              <td style={td}>{row.cityStandard || '—'}</td><td style={td}>{row.siteRequirement || '—'}</td><td style={td}>{row.proposalValue}</td><td style={td}><b>{row.controllingValue || 'Unresolved'}</b></td>
              <td style={td}><span style={{ padding: '4px 8px', borderRadius: 20, fontWeight: 800, color: colors[row.result], background: `${colors[row.result]}14` }}>{row.result.toUpperCase()}</span></td>
              <td style={td}>{row.reason}<div style={{ color: '#7c3aed', marginTop: 4 }}>{row.recommendedCorrection}</div></td>
              <td style={td}>{row.source ? <><b>{row.source.title}</b><div>Page {row.source.page || 'not identified'}</div><div style={{ color: '#64748b', marginTop: 4 }}>&ldquo;{row.source.excerpt}&rdquo;</div></> : 'No controlling citation'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p style={{ color: '#64748b', fontSize: 11 }}>Decision policy: {review.decisionPolicy} Final approval remains with the responsible engineer.</p>
      </>}
    </main>
  </div>
}

function SourceStatus({ status, onOpenLibrary }) {
  return <div style={card}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start' }}>
      <div>
        <div style={label}>Sources connected to this proposal</div>
        <div style={{ fontSize: 22, fontWeight: 850, marginTop: 7 }}>{status.matchedDocumentCount} documents · {status.matchedRequirementCount} requirements</div>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 5 }}>{status.repositoryDocumentCount} total documents in this account&apos;s repository</div>
      </div>
      <button onClick={onOpenLibrary} style={{ ...button, background: '#eef2ff', color: '#4338ca' }}>Manage sources</button>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 15 }}>
      {status.coverage.map(area => <span key={area.key} title={area.documents.map(doc => doc.title).join(', ') || 'No matching extracted document'} style={{ padding: '6px 9px', borderRadius: 20, fontSize: 11, fontWeight: 750, border: `1px solid ${area.status === 'available' ? '#bbf7d0' : '#fed7aa'}`, color: area.status === 'available' ? '#15803d' : '#c2410c', background: area.status === 'available' ? '#f0fdf4' : '#fff7ed' }}>
        {area.status === 'available' ? '✓' : 'Missing:'} {area.label}
      </span>)}
    </div>
    {status.pendingDocuments.length > 0 && <div style={{ marginTop: 12, color: '#a16207', fontSize: 12 }}>{status.pendingDocuments.length} uploaded document(s) still need requirement extraction.</div>}
  </div>
}
const colors = { pass: '#15803d', fail: '#dc2626', review: '#a16207' }
const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, boxShadow: '0 2px 8px rgba(15,23,42,.04)' }
const button = { border: 0, borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontWeight: 700, background: '#1e293b', color: '#cbd5e1' }
const label = { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: .7, fontWeight: 800 }
const th = { textAlign: 'left', padding: 12, background: '#f8fafc', borderBottom: '1px solid #cbd5e1', color: '#475569', whiteSpace: 'nowrap' }
const td = { padding: 12, borderBottom: '1px solid #e2e8f0', verticalAlign: 'top', minWidth: 100, lineHeight: 1.45 }
