import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import EmailList from './pages/EmailList'
import EmailDetail from './pages/EmailDetail'
import Labels from './pages/Labels'
import ForwardingRules from './pages/ForwardingRules'
import Accounts from './pages/Accounts'
import Users from './pages/Users'
import CsvManagement from './pages/CsvManagement'
import DocumentAnalyzer from './pages/DocumentAnalyzer'
import ReplyTemplates from './pages/ReplyTemplates'

function ProtectedLayout() {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">読み込み中...</div>
  if (!user) return <Navigate to="/login" replace />
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/emails" element={<EmailList />} />
          <Route path="/emails/:id" element={<EmailDetail />} />
          <Route path="/labels" element={<Labels />} />
          <Route path="/forwarding" element={<ForwardingRules />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/users" element={<Users />} />
          <Route path="/csv" element={<CsvManagement />} />
          <Route path="/documents" element={<DocumentAnalyzer />} />
          <Route path="/reply-templates" element={<ReplyTemplates />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  )
}
