import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import List from './pages/List'
import Viewer from './pages/Viewer'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import MyWork from './pages/MyWork'
import Profile from './pages/Profile'
import Standards from './pages/Standards'
import SourceAdmin from './pages/SourceAdmin'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import AiReview from './pages/AiReview'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
      <div className="spin" style={{ fontSize: 28, color: '#6366f1' }}>⟳</div>
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? <Navigate to="/" replace /> : children
}

function LegacyComplianceRedirect() {
  const { id } = useParams()
  return <Navigate to={`/proposal/${id}/ai-review#controlling-standards`} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<RequireAuth><List /></RequireAuth>} />
          <Route path="/proposal/:id" element={<RequireAuth><Viewer /></RequireAuth>} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/my-work" element={<RequireAuth><MyWork /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/standards" element={<RequireAuth><Standards /></RequireAuth>} />
          <Route path="/proposal/:id/compliance" element={<RequireAuth><LegacyComplianceRedirect /></RequireAuth>} />
          <Route path="/proposal/:id/ai-review" element={<RequireAuth><AiReview /></RequireAuth>} />
          <Route path="/admin/sources" element={<RequireAuth><SourceAdmin /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
