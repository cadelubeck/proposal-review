import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth, useApiFetch } from '../context/AuthContext'

const SCORES = {
  green:  { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', label: 'Not Concerned', dot: '#22c55e' },
  yellow: { color: '#ca8a04', bg: '#fefce8', border: '#fde68a', label: 'Needs Review',  dot: '#eab308' },
  red:    { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Needs Updates', dot: '#ef4444' },
}
const STATUSES = ['pending','in_review','needs_updates','accepted','rejected']
const SC = { pending:'#6b7280', in_review:'#3b82f6', needs_updates:'#f59e0b', accepted:'#22c55e', rejected:'#ef4444' }
const SL = { pending:'Pending', in_review:'In Review', needs_updates:'Needs Updates', accepted:'Accepted', rejected:'Rejected' }

function useDebounce(fn, delay) {
  const timer = useRef(null)
  return useCallback((...args) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), delay)
  }, [fn, delay])
}

export default function Viewer() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user, token, logout } = useAuth()
  const apiFetch = useApiFetch()
  const [users, setUsers] = useState([])
  const [proposal, setProposal] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [popup, setPopup] = useState(null)
  const [popupNote, setPopupNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [addSecForm, setAddSecForm] = useState(false)
  const [newSecTitle, setNewSecTitle] = useState('')
  const [aiLoading, setAiLoading] = useState(null)
  const [aiError, setAiError] = useState(null)
  const contentRef = useRef(null)

  // Layout state
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [viewMode, setViewMode] = useState('text')

  // Version management
  const [versionModal, setVersionModal] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [versionFile, setVersionFile] = useState(null)
  const [versionLabel, setVersionLabel] = useState('')
  const [uploadingVersion, setUploadingVersion] = useState(false)

  // Diagram analysis
  const [diagramModal, setDiagramModal] = useState(false)
  const [diagramLoading, setDiagramLoading] = useState(false)
  const [diagramError, setDiagramError] = useState(null)

  const load = async () => {
    const r = await apiFetch(`/api/proposals/${id}`)
    if (!r.ok) return nav('/')
    const data = await r.json()
    setProposal(data)
    if (data.sections?.length) setSelectedId(data.sections[0].id)
    if (data.file_path) setViewMode('pdf')
  }
  useEffect(() => { load() }, [id])

  useEffect(() => {
    apiFetch('/api/users').then(r => r.ok ? r.json() : []).then(setUsers).catch(() => {})
  }, [])

  const persist = useCallback(async (patch) => {
    setSaving(true)
    await apiFetch(`/api/proposals/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    setSaving(false)
  }, [id, apiFetch])

  const debouncedPersist = useDebounce(persist, 800)
  const patchProposal = (patch) => { setProposal(p => ({ ...p, ...patch })); debouncedPersist(patch) }
  const updateSection = (sid, updates) => {
    const sections = proposal.sections.map(s => s.id === sid ? { ...s, ...updates } : s)
    patchProposal({ sections })
  }

  const scrollTo = (sid) => {
    setSelectedId(sid)
    setRightOpen(true)
    if (viewMode === 'text') {
      document.getElementById(`sec-${sid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const onMouseUp = useCallback(() => {
    if (viewMode !== 'text') return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const txt = sel.toString().trim()
    if (!txt || txt.length > 2000) return
    const range = sel.getRangeAt(0)
    const contentEl = contentRef.current
    if (!contentEl?.contains(range.commonAncestorContainer)) return
    const pre = document.createRange()
    pre.selectNodeContents(contentEl)
    pre.setEnd(range.startContainer, range.startOffset)
    const start = pre.toString().length
    const rect = range.getBoundingClientRect()
    setPopup({ txt, start, end: start + txt.length, x: rect.left + rect.width / 2, y: rect.bottom + 10 })
    setPopupNote('')
  }, [viewMode])

  const saveHighlight = () => {
    const highlights = [...(proposal.highlights || []), { id: crypto.randomUUID(), text: popup.txt, start: popup.start, end: popup.end, note: popupNote, sectionId: selectedId }]
    patchProposal({ highlights })
    setPopup(null)
    window.getSelection()?.removeAllRanges()
  }

  const removeHighlight = (hid) => patchProposal({ highlights: proposal.highlights.filter(h => h.id !== hid) })

  const addSection = async () => {
    if (!newSecTitle.trim()) return
    const r = await apiFetch(`/api/proposals/${id}/sections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newSecTitle.trim(), startLine: 0 }) })
    const sec = await r.json()
    setProposal(p => ({ ...p, sections: [...p.sections, sec] }))
    setNewSecTitle(''); setAddSecForm(false); setSelectedId(sec.id)
  }

  const runAiReview = async (sec) => {
    setAiLoading(sec.id)
    setAiError(null)
    try {
      const r = await apiFetch(`/api/proposals/${id}/ai-review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId: sec.id })
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || 'AI review failed')
      updateSection(sec.id, { aiReview: result })
    } catch (e) {
      setAiError(e.message)
    } finally {
      setAiLoading(null)
    }
  }

  const uploadNewVersion = async () => {
    if (!versionFile) return
    setUploadingVersion(true)
    try {
      const form = new FormData()
      form.append('file', versionFile)
      if (versionLabel.trim()) form.append('label', versionLabel.trim())
      const r = await apiFetch(`/api/proposals/${id}/versions`, { method: 'POST', body: form })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || 'Upload failed')
      setVersionFile(null); setVersionLabel(''); setSelectedVersion(null)
      setVersionModal(false)
      await load()
    } catch (e) { alert(e.message) }
    finally { setUploadingVersion(false) }
  }

  const runDiagramAnalysis = async () => {
    setDiagramLoading(true)
    setDiagramError(null)
    try {
      const r = await apiFetch(`/api/proposals/${id}/analyze-diagrams`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || 'Analysis failed')
      setProposal(p => ({ ...p, diagramAnalysis: result }))
    } catch (e) { setDiagramError(e.message) }
    finally { setDiagramLoading(false) }
  }

  const renderText = () => {
    const text = proposal?.text_content
    if (!text) return <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No text content available.</span>
    const lines = text.split('\n')
    const lineOffset = []
    let off = 0
    for (const l of lines) { lineOffset.push(off); off += l.length + 1 }
    const events = []
    for (const s of (proposal.sections || [])) events.push({ pos: lineOffset[s.startLine] ?? 0, type: 'sec', id: s.id })
    for (const h of (proposal.highlights || [])) {
      events.push({ pos: h.start, type: 'hl+', h })
      events.push({ pos: h.end, type: 'hl-', hid: h.id })
    }
    events.sort((a, b) => a.pos !== b.pos ? a.pos - b.pos : (a.type === 'sec' ? -1 : a.type === 'hl+' ? 0 : 1))
    const nodes = []; let cur = 0, activeHl = null, k = 0
    const push = (chunk) => {
      if (!chunk) return
      nodes.push(activeHl
        ? <mark key={k++} style={{ background: '#fef08a', borderRadius: 2, cursor: 'pointer' }} title={activeHl.note || undefined}>{chunk}</mark>
        : <span key={k++}>{chunk}</span>)
    }
    for (const ev of events) {
      if (ev.pos > cur) { push(text.slice(cur, ev.pos)); cur = ev.pos }
      if (ev.type === 'sec') nodes.push(<span key={k++} id={`sec-${ev.id}`} style={{ display: 'block' }} />)
      else if (ev.type === 'hl+') activeHl = ev.h
      else activeHl = null
    }
    if (cur < text.length) push(text.slice(cur))
    return nodes
  }

  if (!proposal) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#64748b' }}>
      <div className="spin" style={{ fontSize: 24, color: '#6366f1' }}>⟳</div>
      <div style={{ fontSize: 14 }}>Loading proposal…</div>
    </div>
  )

  const selSec = proposal.sections?.find(s => s.id === selectedId)
  const overallScore = proposal.sections?.some(s => s.score === 'red') ? 'red'
    : proposal.sections?.some(s => s.score === 'yellow') ? 'yellow' : 'green'
  const hasFile = !!proposal.file_path
  const pdfUrl = selectedVersion !== null
    ? `/api/proposals/${id}/file?version=${selectedVersion}&token=${token}`
    : `/api/proposals/${id}/file?token=${token}`
  const currentVersionNum = (proposal.versions?.length || 0) + 1

  const CollapseBtn = ({ side, open, onClick }) => {
    const isLeft = side === 'left'
    return (
      <button onClick={onClick}
        title={open ? `Collapse ${isLeft ? 'sections' : 'review'} panel` : `Expand ${isLeft ? 'sections' : 'review'} panel`}
        style={{
          width: 24, flexShrink: 0, alignSelf: 'stretch', border: 'none', cursor: 'pointer',
          background: '#f8fafc', color: '#94a3b8',
          borderLeft: !isLeft ? '1px solid #e2e8f0' : 'none',
          borderRight: isLeft ? '1px solid #e2e8f0' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.12s, color 0.12s'
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}
        onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#94a3b8' }}>
        {isLeft ? (
          open ? (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2" width="13" height="12" rx="2"/>
              <line x1="6" y1="2" x2="6" y2="14"/>
              <polyline points="4,6.5 2.5,8 4,9.5"/>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2" width="13" height="12" rx="2"/>
              <line x1="6" y1="2" x2="6" y2="14"/>
              <polyline points="8,6.5 9.5,8 8,9.5"/>
            </svg>
          )
        ) : (
          open ? (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2" width="13" height="12" rx="2"/>
              <line x1="10" y1="2" x2="10" y2="14"/>
              <polyline points="12,6.5 13.5,8 12,9.5"/>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2" width="13" height="12" rx="2"/>
              <line x1="10" y1="2" x2="10" y2="14"/>
              <polyline points="8,6.5 6.5,8 8,9.5"/>
            </svg>
          )
        )}
      </button>
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif' }}>

      {/* ── Header ── */}
      <header style={{
        background: '#0f172a', color: 'white', padding: '0 16px', height: 56,
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        boxShadow: '0 1px 0 rgba(255,255,255,0.05), 0 2px 16px rgba(0,0,0,0.3)'
      }}>
        <button onClick={() => nav('/')} title="Back to proposals"
          style={{ background: 'rgba(255,255,255,0.07)', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, padding: '6px 10px', borderRadius: 7, lineHeight: 1, transition: 'all 0.12s', flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'white' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#94a3b8' }}>←</button>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: -0.3 }}>{proposal.name}</div>
          {(proposal.company || proposal.location) && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{[proposal.company, proposal.location].filter(Boolean).join(' · ')}</div>
          )}
        </div>

        <button onClick={() => nav(`/proposal/${id}/compliance`)}
          style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: '1px solid #818cf8', color: 'white', padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
          ⚖ Controlling Standards
        </button>

        {/* Version badge */}
        {hasFile && (
          <button onClick={() => setVersionModal(true)}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8',
              padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
              transition: 'all 0.12s', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; e.currentTarget.style.color = 'white' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#94a3b8' }}>
            {selectedVersion !== null
              ? <span style={{ color: '#fbbf24' }}>v{selectedVersion + 1} ↩</span>
              : <span>v{currentVersionNum} {(proposal.versions?.length || 0) > 0 ? '▾' : '+'}</span>}
          </button>
        )}

        {/* Diagram analysis button */}
        {hasFile && (
          <button onClick={() => setDiagramModal(true)}
            style={{
              background: proposal.diagramAnalysis
                ? (SCORES[proposal.diagramAnalysis.overallCompliance]?.bg)
                : 'rgba(99,102,241,0.15)',
              border: proposal.diagramAnalysis
                ? `1px solid ${SCORES[proposal.diagramAnalysis.overallCompliance]?.border}`
                : '1px solid rgba(99,102,241,0.3)',
              color: proposal.diagramAnalysis
                ? SCORES[proposal.diagramAnalysis.overallCompliance]?.color
                : '#818cf8',
              padding: '5px 11px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
              transition: 'all 0.15s', flexShrink: 0
            }}>
            🏗 {proposal.diagramAnalysis ? 'Diagrams' : 'Analyze Diagrams'}
          </button>
        )}


        <div style={{
          padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800,
          background: SCORES[overallScore].bg, color: SCORES[overallScore].color,
          border: `1px solid ${SCORES[overallScore].border}`, flexShrink: 0
        }}>
          ● {SCORES[overallScore].label}
        </div>

        {/* Assigned reviewer */}
        <select
          value={proposal.assignedToId || ''}
          onChange={e => {
            const u = users.find(u => u.id === e.target.value)
            patchProposal({ assignedToId: e.target.value, assignedTo: u?.name || '' })
          }}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', fontSize: 12, fontWeight: 600, outline: 'none', flexShrink: 0, background: 'rgba(15,23,42,0.8)', color: proposal.assignedToId ? 'white' : '#64748b', cursor: 'pointer', maxWidth: 150 }}>
          <option value="">Unassigned</option>
          {users.map(u => <option key={u.id} value={u.id} style={{ background: '#1e293b', color: 'white' }}>{u.name}</option>)}
        </select>

        {/* Priority */}
        <select value={proposal.priority || ''} onChange={e => patchProposal({ priority: e.target.value })}
          style={{ padding: '6px 9px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none', flexShrink: 0, background: 'rgba(255,255,255,0.07)', color: { high: '#f87171', medium: '#fbbf24', low: '#4ade80', '': '#64748b' }[proposal.priority || ''] }}>
          <option value="" style={{ background: '#1e293b', color: '#94a3b8' }}>Priority</option>
          <option value="high" style={{ background: '#1e293b', color: '#f87171' }}>🔴 High</option>
          <option value="medium" style={{ background: '#1e293b', color: '#fbbf24' }}>🟡 Medium</option>
          <option value="low" style={{ background: '#1e293b', color: '#4ade80' }}>🟢 Low</option>
        </select>

        <select value={proposal.status} onChange={e => patchProposal({ status: e.target.value })}
          style={{ padding: '6px 11px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none', flexShrink: 0, background: SC[proposal.status] + '22', color: SC[proposal.status] }}>
          {STATUSES.map(s => <option key={s} value={s} style={{ background: '#1e293b', color: 'white' }}>{SL[s]}</option>)}
        </select>

        {saving && <span className="pulse" style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>Saving…</span>}
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── LEFT SIDEBAR ── */}
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <div style={{
            width: leftOpen ? 224 : 0, overflow: 'hidden',
            transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
            background: 'white', flexShrink: 0
          }}>
            <div style={{ width: 224, height: '100%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #f1f5f9' }}>
              <div style={{ padding: '14px 14px 8px', fontSize: 9, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, whiteSpace: 'nowrap' }}>
                Sections
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
                {proposal.sections?.map(sec => {
                  const s = SCORES[sec.score] || SCORES.green
                  const active = selectedId === sec.id
                  return (
                    <div key={sec.id} onClick={() => scrollTo(sec.id)}
                      style={{
                        padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 9,
                        borderRadius: 8, marginBottom: 2, transition: 'all 0.12s',
                        background: active ? s.bg : 'transparent'
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f8fafc' }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, flexShrink: 0, marginTop: 5, boxShadow: active ? `0 0 0 2px ${s.dot}30` : 'none', transition: 'all 0.12s' }} />
                      <span style={{ fontSize: 12.5, color: active ? '#1e293b' : '#64748b', lineHeight: 1.4, wordBreak: 'break-word', fontWeight: active ? 600 : 400, transition: 'all 0.12s' }}>
                        {sec.title}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div style={{ borderTop: '1px solid #f1f5f9', padding: 10 }}>
                {addSecForm ? (
                  <div>
                    <input autoFocus value={newSecTitle} onChange={e => setNewSecTitle(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addSection()}
                      placeholder="Section title"
                      style={{ width: '100%', padding: '7px 9px', border: '1.5px solid #6366f1', borderRadius: 7, fontSize: 12, marginBottom: 7, outline: 'none' }} />
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button onClick={() => setAddSecForm(false)} style={sBtn('#f1f5f9', '#374151')}>Cancel</button>
                      <button onClick={addSection} style={sBtn('#6366f1', 'white')}>Add</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAddSecForm(true)}
                    style={{ width: '100%', padding: '7px', borderRadius: 7, border: '1.5px dashed #e2e8f0', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#94a3b8', transition: 'all 0.12s', whiteSpace: 'nowrap' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#6366f1' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#94a3b8' }}>
                    + Add Section
                  </button>
                )}
              </div>
            </div>
          </div>
          <CollapseBtn side="left" open={leftOpen} onClick={() => setLeftOpen(o => !o)} />
        </div>

        {/* ── CENTER: Document ── */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative', background: '#fdfdfd' }}>
          {selectedVersion !== null && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
              background: '#fef3c7', borderBottom: '1px solid #fde68a',
              padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12
            }}>
              <span style={{ color: '#92400e', fontWeight: 700 }}>⏱ Viewing v{selectedVersion + 1} (archived)</span>
              <button onClick={() => setSelectedVersion(null)}
                style={{ background: '#92400e', color: 'white', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                Return to Current
              </button>
            </div>
          )}

          {viewMode === 'pdf' && hasFile ? (
            <iframe
              src={pdfUrl}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              title="Proposal Document"
            />
          ) : (
            <div style={{ height: '100%', overflow: 'auto' }} onMouseUp={onMouseUp}>
              <div ref={contentRef}
                style={{ maxWidth: 740, margin: '0 auto', padding: '40px 48px', fontSize: 14.5, lineHeight: 1.9, color: '#1e293b', whiteSpace: 'pre-wrap', fontFamily: 'Georgia, "Times New Roman", serif' }}>
                {renderText()}
              </div>
            </div>
          )}

          {!hasFile && viewMode === 'text' && (
            <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.6)', color: '#94a3b8', fontSize: 11, padding: '6px 12px', borderRadius: 20, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              Text view — select text to highlight
            </div>
          )}
        </div>

        {/* ── RIGHT SIDEBAR TOGGLE + PANEL ── */}
        <CollapseBtn side="right" open={rightOpen} onClick={() => setRightOpen(o => !o)} />

        <div style={{
          width: rightOpen ? 340 : 0, overflow: 'hidden',
          transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
          background: '#f8fafc', flexShrink: 0
        }}>
          <div style={{ width: 340, height: '100%', overflow: 'auto', borderLeft: '1px solid #f1f5f9' }}>
            {selSec ? (
              <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0f172a', lineHeight: 1.4, padding: '0 2px' }}>
                  {selSec.title}
                </div>

                {/* ── ENGINEER REVIEW ── */}
                <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                  <div style={{ padding: '10px 14px 10px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 0 2px #bfdbfe' }} />
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: 1 }}>Engineer Review</span>
                  </div>
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <Label>Score</Label>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {Object.entries(SCORES).map(([key, val]) => {
                          const active = selSec.score === key
                          return (
                            <button key={key} onClick={() => updateSection(selSec.id, { score: key })}
                              style={{
                                flex: 1, padding: '8px 4px', borderRadius: 7, cursor: 'pointer',
                                fontSize: 11, fontWeight: 700, lineHeight: 1.3, transition: 'all 0.12s',
                                border: `2px solid ${active ? val.color : '#e2e8f0'}`,
                                background: active ? val.bg : 'white', color: active ? val.color : '#94a3b8'
                              }}>
                              <div style={{ fontSize: 13, marginBottom: 2 }}>●</div>
                              {val.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div>
                      <Label>Engineer Decision</Label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {[['approved','Approve','#16a34a','#f0fdf4'],['changes_required','Deny / Revise','#dc2626','#fef2f2'],['acknowledged','Acknowledge','#d97706','#fffbeb']].map(([value,label,color,bg]) => (
                          <button key={value} onClick={() => updateSection(selSec.id, { engineerDecision: value, decidedBy: user?.name, decidedAt: new Date().toISOString() })}
                            style={{ flex: 1, padding: '8px 4px', borderRadius: 7, cursor: 'pointer', fontSize: 10.5, fontWeight: 800, border: `1.5px solid ${selSec.engineerDecision === value ? color : '#e2e8f0'}`, background: selSec.engineerDecision === value ? bg : 'white', color: selSec.engineerDecision === value ? color : '#64748b' }}>
                            {label}
                          </button>
                        ))}
                      </div>
                      {selSec.engineerDecision && <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 6 }}>Recorded by {selSec.decidedBy || 'reviewer'}</div>}
                    </div>

                    <div>
                      <Label>Notes</Label>
                      <textarea value={selSec.notes || ''} rows={4}
                        onChange={e => updateSection(selSec.id, { notes: e.target.value })}
                        placeholder="Add review notes, concerns, recommendations…"
                        style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, resize: 'vertical', lineHeight: 1.55, outline: 'none', fontFamily: 'inherit', color: '#1e293b', background: '#fafafa', transition: 'border-color 0.15s' }}
                        onFocus={e => e.target.style.borderColor = '#6366f1'}
                        onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                    </div>

                    <div>
                      <Label>Statutes & References</Label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(selSec.statutes || []).map((st, i) => (
                          <div key={i} style={{ padding: '9px 11px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                            <a href={st.url || '#'} target="_blank" rel="noreferrer"
                              style={{ color: '#2563eb', fontSize: 12.5, fontWeight: 700, textDecoration: 'none', wordBreak: 'break-word', display: 'block', marginBottom: 3 }}
                              onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                              onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                              {st.title}
                            </a>
                            {st.relevance && <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.4, marginBottom: 3 }}>{st.relevance}</div>}
                            {st.jurisdiction && <div style={{ fontSize: 11, color: '#94a3b8' }}>📍 {st.jurisdiction}</div>}
                            <button onClick={() => updateSection(selSec.id, { statutes: selSec.statutes.filter((_, j) => j !== i) })}
                              style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 11, marginTop: 5, padding: 0, transition: 'color 0.12s' }}
                              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                              onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}>
                              Remove
                            </button>
                          </div>
                        ))}
                        <StatuteForm onAdd={st => updateSection(selSec.id, { statutes: [...(selSec.statutes || []), st] })} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── HIGHLIGHTS ── */}
                {(proposal.highlights || []).filter(h => h.sectionId === selSec.id).length > 0 && (
                  <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#eab308', boxShadow: '0 0 0 2px #fef08a' }} />
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: 1 }}>Highlights</span>
                    </div>
                    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {proposal.highlights.filter(h => h.sectionId === selSec.id).map(h => (
                        <div key={h.id} style={{ padding: '8px 10px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a', fontSize: 12 }}>
                          <div style={{ fontStyle: 'italic', color: '#92400e', marginBottom: h.note ? 4 : 0, lineHeight: 1.4 }}>
                            "{h.text.length > 100 ? h.text.slice(0, 100) + '…' : h.text}"
                          </div>
                          {h.note && <div style={{ color: '#374151', lineHeight: 1.4 }}>{h.note}</div>}
                          <button onClick={() => removeHighlight(h.id)}
                            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 11, padding: 0, marginTop: 4, transition: 'color 0.12s' }}
                            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                            onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── AI REVIEW ── */}
                <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e0e7ff', overflow: 'hidden', boxShadow: '0 1px 4px rgba(99,102,241,0.08)' }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid #eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 0 2px #c7d2fe' }} />
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#4338ca', textTransform: 'uppercase', letterSpacing: 1 }}>AI Review</span>
                    </div>
                    <button onClick={() => runAiReview(selSec)} disabled={aiLoading === selSec.id}
                      style={{
                        padding: '5px 12px', borderRadius: 7, border: 'none', cursor: aiLoading === selSec.id ? 'default' : 'pointer',
                        background: aiLoading === selSec.id ? '#e0e7ff' : 'linear-gradient(135deg, #4f46e5, #6366f1)',
                        color: aiLoading === selSec.id ? '#818cf8' : 'white',
                        fontSize: 11, fontWeight: 700, transition: 'all 0.15s',
                        boxShadow: aiLoading === selSec.id ? 'none' : '0 2px 8px rgba(79,70,229,0.35)'
                      }}>
                      {aiLoading === selSec.id
                        ? <span><span className="spin">⟳</span> Analyzing…</span>
                        : selSec.aiReview ? '↻ Re-run' : '✦ Run AI Review'}
                    </button>
                  </div>

                  <div style={{ padding: '12px 14px' }}>
                    {aiError && (
                      <div className="fade-in" style={{ fontSize: 12, color: '#dc2626', padding: '9px 11px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', marginBottom: 10, lineHeight: 1.5 }}>
                        {aiError}
                      </div>
                    )}

                    {!selSec.aiReview && aiLoading !== selSec.id && !aiError && (
                      <div style={{ textAlign: 'center', padding: '20px 10px', color: '#94a3b8' }}>
                        <div style={{ fontSize: 28, marginBottom: 10 }}>✦</div>
                        <div style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 220, margin: '0 auto' }}>
                          Compare this requirement against city standards and supporting reports, then review the finding and source before making your decision.
                        </div>
                      </div>
                    )}

                    {aiLoading === selSec.id && (
                      <div className="fade-in" style={{ textAlign: 'center', padding: '24px 10px', color: '#6366f1' }}>
                        <div className="spin" style={{ fontSize: 28, display: 'block', marginBottom: 10 }}>⟳</div>
                        <div className="pulse" style={{ fontSize: 12, color: '#818cf8' }}>Claude is analyzing this section…</div>
                      </div>
                    )}

                    {selSec.aiReview && (
                      <div className="fade-in">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                          <div style={{
                            padding: '4px 11px', borderRadius: 20, fontSize: 11.5, fontWeight: 800,
                            background: SCORES[selSec.aiReview.score]?.bg,
                            color: SCORES[selSec.aiReview.score]?.color,
                            border: `1px solid ${SCORES[selSec.aiReview.score]?.border}`
                          }}>
                            ✦ {SCORES[selSec.aiReview.score]?.label}
                          </div>
                          <button onClick={() => updateSection(selSec.id, { score: selSec.aiReview.score })}
                            style={{ fontSize: 11, padding: '4px 9px', border: '1px solid #e0e7ff', borderRadius: 6, background: 'white', cursor: 'pointer', color: '#4f46e5', fontWeight: 600, transition: 'all 0.12s' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#eef2ff' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'white' }}>
                            Apply Score
                          </button>
                        </div>

                        {selSec.aiReview.notes && (
                          <div style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.6, marginBottom: 14, padding: '10px 12px', background: '#f5f3ff', borderRadius: 9, border: '1px solid #e0e7ff' }}>
                            {selSec.aiReview.notes}
                          </div>
                        )}

                        {selSec.aiReview.statutes?.length > 0 && (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                              <Label style={{ marginBottom: 0, color: '#4338ca' }}>Applicable Laws</Label>
                              <button onClick={() => {
                                const existing = selSec.statutes || []
                                const newOnes = selSec.aiReview.statutes.filter(ai => !existing.some(e => e.title === ai.title))
                                if (newOnes.length) updateSection(selSec.id, { statutes: [...existing, ...newOnes] })
                              }}
                                style={{ fontSize: 10, padding: '3px 9px', border: '1px solid #c7d2fe', borderRadius: 6, background: 'white', cursor: 'pointer', color: '#4f46e5', fontWeight: 700, transition: 'all 0.12s' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#eef2ff'}
                                onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                                Import All
                              </button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                              {selSec.aiReview.statutes.map((st, i) => (
                                <div key={i} style={{ padding: '10px 11px', background: '#f5f3ff', borderRadius: 9, border: '1px solid #e0e7ff' }}>
                                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 5 }}>
                                    <div style={{ flex: 1, fontWeight: 700, fontSize: 12.5, color: '#3730a3', lineHeight: 1.35, wordBreak: 'break-word' }}>
                                      {st.url ? (
                                        <a href={st.url} target="_blank" rel="noreferrer"
                                          style={{ color: '#3730a3', textDecoration: 'none' }}
                                          onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                                          onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                                          {st.title} ↗
                                        </a>
                                      ) : st.title}
                                    </div>
                                    <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 4, background: '#e0e7ff', color: '#3730a3', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 700, letterSpacing: 0.3 }}>
                                      {st.jurisdiction}
                                    </span>
                                  </div>
                                  {st.relevance && (
                                    <div style={{ fontSize: 12, color: '#4338ca', lineHeight: 1.45, marginBottom: st.url ? 6 : 0 }}>
                                      {st.relevance}
                                    </div>
                                  )}
                                  {st.url && (
                                    <a href={st.url} target="_blank" rel="noreferrer"
                                      style={{ fontSize: 10.5, color: '#818cf8', textDecoration: 'none', wordBreak: 'break-all', display: 'block' }}
                                      onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                                      onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                                      {st.url}
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ fontSize: 10, color: '#c7d2fe', marginTop: 10, textAlign: 'right' }}>
                          Generated {new Date(selSec.aiReview.generatedAt).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            ) : (
              <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14, marginTop: 60 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>←</div>
                Select a section to begin review
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Highlight Popup ── */}
      {popup && (
        <div className="fade-in" style={{
          position: 'fixed', left: Math.min(popup.x - 155, window.innerWidth - 320), top: popup.y,
          background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.2)', zIndex: 300, width: 310
        }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, fontStyle: 'italic', lineHeight: 1.45, background: '#fefce8', padding: '7px 10px', borderRadius: 7, border: '1px solid #fde68a' }}>
            "{popup.txt.length > 80 ? popup.txt.slice(0, 80) + '…' : popup.txt}"
          </div>
          <input value={popupNote} onChange={e => setPopupNote(e.target.value)}
            placeholder="Add a note (optional)"
            autoFocus
            style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, marginBottom: 10, outline: 'none', transition: 'border-color 0.15s' }}
            onKeyDown={e => e.key === 'Enter' && saveHighlight()}
            onFocus={e => e.target.style.borderColor = '#6366f1'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
          <div style={{ display: 'flex', gap: 7 }}>
            <button onClick={() => { setPopup(null); window.getSelection()?.removeAllRanges() }} style={sBtn('#f1f5f9', '#374151')}>Cancel</button>
            <button onClick={saveHighlight} style={sBtn('#fef08a', '#92400e')}>✦ Highlight</button>
          </div>
        </div>
      )}

      {/* ── Version Modal ── */}
      {versionModal && (
        <VersionModal
          proposal={proposal}
          selectedVersion={selectedVersion}
          onSelectVersion={(vIdx) => { setSelectedVersion(vIdx); setViewMode('pdf'); setVersionModal(false) }}
          onUpload={uploadNewVersion}
          onClose={() => setVersionModal(false)}
          versionFile={versionFile}
          setVersionFile={setVersionFile}
          versionLabel={versionLabel}
          setVersionLabel={setVersionLabel}
          uploading={uploadingVersion}
        />
      )}

      {/* ── Diagram Modal ── */}
      {diagramModal && (
        <DiagramModal
          proposal={proposal}
          onClose={() => setDiagramModal(false)}
          onRun={runDiagramAnalysis}
          loading={diagramLoading}
          error={diagramError}
        />
      )}
    </div>
  )
}

function Label({ children, style }) {
  return <div style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 7, ...style }}>{children}</div>
}

function sBtn(bg, color) {
  return { flex: 1, padding: '7px', borderRadius: 7, border: 'none', background: bg, color, cursor: 'pointer', fontSize: 12, fontWeight: 600 }
}

function StatuteForm({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title: '', url: '', relevance: '', jurisdiction: '' })
  const add = () => {
    if (!f.title.trim()) return
    onAdd({ ...f }); setF({ title: '', url: '', relevance: '', jurisdiction: '' }); setOpen(false)
  }
  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ width: '100%', padding: '7px', borderRadius: 8, border: '1.5px dashed #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 12, color: '#94a3b8', transition: 'all 0.12s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#6366f1' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#94a3b8' }}>
      + Add Statute / Reference
    </button>
  )
  return (
    <div className="fade-in" style={{ padding: '10px 11px', background: '#f8fafc', borderRadius: 9, border: '1.5px solid #e2e8f0' }}>
      {[['title', 'e.g. Cal. Gov. Code § 65300'],
        ['url', 'https://leginfo.legislature.ca.gov/…'],
        ['jurisdiction', 'State / County / City'],
        ['relevance', 'Brief explanation…']
      ].map(([key, ph]) => (
        <input key={key} value={f[key]} onChange={e => setF(x => ({ ...x, [key]: e.target.value }))} placeholder={ph}
          style={{ width: '100%', padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none', marginBottom: 6, transition: 'border-color 0.12s', background: 'white' }}
          onFocus={e => e.target.style.borderColor = '#6366f1'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
      ))}
      <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
        <button onClick={() => setOpen(false)} style={sBtn('#f1f5f9', '#374151')}>Cancel</button>
        <button onClick={add} style={sBtn('#4f46e5', 'white')}>Add</button>
      </div>
    </div>
  )
}

function VersionModal({ proposal, selectedVersion, onSelectVersion, onUpload, onClose, versionFile, setVersionFile, versionLabel, setVersionLabel, uploading }) {
  const versions = proposal.versions || []
  const currentNum = versions.length + 1

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fade-in" style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 520, width: '90%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: 0 }}>Version History</h2>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', color: '#64748b', cursor: 'pointer', padding: '5px 10px', borderRadius: 6, fontSize: 13, fontWeight: 700 }}>✕</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          {/* Current version */}
          <div onClick={() => onSelectVersion(null)}
            style={{
              padding: '12px 14px', borderRadius: 9, marginBottom: 6, cursor: 'pointer',
              background: selectedVersion === null ? '#eef2ff' : '#f8fafc',
              border: `1px solid ${selectedVersion === null ? '#c7d2fe' : '#e2e8f0'}`,
              display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.12s'
            }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>v{currentNum} — Current</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{new Date(proposal.updated_at).toLocaleString()}</div>
            </div>
            {selectedVersion === null && <span style={{ fontSize: 10, fontWeight: 800, color: '#6366f1', background: '#e0e7ff', padding: '2px 8px', borderRadius: 4 }}>VIEWING</span>}
          </div>

          {[...versions].reverse().map((v, ri) => {
            const vIdx = versions.length - 1 - ri
            return (
              <div key={vIdx} onClick={() => onSelectVersion(vIdx)}
                style={{
                  padding: '12px 14px', borderRadius: 9, marginBottom: 6, cursor: 'pointer',
                  background: selectedVersion === vIdx ? '#eef2ff' : '#f8fafc',
                  border: `1px solid ${selectedVersion === vIdx ? '#c7d2fe' : '#e2e8f0'}`,
                  display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.12s'
                }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{v.label || `v${vIdx + 1}`}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{new Date(v.uploaded_at).toLocaleString()}</div>
                </div>
                {selectedVersion === vIdx && <span style={{ fontSize: 10, fontWeight: 800, color: '#6366f1', background: '#e0e7ff', padding: '2px 8px', borderRadius: 4 }}>VIEWING</span>}
              </div>
            )
          })}
        </div>

        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Upload New Version</div>
          <input type="text" placeholder="Version label (optional)" value={versionLabel} onChange={e => setVersionLabel(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, marginBottom: 8, outline: 'none', transition: 'border-color 0.12s', background: '#fafafa', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = '#6366f1'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
          <label style={{
            display: 'block', padding: '16px', borderRadius: 9, border: `2px dashed ${versionFile ? '#86efac' : '#e2e8f0'}`,
            cursor: 'pointer', textAlign: 'center', transition: 'all 0.12s', background: versionFile ? '#f0fdf4' : '#fafafa'
          }}>
            <input type="file" accept=".pdf,.txt" onChange={e => setVersionFile(e.target.files[0])} style={{ display: 'none' }} />
            {versionFile ? (
              <div>
                <div style={{ fontSize: 24, marginBottom: 6 }}>📄</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a' }}>{versionFile.name}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{(versionFile.size / 1024 / 1024).toFixed(2)} MB — click to change</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
                <div style={{ fontSize: 12.5, color: '#64748b' }}>Click to select PDF or text file</div>
              </div>
            )}
          </label>
          <button onClick={onUpload} disabled={!versionFile || uploading}
            style={{
              width: '100%', marginTop: 10, padding: '11px', borderRadius: 9, border: 'none',
              background: versionFile && !uploading ? 'linear-gradient(135deg, #4f46e5, #6366f1)' : '#e2e8f0',
              color: versionFile && !uploading ? 'white' : '#94a3b8',
              cursor: versionFile && !uploading ? 'pointer' : 'default', fontWeight: 700, fontSize: 13, transition: 'all 0.15s',
              boxShadow: versionFile && !uploading ? '0 4px 14px rgba(79,70,229,0.35)' : 'none'
            }}>
            {uploading ? <span><span className="spin">⟳</span> Uploading…</span> : 'Upload New Version'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DiagramModal({ proposal, onClose, onRun, loading, error }) {
  const analysis = proposal.diagramAnalysis
  const SCORES = {
    green:  { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', label: 'Compliant' },
    yellow: { color: '#ca8a04', bg: '#fefce8', border: '#fde68a', label: 'Needs Review' },
    red:    { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Issues Found' },
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fade-in" style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 660, width: '90%', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: 0 }}>Document &amp; Diagram Analysis</h2>
            {analysis && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Generated {new Date(analysis.generatedAt).toLocaleString()}</div>}
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', color: '#64748b', cursor: 'pointer', padding: '5px 10px', borderRadius: 6, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>✕</button>
        </div>

        {!analysis && !loading && (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🏗️</div>
            <p style={{ color: '#374151', fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Analyze All Diagrams &amp; Blueprints</p>
            <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.7, maxWidth: 380, margin: '0 auto 24px' }}>
              Claude will read the full PDF and analyze every site plan, floor plan, elevation, blueprint, and technical drawing against municipal code requirements.
            </p>
            {error && <div style={{ color: '#dc2626', background: '#fef2f2', padding: '10px 14px', borderRadius: 8, marginBottom: 20, fontSize: 13, border: '1px solid #fecaca' }}>{error}</div>}
            <button onClick={onRun} style={{
              padding: '12px 28px', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg, #4f46e5, #6366f1)', color: 'white',
              fontWeight: 700, fontSize: 14, cursor: 'pointer', boxShadow: '0 6px 20px rgba(79,70,229,0.4)',
              transition: 'all 0.15s'
            }}>✦ Analyze All Diagrams</button>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '64px 24px' }}>
            <div className="spin" style={{ fontSize: 40, color: '#6366f1', display: 'block', marginBottom: 20 }}>⟳</div>
            <p className="pulse" style={{ color: '#6366f1', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Analyzing diagrams and blueprints…</p>
            <p style={{ color: '#94a3b8', fontSize: 12 }}>This may take 30–90 seconds for complex documents</p>
          </div>
        )}

        {analysis && !loading && (
          <div className="fade-in">
            {/* Overall compliance */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
              background: SCORES[analysis.overallCompliance]?.bg,
              border: `1px solid ${SCORES[analysis.overallCompliance]?.border}`,
              borderRadius: 12, marginBottom: 20
            }}>
              <div style={{ fontSize: 24, flexShrink: 0 }}>
                {analysis.overallCompliance === 'green' ? '✅' : analysis.overallCompliance === 'yellow' ? '⚠️' : '🚨'}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: SCORES[analysis.overallCompliance]?.color, marginBottom: 4 }}>
                  {SCORES[analysis.overallCompliance]?.label}
                </div>
                {analysis.summary && <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{analysis.summary}</div>}
              </div>
            </div>

            {/* Critical issues */}
            {analysis.criticalIssues?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Critical Issues</div>
                {analysis.criticalIssues.map((issue, i) => (
                  <div key={i} style={{ padding: '9px 13px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: 13, color: '#dc2626', marginBottom: 6, lineHeight: 1.5 }}>
                    ⚠ {issue}
                  </div>
                ))}
              </div>
            )}

            {/* Diagrams */}
            {analysis.diagrams?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                  Diagrams Found ({analysis.diagrams.length})
                </div>
                {analysis.diagrams.map((d, i) => (
                  <div key={i} style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: 11, border: '1px solid #e2e8f0', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <div style={{
                        padding: '3px 10px', borderRadius: 5,
                        background: SCORES[d.compliance]?.bg, color: SCORES[d.compliance]?.color,
                        border: `1px solid ${SCORES[d.compliance]?.border}`, fontSize: 10.5, fontWeight: 800
                      }}>
                        {d.compliance?.toUpperCase()}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', background: '#eef2ff', padding: '3px 8px', borderRadius: 4 }}>{d.type}</span>
                      {d.location && <span style={{ fontSize: 11, color: '#94a3b8' }}>📍 {d.location}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, marginBottom: 8 }}>{d.description}</div>
                    {d.concerns?.map((c, j) => (
                      <div key={j} style={{ fontSize: 12, color: '#dc2626', padding: '5px 9px', background: '#fef2f2', borderRadius: 6, marginBottom: 4 }}>⚠ {c}</div>
                    ))}
                    {d.positives?.map((p, j) => (
                      <div key={j} style={{ fontSize: 12, color: '#16a34a', padding: '5px 9px', background: '#f0fdf4', borderRadius: 6, marginBottom: 4 }}>✓ {p}</div>
                    ))}
                    {d.missingElements?.map((m, j) => (
                      <div key={j} style={{ fontSize: 12, color: '#ca8a04', padding: '5px 9px', background: '#fefce8', borderRadius: 6, marginBottom: 4 }}>Missing: {m}</div>
                    ))}
                    {d.codes?.length > 0 && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>📋 {d.codes.join(' · ')}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Recommendations */}
            {analysis.recommendations?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Recommendations</div>
                {analysis.recommendations.map((r, i) => (
                  <div key={i} style={{ padding: '9px 13px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0', fontSize: 13, color: '#166534', marginBottom: 6, lineHeight: 1.5 }}>
                    ✓ {r}
                  </div>
                ))}
              </div>
            )}

            <div style={{ paddingTop: 16, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {error && <span style={{ fontSize: 12, color: '#dc2626', marginRight: 'auto', alignSelf: 'center' }}>{error}</span>}
              <button onClick={onRun}
                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e0e7ff', background: 'white', color: '#4f46e5', fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'all 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#eef2ff'}
                onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                ↻ Re-analyze
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
