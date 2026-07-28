import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useApiFetch } from '../context/AuthContext'

const formatDate = value => new Date(value).toLocaleString()

export default function Profile() {
  const nav = useNavigate()
  const { user, logout } = useAuth()
  const apiFetch = useApiFetch()
  const [usage, setUsage] = useState(null)
  const [company, setCompany] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const response = await apiFetch('/api/profile/usage')
      if (!response.ok) throw new Error('Usage information could not be loaded')
      setUsage(await response.json())
      const companyResponse = await apiFetch('/api/company')
      if (companyResponse.ok) setCompany(await companyResponse.json())
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [])

  const invite = async e => {
    e.preventDefault()
    setInviteMessage('')
    const response = await apiFetch('/api/company/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail }) })
    const data = await response.json()
    if (!response.ok) return setInviteMessage(data.error || 'Invite failed')
    const link = `${window.location.origin}/login?invite=${data.inviteToken}&email=${encodeURIComponent(inviteEmail)}`
    try { await navigator.clipboard.writeText(link); setInviteMessage('Invitation created. Signup link copied to your clipboard.') }
    catch { setInviteMessage(`Invitation created: ${link}`) }
    setInviteEmail(''); load()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <header style={{ height: 60, padding: '0 24px', background: '#0f172a', display: 'flex', alignItems: 'center', gap: 14, color: 'white', boxShadow: '0 4px 20px rgba(0,0,0,0.35)' }}>
        <button onClick={() => nav('/')} style={headerButton}>←</button>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,.1)' }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Profile & Usage</div>
          <div style={{ fontSize: 10, color: '#818cf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8 }}>Your account activity</div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={load} style={headerButton}>↻ Refresh</button>
        <button onClick={() => { logout(); nav('/login') }} style={headerButton}>Sign out</button>
      </header>

      <main style={{ maxWidth: 980, margin: '0 auto', padding: '32px 24px' }}>
        <section style={{ ...card, display: 'flex', alignItems: 'center', gap: 18, marginBottom: 20 }}>
          <div style={{ width: 58, height: 58, borderRadius: '50%', background: 'linear-gradient(135deg,#4f46e5,#818cf8)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900 }}>
            {user?.name?.charAt(0)?.toUpperCase()}
          </div>
          <div>
            <h1 style={{ fontSize: 21, color: '#0f172a', marginBottom: 4 }}>{user?.name}</h1>
            <div style={{ color: '#64748b', fontSize: 13 }}>{user?.email}</div>
            <div style={{ color: '#6366f1', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', marginTop: 5 }}>{user?.role}</div>
          </div>
        </section>

        <section style={{ ...card, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ ...sectionTitle, fontSize: 16 }}>{company?.company?.name || user?.companyName || 'Your company'}</h2>
              <div style={{ fontSize: 12, color: '#64748b' }}>Contracts and reviews are shared only with members of this company.</div>
            </div>
            {user?.role === 'manager' && (
              <form onSubmit={invite} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="engineer@company.com" style={{ padding: '9px 11px', minWidth: 220, border: '1px solid #cbd5e1', borderRadius: 8 }} />
                <button style={{ border: 0, borderRadius: 8, background: '#4f46e5', color: 'white', padding: '9px 14px', fontWeight: 700, cursor: 'pointer' }}>Invite member</button>
              </form>
            )}
          </div>
          {inviteMessage && <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#eef2ff', color: '#4338ca', fontSize: 12, overflowWrap: 'anywhere' }}>{inviteMessage}</div>}
          {company?.members?.length > 0 && <div style={{ marginTop: 18, display: 'grid', gap: 8 }}>
            {company.members.map(member => <div key={member.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: '1px solid #f1f5f9', fontSize: 12 }}><span><b>{member.name}</b> <span style={{ color: '#64748b' }}>· {member.email}</span></span><span style={{ color: '#6366f1', fontWeight: 700 }}>{member.role}</span></div>)}
            {company.invites.map(item => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: '1px solid #f1f5f9', fontSize: 12, color: '#64748b' }}><span>{item.email}</span><span>Invite pending</span></div>)}
          </div>}
        </section>

        {error && <div style={{ ...card, color: '#b91c1c', marginBottom: 20 }}>{error}</div>}
        {!usage && !error && <div style={{ ...card, color: '#64748b' }}>Loading usage…</div>}

        {usage && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
              <UsageCard label="Today" data={usage.today} />
              <UsageCard label="Last 7 days" data={usage.last7Days} />
              <UsageCard label="Last 30 days" data={usage.last30Days} />
              <UsageCard label="All time" data={usage.totals} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20 }}>
              <section style={card}>
                <h2 style={sectionTitle}>Most-used API endpoints</h2>
                {usage.topEndpoints.length === 0 ? <Empty /> : usage.topEndpoints.map(item => (
                  <div key={item.endpoint} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <code style={{ fontSize: 11, color: '#475569', overflowWrap: 'anywhere' }}>{item.endpoint}</code>
                    <strong style={{ color: '#4f46e5', fontSize: 13 }}>{item.count}</strong>
                  </div>
                ))}
              </section>

              <section style={card}>
                <h2 style={sectionTitle}>Recent requests</h2>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr>{['Time', 'Request', 'Status', 'Duration'].map(label => <th key={label} style={th}>{label}</th>)}</tr></thead>
                    <tbody>
                      {usage.recent.map((item, index) => (
                        <tr key={`${item.timestamp}-${index}`}>
                          <td style={td}>{formatDate(item.timestamp)}</td>
                          <td style={td}><code>{item.method} {item.path}</code>{item.isAiRequest && <span style={aiBadge}>AI</span>}</td>
                          <td style={{ ...td, color: item.status >= 400 ? '#dc2626' : '#16a34a', fontWeight: 800 }}>{item.status}</td>
                          <td style={td}>{item.durationMs} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {usage.recent.length === 0 && <Empty />}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function UsageCard({ label, data }) {
  return (
    <section style={card}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: .7 }}>{label}</div>
      <div style={{ fontSize: 34, color: '#0f172a', fontWeight: 900, margin: '9px 0 7px' }}>{data.requests}</div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b' }}>
        <span><b style={{ color: '#7c3aed' }}>{data.aiRequests}</b> AI</span>
        <span><b style={{ color: data.errors ? '#dc2626' : '#16a34a' }}>{data.errors}</b> errors</span>
      </div>
    </section>
  )
}

function Empty() { return <div style={{ padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>No usage recorded yet.</div> }

const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,.05)' }
const sectionTitle = { fontSize: 14, color: '#0f172a', marginBottom: 12 }
const headerButton = { background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.08)', color: '#cbd5e1', cursor: 'pointer', padding: '7px 11px', borderRadius: 7, fontWeight: 600 }
const th = { padding: '8px', textAlign: 'left', color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' }
const td = { padding: '9px 8px', color: '#475569', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }
const aiBadge = { marginLeft: 6, padding: '2px 5px', borderRadius: 4, background: '#f3e8ff', color: '#7e22ce', fontSize: 9, fontWeight: 900 }
