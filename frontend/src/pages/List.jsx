import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useApiFetch } from '../context/AuthContext'
import Icon from '../components/Icon'

const SC = { pending:'#66717d', in_review:'#087d73', needs_updates:'#94570e', accepted:'#177055', rejected:'#b43c38' }
const SL = { pending:'Pending', in_review:'In Review', needs_updates:'Needs Updates', accepted:'Accepted', rejected:'Rejected' }
const STATUS_TONE = { pending:'', in_review:'teal', needs_updates:'amber', accepted:'green', rejected:'red' }

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
  const [municipalities, setMunicipalities] = useState([])
  const [jurisdictionError, setJurisdictionError] = useState('')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [form, setForm] = useState({ name: '', company: '', location: '', postalCode: '' })
  const [file, setFile] = useState(null)
  const [pasteText, setPasteText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [sourceAlerts, setSourceAlerts] = useState(0)
  const fileRef = useRef()
  const dialogRef = useRef()
  const openerRef = useRef()

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
    let active = true
    apiFetch('/api/jurisdictions').then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Municipality list could not be loaded.')
      if (active) setMunicipalities(data)
    }).catch(error => {
      if (active) setJurisdictionError(error.message)
    })
    return () => { active = false }
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
    if (!form.location.trim()) return alert('Governing city and state are required')
    if (!/\b(?:utah|ut)\b/i.test(form.location)) return alert('Include Utah state in the governing location, e.g. Brigham City, UT')
    if (form.postalCode && !/^\d{5}(?:-\d{4})?$/.test(form.postalCode.trim())) return alert('ZIP code must use 5 digits or ZIP+4 format')
    if (!file && !pasteText.trim()) return alert('Upload a file or paste text')
    setUploading(true)
    const fd = new FormData()
    fd.append('name', form.name); fd.append('company', form.company); fd.append('location', form.location)
    fd.append('postal_code', form.postalCode.trim())
    if (file) fd.append('file', file); else fd.append('text_content', pasteText)
    try {
      const r = await apiFetch('/api/proposals', { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Upload failed.')
      const { id } = data
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

  const openUpload = () => { openerRef.current = document.activeElement; setShowUpload(true) }
  const closeUpload = () => { setShowUpload(false); requestAnimationFrame(() => openerRef.current?.focus()) }
  useEffect(() => {
    if (!showUpload) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector('input')?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') closeUpload()
      if (event.key !== 'Tab') return
      const focusable = [...dialogRef.current.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])')].filter(element => !element.disabled && element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]; const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown) }
  }, [showUpload])


  return (
    <div className="civic-page">
      <header className="civic-header civic-list-header">
        <div className="civic-brand"><span className="civic-brand-mark"><Icon name="civic" size={18} /></span><span>City Form Reviewer</span></div>
        <nav className="civic-list-nav" aria-label="Main navigation">
          <button className="civic-btn" onClick={() => nav('/my-work')}><Icon name="work" size={16} /> My Work</button>
          <button className="civic-btn" onClick={() => nav('/standards')}><Icon name="book" size={16} /> Standards</button>
          {['manager', 'admin'].includes(user?.role) && <button className="civic-btn" onClick={() => nav('/admin/sources')}><Icon name="alert" size={16} /> Sources{sourceAlerts ? ' (' + sourceAlerts + ')' : ''}</button>}
          <button className="civic-btn" onClick={() => nav('/dashboard')}><Icon name="grid" size={16} /> Dashboard</button>
          <button className="civic-btn" onClick={() => nav('/profile')}><Icon name="user" size={16} /> Profile</button>
          <button className="civic-btn civic-btn-primary" onClick={openUpload}><Icon name="plus" size={16} /> New Contract</button>
          <button className="civic-btn" onClick={() => { logout(); nav('/login') }}><Icon name="logout" size={16} /> Sign out</button>
        </nav>
      </header>

      <main className="civic-list-main">
        <div className="civic-list-intro">
          <div><div className="civic-eyebrow">{user?.companyName || 'Review workspace'}</div><h1 className="civic-title">Contracts &amp; proposals</h1><p>Open a proposal to review its document, standards, and diagram findings.</p></div>
          <button className="civic-btn" onClick={openUpload}><Icon name="plus" size={16} /> Upload contract</button>
        </div>
        <div className="civic-counts"><span className="civic-pill">{totalCount} contracts</span><span className="civic-pill">{locCount} locations</span></div>
        <div className="civic-filters">
          <label className="sr-only" htmlFor="proposal-search">Search contracts</label>
          <input id="proposal-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search contracts, clients, locations…" />
          <label className="sr-only" htmlFor="proposal-status">Filter by status</label>
          <select id="proposal-status" value={filterStatus} onChange={event => setFilterStatus(event.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(SL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        {totalCount === 0 && <div className="civic-card" style={{ padding:40, textAlign:'center' }}>
          <Icon name="file" size={32} style={{ color:'var(--teal)', marginBottom:12 }} />
          <h2 className="civic-section-title">{search || filterStatus ? 'No matching contracts' : 'No contracts yet'}</h2>
          <p className="civic-muted" style={{ fontSize:13, margin:'8px 0 18px' }}>{search || filterStatus ? 'Try another search or status.' : 'Upload your first contract to start a review.'}</p>
          {!search && !filterStatus && <button className="civic-btn civic-btn-primary" onClick={openUpload}>Upload first contract</button>}
        </div>}

        {Object.entries(grouped).map(([location, items], index) => <section className="civic-location" key={location}>
          <button aria-expanded={expanded[location] !== false} aria-controls={'location-' + index} onClick={() => setExpanded(current => ({ ...current, [location]: !current[location] }))}>
            <Icon name="chevron" size={17} style={{ transform:expanded[location] === false ? 'rotate(-90deg)' : undefined }} />
            <Icon name="pin" size={17} style={{ color:'var(--teal)' }} />
            {location}<span className="civic-pill location-count">{items.length}</span>
          </button>
          {expanded[location] !== false && <div id={'location-' + index} className="civic-proposal-table">
            {items.map(proposal => <div className="civic-proposal-row" key={proposal.id}>
              <div><button className="civic-proposal-link" onClick={() => nav('/proposal/' + proposal.id)}>{proposal.name}</button><span className="meta">{proposal.company || 'Client not set'}</span></div>
              <span className="date civic-muted" style={{ fontSize:12 }}>{relTime(proposal.updated_at)}</span>
              <span><span className={'civic-pill ' + (STATUS_TONE[proposal.status] || '')}>{SL[proposal.status] || proposal.status}</span></span>
              <button className="civic-btn civic-icon-btn civic-btn-danger" onClick={event => deleteProposal(event, proposal.id)} title={'Delete ' + proposal.name} aria-label={'Delete ' + proposal.name}><Icon name="trash" size={16} /></button>
            </div>)}
          </div>}
        </section>)}
      </main>

      {showUpload && <div className="civic-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeUpload() }}>
        <div ref={dialogRef} className="civic-dialog civic-card" role="dialog" aria-modal="true" aria-labelledby="upload-title">
          <div style={{ display:'flex', alignItems:'start', justifyContent:'space-between', gap:12 }}>
            <div><div className="civic-eyebrow">New review</div><h2 id="upload-title" className="civic-section-title" style={{ marginTop:5 }}>Upload a contract</h2><p className="civic-muted" style={{ fontSize:12, marginTop:6 }}>Add a PDF, text file, or pasted proposal text.</p></div>
            <button className="civic-btn civic-icon-btn" onClick={closeUpload} title="Close upload dialog" aria-label="Close upload dialog"><Icon name="x" size={17} /></button>
          </div>
          <label htmlFor="contract-name">Contract / project name <span aria-hidden="true">*</span></label>
          <input id="contract-name" value={form.name} onChange={event => setForm(current => ({ ...current, name:event.target.value }))} placeholder="e.g. Oak Ridge Infrastructure Contract" required />
          <label htmlFor="contract-client">Client</label>
          <input id="contract-client" value={form.company} list="client-options" onChange={event => setForm(current => ({ ...current, company:event.target.value }))} placeholder="Select or enter a new client" />
          <datalist id="client-options">{clients.map(client => <option key={client} value={client} />)}</datalist>
          <label htmlFor="contract-location">Governing city and state <span aria-hidden="true">*</span></label>
          <input id="contract-location" list="municipality-options" value={form.location} onChange={event => setForm(current => ({ ...current, location:event.target.value }))} placeholder="e.g. Brigham City, UT" required />
          <datalist id="municipality-options">{municipalities.map(municipality => <option key={`${municipality.name}-${municipality.state}`} value={`${municipality.name}, ${municipality.state === 'Utah' ? 'UT' : municipality.state}`} label={municipality.counties.join(', ')} />)}</datalist>
          <p className="civic-muted" style={{ fontSize:11, margin:'-5px 0 12px' }}>Select the municipality with authority over the project. ZIP codes are optional and do not determine jurisdiction.</p>
          {jurisdictionError && <p role="status" style={{ color:'#b45309', fontSize:11, margin:'-6px 0 12px' }}>City suggestions unavailable: {jurisdictionError} Enter the governing city and state manually.</p>}
          <label htmlFor="contract-postal-code">ZIP code (optional)</label>
          <input id="contract-postal-code" value={form.postalCode} onChange={event => setForm(current => ({ ...current, postalCode:event.target.value }))} placeholder="e.g. 84321" inputMode="numeric" pattern="\d{5}(-\d{4})?" maxLength={10} />
          <label htmlFor="contract-file">Document</label>
          <input ref={fileRef} id="contract-file" type="file" accept=".pdf,.txt" onChange={event => { setFile(event.target.files[0]); setPasteText('') }} style={{ display:'none' }} />
          <button type="button" className="civic-btn" style={{ width:'100%', minHeight:70, borderStyle:'dashed', justifyContent:'start' }} onClick={() => fileRef.current?.click()}><Icon name="file" /> {file ? file.name : 'Choose PDF or TXT file (up to 50 MB)'}</button>
          <label htmlFor="contract-text">Or paste text</label>
          <textarea id="contract-text" value={pasteText} onChange={event => { setPasteText(event.target.value); setFile(null) }} placeholder="Paste proposal text here…" rows={4} />
          <div style={{ display:'flex', justifyContent:'end', gap:9, marginTop:22 }}>
            <button className="civic-btn" onClick={closeUpload}>Cancel</button>
            <button className="civic-btn civic-btn-primary" disabled={uploading} onClick={handleUpload}>{uploading ? 'Preparing review…' : 'Upload & start review'}</button>
          </div>
        </div>
      </div>}
    </div>
  )
}
