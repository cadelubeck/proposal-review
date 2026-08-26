import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useApiFetch } from '../context/AuthContext'

const SC = { pending:'#6b7280', in_review:'#3b82f6', needs_updates:'#f59e0b', accepted:'#22c55e', rejected:'#ef4444' }
const SL = { pending:'Pending', in_review:'In Review', needs_updates:'Needs Updates', accepted:'Accepted', rejected:'Rejected' }

function relTime(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function List() {
  const nav = useNavigate()
  const { user, logout } = useAuth()
  const apiFetch = useApiFetch()
  const [proposals, setProposals] = useState([])
  const [clients, setClients] = useState([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [form, setForm] = useState({ name: '', company: '', location: '' })
  const [file, setFile] = useState(null)
  const [pasteText, setPasteText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [sourceAlerts, setSourceAlerts] = useState(0)
  const fileRef = useRef()

  const load = async () => {
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (filterStatus) p.set('status', filterStatus)
    const r = await apiFetch(`/api/proposals?${p}`)
    const data = await r.json()
    setProposals(data)
    if (Object.keys(expanded).length === 0) {
      const locs = [...new Set(data.map(d => d.location || 'No Location'))]
      const init = {}; locs.forEach(l => init[l] = true)
      setExpanded(init)
    }
  }

  useEffect(() => { load() }, [search, filterStatus])
  useEffect(() => {
    apiFetch('/api/clients').then(r => r.json()).then(setClients).catch(() => {})
  }, [])
  useEffect(() => {
    if (!['manager', 'admin'].includes(user?.role)) return
    apiFetch('/api/admin/source-health').then(response => response.ok ? response.json() : null).then(data => data && setSourceAlerts(data.notificationCount || 0)).catch(() => {})
  }, [user?.role])

  const grouped = proposals.reduce((acc, p) => {
    const loc = p.location || 'No Location'
    if (!acc[loc]) acc[loc] = []
    acc[loc].push(p)
    return acc
  }, {})

  const handleUpload = async () => {
    if (!form.name.trim()) return alert('Contract name is required')
    if (!file && !pasteText.trim()) return alert('Upload a file or paste text')
    setUploading(true)
    const fd = new FormData()
    fd.append('name', form.name); fd.append('company', form.company); fd.append('location', form.location)
    if (file) fd.append('file', file); else fd.append('text_content', pasteText)
    try {
      const r = await apiFetch('/api/proposals', { method: 'POST', body: fd })
      const { id } = await r.json()
      nav(`/proposal/${id}`)
    } catch (e) { alert('Upload failed: ' + e.message) }
    finally { setUploading(false) }
  }

  const deleteProposal = async (e, id) => {
    e.stopPropagation()
    if (!confirm('Delete this proposal?')) return
    await apiFetch(`/api/proposals/${id}`, { method: 'DELETE' })
    load()
  }

  const totalCount = proposals.length
  const locCount = Object.keys(grouped).length

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>

      {/* ── Header ── */}
      <header style={{
        background: '#0f172a',
        padding: '0 24px',
        height: 60,
        display: 'flex', alignItems: 'center', gap: 14,
        position: 'sticky', top: 0, zIndex: 50,
        boxShadow: '0 1px 0 rgba(255,255,255,0.05), 0 4px 20px rgba(0,0,0,0.4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 8, flexShrink: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>🏛</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#fff', letterSpacing: -0.4, lineHeight: 1.2 }}>City Form Reviewer</div>
            <div style={{ fontSize: 9, color: '#818cf8', fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>{user?.companyName || 'AI Compliance Review'}</div>
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#475569', pointerEvents: 'none' }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search contracts, clients, locations…"
            style={{
              width: '100%', padding: '9px 14px 9px 32px',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
              fontSize: 13, background: 'rgba(255,255,255,0.07)', color: '#fff',
              outline: 'none', transition: 'all 0.15s'
            }}
            onFocus={e => { e.target.style.background = 'rgba(255,255,255,0.11)'; e.target.style.borderColor = 'rgba(99,102,241,0.6)' }}
            onBlur={e => { e.target.style.background = 'rgba(255,255,255,0.07)'; e.target.style.borderColor = 'rgba(255,255,255,0.08)' }} />
        </div>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8, outline: 'none', cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: 12, fontWeight: 600,
            background: 'rgba(255,255,255,0.07)', color: '#cbd5e1'
          }}>
          <option value="" style={{ background: '#1e293b' }}>All Statuses</option>
          {Object.entries(SL).map(([v, l]) => <option key={v} value={v} style={{ background: '#1e293b' }}>{l}</option>)}
        </select>

        <button onClick={() => nav('/my-work')}
          style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#cbd5e1', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.13)'; e.currentTarget.style.color = 'white' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#cbd5e1' }}>
          📋 My Work
        </button>

        <button onClick={() => nav('/standards')}
          style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#cbd5e1', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
          📚 Standards
        </button>

        {['manager', 'admin'].includes(user?.role) && <button onClick={() => nav('/admin/sources')}
          style={{ padding: '9px 13px', borderRadius: 8, border: `1px solid ${sourceAlerts ? 'rgba(251,191,36,.5)' : 'rgba(255,255,255,0.1)'}`, cursor: 'pointer', background: sourceAlerts ? 'rgba(245,158,11,.12)' : 'rgba(255,255,255,0.07)', color: sourceAlerts ? '#fbbf24' : '#cbd5e1', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
          ⚠ Sources{sourceAlerts ? ` (${sourceAlerts})` : ''}
        </button>}

        <button onClick={() => nav('/dashboard')}
          style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#cbd5e1', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.13)'; e.currentTarget.style.color = 'white' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#cbd5e1' }}>
          📊 Dashboard
        </button>

        <button onClick={() => nav('/profile')}
          style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#cbd5e1', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
          👤 Profile
        </button>

        <button onClick={() => setShowUpload(true)}
          style={{ padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #4f46e5, #6366f1)', color: 'white', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(79,70,229,0.5)', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(79,70,229,0.6)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(79,70,229,0.5)' }}>
          + New Contract
        </button>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />

        {/* User avatar + logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: 'white', flexShrink: 0, cursor: 'pointer' }}
            onClick={() => nav('/profile')} title={`${user?.name} — view profile`}>
            {user?.name?.charAt(0)?.toUpperCase()}
          </div>
          <button onClick={() => { logout(); nav('/login') }}
            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '4px 6px', borderRadius: 6, transition: 'color 0.12s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fca5a5'}
            onMouseLeave={e => e.currentTarget.style.color = '#475569'}>
            Sign out
          </button>
        </div>
      </header>

      {/* ── Content ── */}
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px' }}>

        <section style={{ background: 'linear-gradient(135deg,#312e81,#4f46e5)', borderRadius: 20, padding: '30px 32px', marginBottom: 28, color: 'white', boxShadow: '0 14px 35px rgba(79,70,229,.22)', display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#c7d2fe', textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: 800, marginBottom: 9 }}>Start a compliance review</div>
            <h1 style={{ fontSize: 25, lineHeight: 1.18, letterSpacing: -.6, marginBottom: 9 }}>Upload a contract. Get a clear, sourced risk review.</h1>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#e0e7ff', maxWidth: 580 }}>AI breaks the document into reviewable requirements, checks each item against city standards and supporting reports, and shows what passed, what failed, and what needs an engineer’s decision.</p>
          </div>
          <button onClick={() => setShowUpload(true)} style={{ padding: '13px 19px', borderRadius: 10, border: 'none', background: 'white', color: '#4338ca', fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 5px 18px rgba(15,23,42,.2)' }}>＋ Upload contract</button>
        </section>

        {/* Stats */}
        {totalCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28, fontSize: 13, color: '#64748b' }}>
            <span style={{ fontWeight: 700, color: '#1e293b' }}>{totalCount}</span> contract{totalCount !== 1 ? 's' : ''}
            <span style={{ color: '#cbd5e1' }}>·</span>
            <span style={{ fontWeight: 700, color: '#1e293b' }}>{locCount}</span> location{locCount !== 1 ? 's' : ''}
            {filterStatus && (
              <>
                <span style={{ color: '#cbd5e1' }}>·</span>
                <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: SC[filterStatus] + '18', color: SC[filterStatus], border: `1px solid ${SC[filterStatus]}28` }}>
                  {SL[filterStatus]}
                </span>
                <button onClick={() => setFilterStatus('')}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                  × clear
                </button>
              </>
            )}
          </div>
        )}

        {/* Empty state */}
        {totalCount === 0 && (
          <div style={{ textAlign: 'center', padding: '90px 20px' }}>
            <div style={{ fontSize: 52, marginBottom: 18, filter: 'grayscale(0.2)' }}>🏛</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', letterSpacing: -0.4, marginBottom: 8 }}>
              {search ? `No results for "${search}"` : 'No contracts yet'}
            </div>
            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 28, maxWidth: 340, margin: '0 auto 28px' }}>
              {search ? 'Try a different search term or clear your filter.'
                : 'Upload your first contract to start an AI-powered municipal compliance review.'}
            </div>
            {!search && (
              <button onClick={() => setShowUpload(true)}
                style={{
                  padding: '11px 28px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                  color: 'white', fontSize: 14, fontWeight: 700,
                  boxShadow: '0 4px 16px rgba(79,70,229,0.4)'
                }}>
                Upload First Contract
              </button>
            )}
          </div>
        )}

        {/* Groups */}
        {Object.entries(grouped).map(([location, items]) => (
          <div key={location} style={{ marginBottom: 28 }}>
            <div onClick={() => setExpanded(e => ({ ...e, [location]: !e[location] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 12, userSelect: 'none' }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                background: 'white', border: '1.5px solid #e2e8f0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: '#475569'
              }}>
                {expanded[location] !== false ? '▾' : '▸'}
              </div>
              <span style={{ fontSize: 12.5, color: '#475569' }}>📍</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{location}</span>
              <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 20, background: '#e2e8f0', color: '#475569', fontWeight: 700 }}>
                {items.length}
              </span>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
            </div>

            {expanded[location] !== false && (
              <div style={{ paddingLeft: 34, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {items.map(p => (
                  <div key={p.id} onClick={() => nav(`/proposal/${p.id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '13px 16px', background: 'white', borderRadius: 11,
                      cursor: 'pointer', border: '1px solid #f1f5f9',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 18px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'none' }}>

                    <div style={{
                      width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                      background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
                    }}>📄</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {p.company && <span style={{ color: '#64748b', fontWeight: 500 }}>{p.company}</span>}
                        {p.company && <span>·</span>}
                        <span>{relTime(p.updated_at)}</span>
                      </div>
                    </div>

                    <span style={{
                      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      background: (SC[p.status] || '#6b7280') + '15',
                      color: SC[p.status] || '#6b7280',
                      border: `1px solid ${(SC[p.status] || '#6b7280')}22`,
                      whiteSpace: 'nowrap'
                    }}>
                      {SL[p.status] || p.status}
                    </span>

                    <button onClick={e => deleteProposal(e, p.id)}
                      style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 20, lineHeight: 1, borderRadius: 5, padding: '0 4px', transition: 'color 0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                      onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
                      title="Delete">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Upload Modal ── */}
      {showUpload && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}
          onClick={e => e.target === e.currentTarget && setShowUpload(false)}>
          <div className="fade-in" style={{
            background: 'white', borderRadius: 18, padding: '32px 32px 28px',
            width: '100%', maxWidth: 460, maxHeight: '92vh', overflow: 'auto',
            boxShadow: '0 30px 90px rgba(0,0,0,0.35)'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 26 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', letterSpacing: -0.5 }}>New Contract Review</div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>AI will extract requirements, risks, passes, and source references</div>
              </div>
              <button onClick={() => setShowUpload(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '2px 6px', borderRadius: 6, marginTop: -2, transition: 'all 0.12s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#374151' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94a3b8' }}>×</button>
            </div>

            {[['Contract / Project Name', 'name', 'e.g. Oak Ridge Infrastructure Contract', true],
              ['Client', 'company', 'Select or enter a new client', false],
              ['Location / Jurisdiction', 'location', 'e.g. Denver, CO', false]
            ].map(([label, key, ph, req]) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {label}{req && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
                </label>
                <input value={form[key]} list={key === 'company' ? 'client-options' : undefined} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph}
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, outline: 'none', transition: 'border-color 0.15s', background: '#fafafa', color: '#0f172a' }}
                  onFocus={e => e.target.style.borderColor = '#6366f1'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
              </div>
            ))}
            <datalist id="client-options">{clients.map(client => <option key={client} value={client} />)}</datalist>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: -8, marginBottom: 16 }}>Choose an existing client or type a name to add one.</div>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Document</label>

            <div onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${file ? '#22c55e' : '#d1d5db'}`,
                borderRadius: 10, padding: '22px 20px', textAlign: 'center',
                marginBottom: 14, cursor: 'pointer', transition: 'all 0.15s',
                background: file ? '#f0fdf4' : '#fafafa'
              }}
              onMouseEnter={e => { if (!file) { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.background = '#f5f3ff' } }}
              onMouseLeave={e => { if (!file) { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.background = '#fafafa' } }}>
              <input ref={fileRef} type="file" accept=".pdf,.txt" onChange={e => { setFile(e.target.files[0]); setPasteText('') }} style={{ display: 'none' }} />
              <div style={{ fontSize: 26, marginBottom: 6 }}>{file ? '✅' : '📎'}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: file ? '#16a34a' : '#374151', marginBottom: 2 }}>
                {file ? file.name : 'Click to upload PDF or TXT'}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{file ? 'Click to change file' : 'PDF or plain text, up to 50 MB'}</div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>or paste text</span>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
            </div>

            <textarea value={pasteText} onChange={e => { setPasteText(e.target.value); setFile(null) }}
              placeholder="Paste proposal text here…"
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, height: 96, resize: 'vertical', fontSize: 13, marginBottom: 24, outline: 'none', transition: 'border-color 0.15s', fontFamily: 'inherit', color: '#0f172a', background: '#fafafa' }}
              onFocus={e => e.target.style.borderColor = '#6366f1'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'} />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowUpload(false)}
                style={{ flex: 1, padding: '11px', borderRadius: 9, border: '1.5px solid #e2e8f0', background: 'white', color: '#374151', cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'background 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                Cancel
              </button>
              <button onClick={handleUpload} disabled={uploading}
                style={{
                  flex: 2, padding: '11px', borderRadius: 9, border: 'none',
                  background: uploading ? '#c7d2fe' : 'linear-gradient(135deg, #4f46e5, #6366f1)',
                  color: 'white', cursor: uploading ? 'default' : 'pointer',
                  fontSize: 13, fontWeight: 700, transition: 'all 0.15s',
                  boxShadow: uploading ? 'none' : '0 2px 10px rgba(79,70,229,0.4)'
                }}>
                {uploading ? <span><span className="spin">⟳</span> Preparing review…</span> : '→ Upload & Start AI Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
