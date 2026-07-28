import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApiFetch } from '../context/AuthContext'

const TYPES = [
  ['city_standard', 'City standard'], ['client_standard', 'Client standard'], ['manual', 'Manual / specification'],
  ['geotechnical', 'Geotechnical report'], ['seismic', 'Seismic report'], ['groundwater', 'Groundwater report'],
  ['floodplain', 'Floodplain document'], ['engineering_report', 'Other engineering report']
]

export default function Standards() {
  const nav = useNavigate(); const apiFetch = useApiFetch(); const fileRef = useRef()
  const [docs, setDocs] = useState([]); const [file, setFile] = useState(null)
  const [form, setForm] = useState({ title: '', documentType: 'city_standard', jurisdiction: '', client: '', projectTypes: '' })
  const [busy, setBusy] = useState('')
  const load = () => apiFetch('/api/standards').then(r => r.json()).then(setDocs)
  useEffect(() => { load() }, [])
  const upload = async () => {
    if (!file) return
    setBusy('upload')
    const fd = new FormData(); fd.append('file', file)
    Object.entries(form).forEach(([k, v]) => fd.append(k, v))
    const r = await apiFetch('/api/standards', { method: 'POST', body: fd })
    const data = await r.json(); setBusy('')
    if (!r.ok) return alert(data.error)
    setFile(null); setForm({ title: '', documentType: 'city_standard', jurisdiction: '', client: '', projectTypes: '' }); load()
  }
  const extract = async id => {
    setBusy(id); const r = await apiFetch(`/api/standards/${id}/extract`, { method: 'POST' }); const data = await r.json(); setBusy('')
    if (!r.ok) return alert(data.error); load()
  }
  const remove = async id => {
    if (!confirm('Remove this library document?')) return
    await apiFetch(`/api/standards/${id}`, { method: 'DELETE' }); load()
  }
  return <div style={{ minHeight: '100vh', background: '#f1f5f9', color: '#0f172a' }}>
    <header style={{ height: 60, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14 }}>
      <button onClick={() => nav('/')} style={darkButton}>← Proposals</button>
      <div><div style={{ fontWeight: 800 }}>Standards & Site Document Library</div><div style={{ fontSize: 10, color: '#a5b4fc' }}>Structured, cited engineering sources</div></div>
    </header>
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 28 }}>
      <section style={card}>
        <h2 style={{ margin: '0 0 6px' }}>Add a controlling source</h2>
        <p style={{ color: '#64748b', margin: '0 0 18px', fontSize: 13 }}>Tag every document so retrieval can match jurisdiction, client, project type, and source authority.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12 }}>
          <input style={input} placeholder="Document title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <select style={input} value={form.documentType} onChange={e => setForm({ ...form, documentType: e.target.value })}>{TYPES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input style={input} placeholder="Jurisdiction (e.g. Brigham City, UT)" value={form.jurisdiction} onChange={e => setForm({ ...form, jurisdiction: e.target.value })} />
          <input style={input} placeholder="Client (optional)" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} />
          <input style={input} placeholder="Project types, comma separated" value={form.projectTypes} onChange={e => setForm({ ...form, projectTypes: e.target.value })} />
          <button style={primary} onClick={() => fileRef.current.click()}>{file ? file.name : 'Choose PDF or TXT'}</button>
          <input ref={fileRef} hidden type="file" accept=".pdf,.txt" onChange={e => setFile(e.target.files[0])} />
        </div>
        <button disabled={!file || busy === 'upload'} onClick={upload} style={{ ...primary, marginTop: 14, opacity: !file ? .5 : 1 }}>{busy === 'upload' ? 'Uploading…' : 'Upload to library'}</button>
      </section>
      <section style={{ ...card, marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>Library documents</h2>
        {!docs.length && <div style={{ color: '#64748b' }}>No sources uploaded yet.</div>}
        {docs.map(doc => <div key={doc.id} style={{ borderTop: '1px solid #e2e8f0', padding: '16px 0', display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 750 }}>{doc.title}</div><div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{TYPES.find(x => x[0] === doc.documentType)?.[1]} · {doc.jurisdiction || 'Any jurisdiction'} · {doc.requirements?.length || 0} extracted requirements</div></div>
          <span style={{ color: doc.extractionStatus === 'complete' ? '#15803d' : '#a16207', fontSize: 12, fontWeight: 700 }}>{doc.extractionStatus}</span>
          <button style={primary} disabled={busy === doc.id} onClick={() => extract(doc.id)}>{busy === doc.id ? 'Extracting…' : doc.extractionStatus === 'complete' ? 'Re-extract' : 'Extract requirements'}</button>
          <button style={secondary} onClick={() => remove(doc.id)}>Remove</button>
        </div>)}
      </section>
    </main>
  </div>
}
const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 22, boxShadow: '0 3px 12px rgba(15,23,42,.05)' }
const input = { padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, background: 'white' }
const primary = { padding: '9px 13px', border: 0, borderRadius: 8, background: '#4f46e5', color: 'white', fontWeight: 700, cursor: 'pointer' }
const secondary = { ...primary, background: '#f1f5f9', color: '#475569' }
const darkButton = { ...secondary, background: '#1e293b', color: '#cbd5e1' }
