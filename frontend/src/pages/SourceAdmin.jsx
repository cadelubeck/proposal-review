import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth, useApiFetch } from '../context/AuthContext'

const STATUS = {
  healthy: { label: 'Healthy', color: '#15803d', background: '#f0fdf4' },
  broken: { label: 'Broken link', color: '#b91c1c', background: '#fef2f2' },
  changed: { label: 'Source changed', color: '#a16207', background: '#fefce8' },
  missing_url: { label: 'URL missing', color: '#c2410c', background: '#fff7ed' },
  unchecked: { label: 'Not checked', color: '#475569', background: '#f1f5f9' }
}

export default function SourceAdmin() {
  const nav = useNavigate(); const apiFetch = useApiFetch(); const { user } = useAuth()
  const [data, setData] = useState(null); const [aiStatus, setAiStatus] = useState(null); const [busy, setBusy] = useState(''); const [error, setError] = useState('')
  const isAdmin = ['manager', 'admin'].includes(user?.role)
  const load = async () => {
    const [response, aiResponse] = await Promise.all([apiFetch('/api/admin/source-health'), apiFetch('/api/admin/ai-status')])
    const body = await response.json()
    if (!response.ok) return setError(body.error || 'Source health could not be loaded')
    setData(body)
    if (aiResponse.ok) setAiStatus(await aiResponse.json())
  }
  useEffect(() => { if (isAdmin) load() }, [isAdmin])
  if (!isAdmin) return <Navigate to="/" replace />

  const runChecks = async documentId => {
    setBusy(documentId || 'all'); setError('')
    const response = await apiFetch('/api/admin/source-health/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(documentId ? { documentId } : {})
    })
    const body = await response.json(); setBusy('')
    if (!response.ok) return setError(body.error || 'Source checks failed')
    setData(body)
  }
  const acknowledge = async documentId => {
    setBusy(`ack-${documentId}`)
    const response = await apiFetch(`/api/admin/source-health/${documentId}/acknowledge`, { method: 'POST' })
    setBusy('')
    if (!response.ok) return setError((await response.json()).error || 'Notification could not be acknowledged')
    load()
  }
  const editUrl = async source => {
    const sourceUrl = window.prompt('Authoritative HTTP or HTTPS source URL', source.sourceUrl || '')
    if (sourceUrl === null) return
    setBusy(`url-${source.id}`); setError('')
    const response = await apiFetch(`/api/standards/${source.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceUrl }) })
    const body = await response.json(); setBusy('')
    if (!response.ok) return setError(body.error || 'Source URL could not be updated')
    load()
  }

  const counts = data?.counts || {}
  const categoryLabel = key => data?.categories?.find(category => category.key === key)?.label || key
  return <div style={{ minHeight: '100vh', background: '#f1f5f9', color: '#0f172a' }}>
    <header style={{ minHeight: 64, padding: '0 24px', background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <button onClick={() => nav('/standards')} style={headerButton}>← Catalog</button>
      <div style={{ flex: 1 }}><div style={{ fontWeight: 850 }}>Source Health &amp; Notifications</div><div style={{ fontSize: 10, color: '#fbbf24', marginTop: 2 }}>Administrator portal · broken-link and change monitoring</div></div>
      <button onClick={() => runChecks()} disabled={busy === 'all'} style={{ ...headerButton, background: '#4f46e5', color: 'white' }}>{busy === 'all' ? 'Checking sources…' : 'Check next 12 sources'}</button>
    </header>

    <main style={{ maxWidth: 1240, margin: '0 auto', padding: 28 }}>
      {error && <div style={{ ...card, color: '#b91c1c', background: '#fef2f2', borderColor: '#fecaca', marginBottom: 16 }}>{error}</div>}
      <section style={{ ...card, marginBottom: 20, borderColor: aiStatus?.reachable && aiStatus?.enabled ? '#bbf7d0' : '#fde68a', background: aiStatus?.reachable && aiStatus?.enabled ? '#f0fdf4' : '#fffbeb' }}>
        <div style={sectionHeader}><div><h2 style={title}>AI API connection</h2><div style={subtitle}>Server-side status only; the API key is never sent to the browser.</div></div><Status status={aiStatus?.reachable ? 'healthy' : 'broken'} /></div>
        <div style={{ fontSize: 13, marginTop: 12 }}><b>{aiStatus?.model || 'Model not reported'}</b> · {aiStatus?.configured ? 'key configured' : 'key missing'} · {aiStatus?.reachable ? 'API reachable' : 'API not reachable'} · {aiStatus?.enabled ? 'analysis enabled' : 'analysis disabled'} · {aiStatus?.webSearchEnabled ? 'catalog web research enabled' : 'catalog web research disabled'}</div>
        {aiStatus?.error && <div style={{ color: '#92400e', fontSize: 12, marginTop: 8 }}>{aiStatus.error}</div>}
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 20 }}>
        <Metric label="Open notifications" value={data?.notificationCount || 0} color="#b91c1c" />
        <Metric label="Healthy" value={counts.healthy || 0} color="#15803d" />
        <Metric label="Broken" value={counts.broken || 0} color="#b91c1c" />
        <Metric label="Changed" value={counts.changed || 0} color="#a16207" />
        <Metric label="Missing URLs" value={counts.missing_url || 0} color="#c2410c" />
        <Metric label="Unchecked" value={counts.unchecked || 0} color="#475569" />
      </div>

      <section style={{ ...card, marginBottom: 20 }}>
        <div style={sectionHeader}><div><h2 style={title}>Notifications</h2><div style={subtitle}>New failures and changes remain here until acknowledged.</div></div></div>
        {!data?.notifications?.length && <div style={{ color: '#15803d', paddingTop: 16, fontWeight: 700 }}>✓ No unacknowledged source problems</div>}
        {data?.notifications?.map(notification => <div key={notification.id} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '15px 0', borderTop: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
          <Status status={notification.type} />
          <div style={{ flex: 1, minWidth: 260 }}><div style={{ fontWeight: 800 }}>{notification.title}</div><div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{notification.message}</div><div style={{ color: '#94a3b8', fontSize: 10.5, marginTop: 4 }}>{notification.visibility} · {categoryLabel(notification.sourceCategory)} · detected {formatDate(notification.detectedAt)}</div></div>
          <button onClick={() => acknowledge(notification.documentId)} disabled={busy === `ack-${notification.documentId}`} style={secondaryButton}>Acknowledge</button>
        </div>)}
      </section>

      <section style={card}>
        <div style={sectionHeader}><div><h2 style={title}>Monitored catalog</h2><div style={subtitle}>The oldest 12 checks run daily so the free serverless job stays within its runtime limit. Individual sources can be checked immediately.</div></div><button onClick={() => nav('/standards')} style={secondaryButton}>Manage catalog</button></div>
        {!data?.sources?.length && <div style={{ color: '#64748b', paddingTop: 16 }}>No sources are registered.</div>}
        {data?.sources?.map(source => <div key={source.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(240px,2fr) minmax(130px,1fr) minmax(120px,.8fr) auto', gap: 14, alignItems: 'center', padding: '15px 0', borderTop: '1px solid #e2e8f0' }}>
          <div><div style={{ fontWeight: 800 }}>{source.title}</div><div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{categoryLabel(source.sourceCategory)} · {source.visibility}{source.sensitivity === 'restricted' ? ' · restricted' : ''}</div>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" style={{ display: 'block', color: '#4f46e5', fontSize: 10.5, marginTop: 4, overflowWrap: 'anywhere' }}>{source.sourceUrl}</a> : <div style={{ color: '#c2410c', fontSize: 10.5, marginTop: 4 }}>No URL configured</div>}<button onClick={() => editUrl(source)} disabled={busy === `url-${source.id}`} style={{ border: 0, background: 'none', color: '#6366f1', fontSize: 10.5, fontWeight: 750, padding: '5px 0 0', cursor: 'pointer' }}>{source.sourceUrl ? 'Edit URL' : 'Add URL'}</button></div>
          <Status status={source.health.status} />
          <div style={{ color: '#64748b', fontSize: 11 }}>{source.health.checkedAt ? `Checked ${formatDate(source.health.checkedAt)}` : 'Never checked'}{source.health.httpStatus ? <div>HTTP {source.health.httpStatus}</div> : null}</div>
          <button onClick={() => runChecks(source.id)} disabled={busy === source.id} style={secondaryButton}>{busy === source.id ? 'Checking…' : 'Check now'}</button>
        </div>)}
      </section>
    </main>
  </div>
}

function Metric({ label, value, color }) {
  return <div style={card}><div style={{ color: '#64748b', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: .7 }}>{label}</div><div style={{ color, fontSize: 28, fontWeight: 900, marginTop: 7 }}>{value}</div></div>
}
function Status({ status }) {
  const style = STATUS[status] || STATUS.unchecked
  return <span style={{ display: 'inline-flex', width: 'fit-content', padding: '5px 9px', borderRadius: 20, color: style.color, background: style.background, fontSize: 10.5, fontWeight: 850 }}>{style.label}</span>
}
function formatDate(value) { return value ? new Date(value).toLocaleString() : 'unknown time' }

const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 13, padding: 18, boxShadow: '0 2px 9px rgba(15,23,42,.04)' }
const title = { margin: 0, fontSize: 17 }
const subtitle = { color: '#64748b', fontSize: 12, marginTop: 4 }
const sectionHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, marginBottom: 4 }
const headerButton = { border: 0, borderRadius: 8, padding: '9px 13px', background: '#1e293b', color: '#cbd5e1', fontWeight: 750, cursor: 'pointer' }
const secondaryButton = { ...headerButton, background: '#eef2ff', color: '#4338ca' }
