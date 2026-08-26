import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useApiFetch } from '../context/AuthContext'

const TYPES = [
  ['city_standard', 'Standard / code'], ['client_standard', 'Client standard'], ['manual', 'Manual / specification'],
  ['geotechnical', 'Technical report'], ['engineering_report', 'Engineering report'], ['web_reference', 'Web reference']
]

const emptyForm = isAdmin => ({
  title: '', documentType: 'city_standard', sourceCategory: 'city_engineering', jurisdiction: '', client: '',
  projectTypes: '', sourceUrl: '', visibility: isAdmin ? 'shared' : 'organization', sensitivity: 'public'
})

export default function Standards() {
  const nav = useNavigate(); const apiFetch = useApiFetch(); const fileRef = useRef(); const { user } = useAuth()
  const isAdmin = ['manager', 'admin'].includes(user?.role)
  const [docs, setDocs] = useState([]); const [categories, setCategories] = useState([]); const [file, setFile] = useState(null)
  const [form, setForm] = useState(() => emptyForm(isAdmin))
  const [busy, setBusy] = useState(''); const [error, setError] = useState('')
  const load = async () => {
    const [documentsResponse, categoriesResponse] = await Promise.all([apiFetch('/api/standards'), apiFetch('/api/source-categories')])
    if (documentsResponse.ok) setDocs(await documentsResponse.json())
    if (categoriesResponse.ok) setCategories(await categoriesResponse.json())
  }
  useEffect(() => { load() }, [])
  const upload = async () => {
    if (!file && !form.sourceUrl.trim()) return
    setBusy('upload'); setError('')
    const body = new FormData()
    if (file) body.append('file', file)
    Object.entries(form).forEach(([key, value]) => body.append(key, value))
    const response = await apiFetch('/api/standards', { method: 'POST', body })
    const data = await response.json(); setBusy('')
    if (!response.ok) return setError(data.error || 'Source could not be added')
    setFile(null); setForm(emptyForm(isAdmin)); load()
  }
  const extract = async id => {
    setBusy(id); setError('')
    const response = await apiFetch(`/api/standards/${id}/extract`, { method: 'POST' }); const data = await response.json(); setBusy('')
    if (!response.ok) return setError(data.error || 'Requirements could not be extracted')
    load()
  }
  const remove = async id => {
    if (!confirm('Remove this library source?')) return
    const response = await apiFetch(`/api/standards/${id}`, { method: 'DELETE' })
    if (!response.ok) return setError((await response.json()).error || 'Source could not be removed')
    load()
  }
  const updateSensitivity = sensitivity => setForm(current => ({ ...current, sensitivity, visibility: sensitivity === 'restricted' ? 'organization' : current.visibility }))

  return <div style={{ minHeight: '100vh', background: '#f1f5f9', color: '#0f172a' }}>
    <header style={{ minHeight: 60, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14, flexWrap: 'wrap' }}>
      <button onClick={() => nav('/')} style={darkButton}>← Proposals</button>
      <div style={{ flex: 1 }}><div style={{ fontWeight: 800 }}>Shared Standards &amp; Evidence Catalog</div><div style={{ fontSize: 10, color: '#a5b4fc' }}>Shared sources for every user, with organization and restricted layers</div></div>
      {isAdmin && <button onClick={() => nav('/admin/sources')} style={{ ...darkButton, color: '#fbbf24' }}>⚠ Source health</button>}
    </header>
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: 28 }}>
      <section style={card}>
        <h2 style={{ margin: '0 0 6px' }}>Add a governed source</h2>
        <p style={{ color: '#64748b', margin: '0 0 18px', fontSize: 13 }}>Shared sources are available to every signed-in user. Organization sources stay inside your company. Restricted utility or infrastructure records cannot be shared and are excluded from AI processing.</p>
        {error && <div style={{ padding: 11, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', marginBottom: 14, fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          <input style={input} placeholder="Source title" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} />
          <select style={input} value={form.sourceCategory} onChange={event => setForm({ ...form, sourceCategory: event.target.value })}>{categories.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}</select>
          <select style={input} value={form.documentType} onChange={event => setForm({ ...form, documentType: event.target.value })}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <input style={input} placeholder="Jurisdiction (e.g. Brigham City, UT)" value={form.jurisdiction} onChange={event => setForm({ ...form, jurisdiction: event.target.value })} />
          <input style={input} placeholder="Client (optional)" value={form.client} onChange={event => setForm({ ...form, client: event.target.value })} />
          <input style={input} placeholder="Project types, comma separated" value={form.projectTypes} onChange={event => setForm({ ...form, projectTypes: event.target.value })} />
          <input style={input} type="url" placeholder="Authoritative source URL" value={form.sourceUrl} onChange={event => setForm({ ...form, sourceUrl: event.target.value })} />
          <select style={input} value={form.visibility} disabled={!isAdmin || form.sensitivity === 'restricted'} onChange={event => setForm({ ...form, visibility: event.target.value })}>
            {isAdmin && <option value="shared">Shared with everyone</option>}
            <option value="organization">Organization only</option>
          </select>
          <select style={input} value={form.sensitivity} onChange={event => updateSensitivity(event.target.value)}>
            <option value="public">Public / normal</option>
            <option value="restricted">Restricted infrastructure</option>
          </select>
          <button style={primary} onClick={() => fileRef.current.click()}>{file ? file.name : 'Attach PDF or TXT (optional)'}</button>
          <input ref={fileRef} hidden type="file" accept=".pdf,.txt" onChange={event => setFile(event.target.files[0])} />
        </div>
        <button disabled={(!file && !form.sourceUrl.trim()) || busy === 'upload'} onClick={upload} style={{ ...primary, marginTop: 14, opacity: (!file && !form.sourceUrl.trim()) ? .5 : 1 }}>{busy === 'upload' ? 'Adding source…' : 'Add to catalog'}</button>
      </section>

      <section style={{ ...card, marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><h2 style={{ margin: 0 }}>Catalog sources</h2><span style={{ color: '#64748b', fontSize: 12 }}>{docs.filter(doc => doc.visibility === 'shared').length} shared · {docs.filter(doc => doc.visibility === 'organization').length} organization</span></div>
        {!docs.length && <div style={{ color: '#64748b', paddingTop: 18 }}>No sources uploaded yet.</div>}
        {docs.map(doc => {
          const category = categories.find(item => item.key === doc.sourceCategory)
          const canManage = doc.visibility !== 'shared' || isAdmin
          return <div key={doc.id} style={{ borderTop: '1px solid #e2e8f0', padding: '16px 0', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}><b>{doc.title}</b><Badge tone={doc.visibility === 'shared' ? 'blue' : 'gray'}>{doc.visibility === 'shared' ? 'Shared' : 'Organization'}</Badge>{doc.sensitivity === 'restricted' && <Badge tone="red">Restricted</Badge>}</div>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 5 }}>{category?.label || doc.sourceCategory} · {doc.jurisdiction || 'Any jurisdiction'} · {doc.requirements?.length || 0} extracted requirements</div>
              {doc.sourceUrl && <a href={doc.sourceUrl} target="_blank" rel="noreferrer" style={{ display: 'block', color: '#4f46e5', fontSize: 11, marginTop: 4, overflowWrap: 'anywhere' }}>{doc.sourceUrl}</a>}
            </div>
            <span style={{ color: doc.extractionStatus === 'complete' ? '#15803d' : '#a16207', fontSize: 12, fontWeight: 700 }}>{doc.extractionStatus?.replace('_', ' ')}</span>
            {canManage && doc.extractionStatus !== 'url_only' && <button style={primary} disabled={busy === doc.id} onClick={() => extract(doc.id)}>{busy === doc.id ? 'Extracting…' : doc.extractionStatus === 'complete' ? 'Re-extract' : 'Extract requirements'}</button>}
            {canManage && <button style={secondary} onClick={() => remove(doc.id)}>Remove</button>}
          </div>
        })}
      </section>
    </main>
  </div>
}

function Badge({ children, tone }) {
  const colors = tone === 'blue' ? ['#eef2ff', '#4338ca'] : tone === 'red' ? ['#fef2f2', '#b91c1c'] : ['#f1f5f9', '#475569']
  return <span style={{ padding: '3px 7px', borderRadius: 20, background: colors[0], color: colors[1], fontSize: 10, fontWeight: 800 }}>{children}</span>
}

const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 22, boxShadow: '0 3px 12px rgba(15,23,42,.05)' }
const input = { padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, background: 'white', minWidth: 0 }
const primary = { padding: '9px 13px', border: 0, borderRadius: 8, background: '#4f46e5', color: 'white', fontWeight: 700, cursor: 'pointer' }
const secondary = { ...primary, background: '#f1f5f9', color: '#475569' }
const darkButton = { ...secondary, background: '#1e293b', color: '#cbd5e1' }
