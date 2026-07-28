import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useApiFetch } from '../context/AuthContext'

const SC = { pending: '#6b7280', in_review: '#3b82f6', needs_updates: '#f59e0b', accepted: '#22c55e', rejected: '#ef4444' }
const SL = { pending: 'Pending', in_review: 'In Review', needs_updates: 'Needs Updates', accepted: 'Accepted', rejected: 'Rejected' }
const SBG = { pending: '#f1f5f9', in_review: '#eff6ff', needs_updates: '#fffbeb', accepted: '#f0fdf4', rejected: '#fef2f2' }
const PR = { high: { color: '#ef4444', bg: '#fef2f2', label: 'High' }, medium: { color: '#f59e0b', bg: '#fffbeb', label: 'Medium' }, low: { color: '#22c55e', bg: '#f0fdf4', label: 'Low' } }

function relTime(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function MyWork() {
  const nav = useNavigate()
  const { user, logout } = useAuth()
  const apiFetch = useApiFetch()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const r = await apiFetch('/api/me/proposals')
    if (r.ok) setData(await r.json())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (loading || !data) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#64748b', background: '#f1f5f9' }}>
      <div className="spin" style={{ fontSize: 24, color: '#6366f1' }}>⟳</div>
      <div style={{ fontSize: 14 }}>Loading your workload…</div>
    </div>
  )

  const { mine = [], available = [] } = data
  const activeCount = mine.filter(p => !['accepted', 'rejected'].includes(p.status)).length
  const urgentCount = mine.filter(p => p.priority === 'high' && !['accepted', 'rejected'].includes(p.status)).length

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif' }}>

      {/* Header */}
      <header style={{ background: '#0f172a', color: 'white', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        <button onClick={() => nav('/')}
          style={{ background: 'rgba(255,255,255,0.07)', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, padding: '6px 10px', borderRadius: 7, transition: 'all 0.12s', flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'white' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#94a3b8' }}>←</button>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: -0.3 }}>My Work</div>
          <div style={{ fontSize: 10, color: '#818cf8', fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>Personal Dashboard</div>
        </div>
        <div style={{ flex: 1 }} />
        {/* User pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>{user?.name}</div>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'capitalize' }}>{user?.role}</div>
          </div>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, color: 'white', flexShrink: 0 }}>
            {user?.name?.charAt(0)?.toUpperCase()}
          </div>
        </div>
        <button onClick={() => { logout(); nav('/login') }}
          style={{ background: 'rgba(255,255,255,0.07)', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, padding: '6px 12px', borderRadius: 7, transition: 'all 0.12s', fontWeight: 600 }}
          onMouseEnter={e => { e.currentTarget.style.color = '#fca5a5' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#64748b' }}>
          Sign out
        </button>
      </header>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── Greeting + Summary ── */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', letterSpacing: -0.6, margin: 0, marginBottom: 6 }}>
            Good {timeOfDay()}, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
            {activeCount === 0
              ? 'No active proposals on your plate. Check below for ones you can pick up.'
              : `You have ${activeCount} active proposal${activeCount !== 1 ? 's' : ''} to review${urgentCount > 0 ? ` — ${urgentCount} high priority` : ''}.`}
          </p>
        </div>

        {/* ── My Status Summary ── */}
        {mine.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 28, flexWrap: 'wrap' }}>
            {Object.entries(data.statusCounts || {}).filter(([, c]) => c > 0).map(([s, count]) => (
              <div key={s} style={{ padding: '10px 16px', borderRadius: 10, background: SBG[s], border: `1px solid ${SC[s]}22`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: SC[s] }}>{count}</span>
                <span style={{ fontSize: 12, color: SC[s], fontWeight: 600 }}>{SL[s]}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── My Assigned Proposals ── */}
        <Section title="My Assignments" icon="📋" count={mine.length}>
          {mine.length === 0 ? (
            <Empty>No proposals assigned to you yet. Pick one up below, or ask a manager to assign you.</Empty>
          ) : mine.map(p => <ProposalRow key={p.id} p={p} onClick={() => nav(`/proposal/${p.id}`)} />)}
        </Section>

        {/* ── Help Needed ── */}
        <Section title="Help Needed" icon="🤝" count={available.length}
          subtitle="Unassigned proposals you can pick up">
          {available.length === 0 ? (
            <Empty>All proposals are assigned. Great teamwork!</Empty>
          ) : available.map(p => (
            <ProposalRow key={p.id} p={p} onClick={() => nav(`/proposal/${p.id}`)}
              action={<ClaimBadge />} />
          ))}
        </Section>
      </div>
    </div>
  )
}

function timeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function ProposalRow({ p, onClick, action }) {
  return (
    <div onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: 'white', borderRadius: 11, cursor: 'pointer', border: '1px solid #f1f5f9', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', transition: 'all 0.15s', marginBottom: 6 }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 18px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)'; e.currentTarget.style.transform = 'none' }}>

      <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📄</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{p.name}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {p.company && <span style={{ color: '#64748b', fontWeight: 500 }}>{p.company}</span>}
          {p.location && <><span>·</span><span>📍 {p.location}</span></>}
          <span>· {relTime(p.updated_at)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {p.priority && PR[p.priority] && (
          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4, background: PR[p.priority].bg, color: PR[p.priority].color }}>
            {PR[p.priority].label}
          </span>
        )}
        <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: (SC[p.status] || '#6b7280') + '15', color: SC[p.status] || '#6b7280', border: `1px solid ${(SC[p.status] || '#6b7280')}22`, whiteSpace: 'nowrap' }}>
          {SL[p.status] || p.status}
        </span>
        {action}
      </div>
    </div>
  )
}

function ClaimBadge() {
  return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: '#eef2ff', color: '#6366f1', border: '1px solid #c7d2fe', whiteSpace: 'nowrap' }}>
      Open →
    </span>
  )
}

function Section({ title, icon, count, subtitle, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: subtitle ? 4 : 12 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>{title}</span>
        {count > 0 && <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: '#e0e7ff', color: '#4f46e5' }}>{count}</span>}
      </div>
      {subtitle && <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 12px 24px' }}>{subtitle}</p>}
      {children}
    </div>
  )
}

function Empty({ children }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 20px', background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', color: '#94a3b8', fontSize: 13 }}>
      {children}
    </div>
  )
}
