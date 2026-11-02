import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useApiFetch } from '../context/AuthContext'
import Icon from '../components/Icon'

const SC = { pending: '#66717d', in_review: '#087d73', needs_updates: '#94570e', accepted: '#177055', rejected: '#b43c38' }
const SL = { pending: 'Pending', in_review: 'In Review', needs_updates: 'Needs Updates', accepted: 'Accepted', rejected: 'Rejected' }
const SBG = { pending: '#f8fafb', in_review: '#e7f5f2', needs_updates: '#fff4df', accepted: '#eaf5ef', rejected: '#fbeceb' }
const STATUSES = ['pending', 'in_review', 'needs_updates', 'accepted', 'rejected']
const PR_COLOR = { high: '#b43c38', medium: '#94570e', low: '#177055', '': '#66717d' }
const PR_LABEL = { high: 'High', medium: 'Medium', low: 'Low', '': 'None' }

function relTime(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function Dashboard() {
  const nav = useNavigate()
  const { user, logout } = useAuth()
  const apiFetch = useApiFetch()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const r = await apiFetch('/api/dashboard')
    const d = await r.json()
    setData(d)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (loading || !data) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#66717d', background: '#f4f6f8' }}>
      <div className="spin" style={{ fontSize: 24, color: '#087d73' }}>⟳</div>
      <div style={{ fontSize: 14 }}>Loading dashboard…</div>
    </div>
  )

  const total = data.total || 0
  const locations = Object.entries(data.locationCounts || {}).sort((a, b) => b[1] - a[1])
  const reviewers = Object.entries(data.reviewerCounts || {}).sort((a, b) => b[1].total - a[1].total)
  const maxLoc = Math.max(...locations.map(([, c]) => c), 1)

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif' }}>

      <header className="civic-header civic-list-header">
        <button className="civic-btn civic-icon-btn" title="Back to proposals" aria-label="Back to proposals" onClick={() => nav('/')}><Icon name="arrow" /></button>
        <div className="civic-brand"><span className="civic-brand-mark"><Icon name="grid" size={18} /></span>Manager dashboard</div>
        <nav className="civic-list-nav" aria-label="Dashboard navigation">
          <button className="civic-btn" onClick={() => nav('/my-work')}><Icon name="work" size={16} /> My Work</button>
          <button className="civic-btn" onClick={load}><Icon name="clock" size={16} /> Refresh</button>
          <button className="civic-btn" onClick={() => nav('/profile')}><Icon name="user" size={16} /> {user?.name || 'Profile'}</button>
        </nav>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>

        <div className="civic-eyebrow">Proposal overview</div>
        <h1 className="civic-title" style={{ marginBottom:24 }}>Manager dashboard</h1>

        {/* ── Status Overview Cards ── */}
        <div style={{ marginBottom: 10 }}>
          <SectionLabel>Overview</SectionLabel>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 32 }}>
          {/* Total card */}
          <div style={{ background: 'white', borderRadius: 14, padding: '18px 20px', border: '1px solid #dde2e7', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#66717d', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Total</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#14324a', lineHeight: 1, marginBottom: 4 }}>{total}</div>
            <div style={{ fontSize: 12, color: '#66717d' }}>Proposals</div>
          </div>
          {STATUSES.map(s => {
            const count = data.statusCounts[s] || 0
            const pct = total ? Math.round((count / total) * 100) : 0
            return (
              <div key={s} style={{ background: SBG[s], borderRadius: 14, padding: '18px 20px', border: `1px solid ${SC[s]}22`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: SC[s], textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>{SL[s]}</div>
                <div style={{ fontSize: 36, fontWeight: 900, color: SC[s], lineHeight: 1, marginBottom: 4 }}>{count}</div>
                <div style={{ fontSize: 11, color: SC[s], fontWeight: 600 }}>{pct}% of total</div>
                {/* Mini bar */}
                <div style={{ marginTop: 10, height: 3, background: SC[s] + '22', borderRadius: 2 }}>
                  <div style={{ height: 3, width: `${pct}%`, background: SC[s], borderRadius: 2, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Two column layout ── */}
        <div className="civic-dashboard-columns" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

          {/* By Location */}
          <Card title="By Location" icon="pin">
            {locations.length === 0 ? (
              <Empty>No location data yet</Empty>
            ) : locations.map(([loc, count]) => (
              <div key={loc} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#17212b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#087d73', background: '#eef2ff', padding: '2px 8px', borderRadius: 20 }}>{count}</span>
                </div>
                <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: 6, width: `${(count / maxLoc) * 100}%`, background: '#087d73', borderRadius: 3, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            ))}
          </Card>

          {/* Priority Breakdown */}
          <Card title="Priority" icon="alert">
            {['high', 'medium', 'low', ''].map(p => {
              const count = data.priorityCounts?.[p] || 0
              if (!count) return null
              return (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: PR_COLOR[p], flexShrink: 0, boxShadow: `0 0 0 2px ${PR_COLOR[p]}30` }} />
                  <span style={{ flex: 1, fontSize: 13, color: '#374151', fontWeight: 500 }}>{PR_LABEL[p]}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: PR_COLOR[p] }}>{count}</span>
                  <div style={{ width: 80, height: 5, background: '#f1f5f9', borderRadius: 3 }}>
                    <div style={{ height: 5, width: `${(count / total) * 100}%`, background: PR_COLOR[p], borderRadius: 3 }} />
                  </div>
                </div>
              )
            })}
          </Card>
        </div>

        {/* ── Reviewer Workload ── */}
        <div style={{ marginBottom: 24 }}>
          <Card title="Reviewer Workload" icon="user" fullWidth>
            {reviewers.length === 0 ? (
              <Empty>No reviewer assignments yet — assign proposals in the Viewer</Empty>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Reviewer', 'Total', ...STATUSES.map(s => SL[s])].map(h => (
                        <th key={h} style={{ textAlign: h === 'Reviewer' ? 'left' : 'center', padding: '8px 12px', fontSize: 10, fontWeight: 800, color: '#66717d', textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reviewers.map(([name, counts], ri) => (
                      <tr key={name} style={{ background: ri % 2 === 0 ? 'transparent' : '#fafbfc' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: '#17212b' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <div style={{
                              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                              background: name === 'Unassigned' ? '#f1f5f9' : 'linear-gradient(135deg, #6366f1, #818cf8)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 12, fontWeight: 800, color: name === 'Unassigned' ? '#94a3b8' : 'white'
                            }}>
                              {name === 'Unassigned' ? '?' : name.charAt(0).toUpperCase()}
                            </div>
                            <span style={{ color: name === 'Unassigned' ? '#94a3b8' : '#1e293b', fontStyle: name === 'Unassigned' ? 'italic' : 'normal' }}>{name}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 900, color: '#14324a', fontSize: 15 }}>{counts.total}</td>
                        {STATUSES.map(s => (
                          <td key={s} style={{ textAlign: 'center', padding: '10px 12px' }}>
                            {counts[s] > 0 ? (
                              <span style={{ display: 'inline-block', minWidth: 24, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: SC[s] + '18', color: SC[s], border: `1px solid ${SC[s]}28` }}>
                                {counts[s]}
                              </span>
                            ) : <span style={{ color: '#e2e8f0', fontSize: 11 }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ── Recent Activity ── */}
        <Card title="Recent Activity" icon="clock" fullWidth>
          {(data.recent || []).length === 0 ? (
            <Empty>No proposals yet</Empty>
          ) : (data.recent || []).map(p => (
            <div key={p.id} role="link" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') nav(`/proposal/${p.id}`) }}
              onClick={() => nav(`/proposal/${p.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 4px', borderBottom: '1px solid #f8fafc', cursor: 'pointer', borderRadius: 8, transition: 'background 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: '#e7f5f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}><Icon name="file" size={17} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#14324a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: '#66717d', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {p.company && <span style={{ color: '#66717d' }}>{p.company}</span>}
                  {p.company && (p.location || p.postalCode) && <span>·</span>}
                  {(p.location || p.postalCode) && <span>{[p.location, p.postalCode].filter(Boolean).join(' ')}</span>}
                  {p.assignedTo && <><span>·</span><span>{p.assignedTo}</span></>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: (SC[p.status] || '#6b7280') + '15', color: SC[p.status] || '#6b7280', border: `1px solid ${(SC[p.status] || '#6b7280')}22`, whiteSpace: 'nowrap' }}>
                  {SL[p.status] || p.status}
                </span>
                {p.priority && <span style={{ fontSize: 10, color: PR_COLOR[p.priority], fontWeight: 700 }}>● {PR_LABEL[p.priority]}</span>}
              </div>
              <div style={{ fontSize: 11, color: '#66717d', whiteSpace: 'nowrap', minWidth: 60, textAlign: 'right' }}>{relTime(p.updated_at)}</div>
            </div>
          ))}
        </Card>
      </main>
    </div>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 800, color: '#66717d', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 }}>{children}</div>
}

function Card({ title, icon, children, fullWidth }) {
  return (
    <div style={{ background: 'white', borderRadius: 14, border: '1px solid #dde2e7', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#087d73' }}><Icon name={icon} size={17} /></span>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#14324a', letterSpacing: -0.2 }}>{title}</span>
      </div>
      <div style={{ padding: '16px 18px' }}>{children}</div>
    </div>
  )
}

function Empty({ children }) {
  return <div style={{ textAlign: 'center', padding: '24px 0', color: '#66717d', fontSize: 13 }}>{children}</div>
}
