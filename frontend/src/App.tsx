import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AgentChatAuthority from './authority/AgentChatAuthority'
import Analytics from './authority/Analytics'
import AssignInspector from './authority/AssignInspector'
import AuthorityComplaintDetail from './authority/ComplaintDetail'
import DistrictReport from './authority/DistrictReport'
import Notifications from './authority/Notifications'
import PerformanceEvaluation from './authority/PerformanceEvaluation'
import RepairProofWizard from './authority/RepairProofWizard'
import RoadProfileAdmin from './authority/RoadProfileAdmin'
import FloatingAssistant from './components/FloatingAssistant'
import HeaderClean from './components/HeaderClean'
import OfflineBanner from './components/OfflineBanner'
import { AuthorityGuard, CitizenGuard, ContractorGuard } from './components/ProtectedRoute'
import AgentChatContractor from './contractor/AgentChatContractor'
import ContractorComplaintDetail from './contractor/ComplaintDetail'
import ComplaintsOnMyRoads from './contractor/ComplaintsOnMyRoads'
import DocumentVault from './contractor/DocumentVault'
import ProgressProofUpload from './contractor/ProgressProofUpload'
import ContractorProjectDetail from './contractor/ProjectDetail'
import AgentChat from './pages/AgentChat'
import BudgetHistory from './pages/BudgetHistory'
import ComplaintDetail from './pages/ComplaintDetail'
import ComplaintWizard from './pages/ComplaintWizard'
import AuthorityDashboard from './pages/dashboard/AuthorityDashboard'
import CitizenDashboard from './pages/dashboard/CitizenDashboard'
import ContractorDashboard from './pages/dashboard/ContractorDashboard'
import SuperAdminDashboard from './pages/dashboard/SuperAdminDashboard'
import Escalation from './pages/Escalation'
import MediaUpload from './pages/MediaUpload'
import MyComplaints from './pages/MyComplaints'
import MapView from './pages/MapView'
import Onboarding from './pages/Onboarding'
import ProofVerification from './pages/ProofVerification'
import RoadHistory from './pages/RoadHistory'
import RoadProfile from './pages/RoadProfile'
import Settings from './pages/Settings'
import SyncStatus from './pages/SyncStatus'
// New auth pages
import AuthHub from './components/AuthHub'
import AuthorityLogin from './pages/auth/AuthorityLogin'
import AuthoritySignup from './pages/auth/AuthoritySignup'
import CitizenLogin from './pages/auth/CitizenLogin'
import CitizenSignup from './pages/auth/CitizenSignup'
import ContractorLogin from './pages/auth/ContractorLogin'
import ContractorSignup from './pages/auth/ContractorSignup'

export default function App() {
  return (
    <BrowserRouter>
      <OfflineBanner />
      <FloatingAssistant />
      <HeaderClean />
      <Routes>
        {/* Public Dashboard - No Login Required */}
        <Route path="/" element={<CitizenDashboard />} />
        <Route path="/dashboard" element={<CitizenDashboard />} />
        <Route path="/dashboard/citizen" element={<CitizenDashboard />} />
        <Route path="/map" element={<MapView />} />
        <Route path="/community-map" element={<MapView />} />
        <Route path="/road/:id" element={<RoadProfile />} />
        <Route path="/road/:id/history" element={<RoadHistory />} />

        {/* Canonical auth routes */}
        <Route path="/auth/citizen/login" element={<CitizenLogin />} />
        <Route path="/auth/citizen/signup" element={<CitizenSignup />} />
        <Route path="/auth/authority/login" element={<AuthorityLogin />} />
        <Route path="/auth/authority/signup" element={<AuthoritySignup />} />
        <Route path="/auth/contractor/login" element={<ContractorLogin />} />
        <Route path="/auth/contractor/signup" element={<ContractorSignup />} />

        {/* Backward-compatible auth redirects */}
        <Route path="/login" element={<AuthHub />} />
        <Route path="/signup" element={<Navigate to="/login" replace />} />
        <Route path="/citizen/login" element={<Navigate to="/auth/citizen/login" replace />} />
        <Route path="/citizen/signup" element={<Navigate to="/auth/citizen/signup" replace />} />
        <Route path="/authority/login" element={<Navigate to="/auth/authority/login" replace />} />
        <Route path="/authority/signup" element={<Navigate to="/auth/authority/signup" replace />} />
        <Route path="/contractor/login" element={<Navigate to="/auth/contractor/login" replace />} />
        <Route path="/contractor/signup" element={<Navigate to="/auth/contractor/signup" replace />} />

        {/* Protected Citizen Routes */}
        <Route path="/road/:id/report" element={<CitizenGuard><ComplaintWizard /></CitizenGuard>} />
        <Route path="/road/:id/chat" element={<CitizenGuard><AgentChat /></CitizenGuard>} />
        <Route path="/complaints" element={<CitizenGuard><MyComplaints /></CitizenGuard>} />
        <Route path="/complaints/:id" element={<CitizenGuard><ComplaintDetail /></CitizenGuard>} />
        <Route path="/complaints/:id/verify" element={<CitizenGuard><ProofVerification /></CitizenGuard>} />
        <Route path="/escalate/:id" element={<CitizenGuard><Escalation /></CitizenGuard>} />
        <Route path="/budget/:id" element={<CitizenGuard><BudgetHistory /></CitizenGuard>} />
        <Route path="/settings" element={<CitizenGuard><Settings /></CitizenGuard>} />
        <Route path="/sync-status" element={<CitizenGuard><SyncStatus /></CitizenGuard>} />
        <Route path="/onboarding" element={<CitizenGuard><Onboarding /></CitizenGuard>} />

        {/* Protected Authority Routes */}
        <Route path="/dashboard/authority" element={<AuthorityGuard><AuthorityDashboard /></AuthorityGuard>} />
        <Route path="/authority" element={<AuthorityGuard><Navigate to="/dashboard/authority" replace /></AuthorityGuard>} />
        <Route path="/authority/complaint/:id" element={<AuthorityGuard><AuthorityComplaintDetail /></AuthorityGuard>} />
        <Route path="/authority/assign/:id" element={<AuthorityGuard><AssignInspector /></AuthorityGuard>} />
        <Route path="/authority/repair/:id" element={<AuthorityGuard><RepairProofWizard /></AuthorityGuard>} />
        <Route path="/authority/analytics" element={<AuthorityGuard><Analytics /></AuthorityGuard>} />
        <Route path="/authority/report" element={<AuthorityGuard><DistrictReport /></AuthorityGuard>} />
        <Route path="/authority/budget/:id" element={<AuthorityGuard><BudgetHistory /></AuthorityGuard>} />
        <Route path="/authority/road/:id" element={<AuthorityGuard><RoadProfileAdmin /></AuthorityGuard>} />
        <Route path="/authority/chat" element={<AuthorityGuard><AgentChatAuthority /></AuthorityGuard>} />
        <Route path="/authority/notifications" element={<AuthorityGuard><Notifications /></AuthorityGuard>} />
        <Route path="/authority/performance" element={<AuthorityGuard><PerformanceEvaluation /></AuthorityGuard>} />

        {/* Protected Contractor Routes */}
        <Route path="/dashboard/contractor" element={<ContractorGuard><ContractorDashboard /></ContractorGuard>} />
        <Route path="/contractor" element={<ContractorGuard><Navigate to="/dashboard/contractor" replace /></ContractorGuard>} />
        <Route path="/contractor/project/:id" element={<ContractorGuard><ContractorProjectDetail /></ContractorGuard>} />
        <Route path="/contractor/proof/:id" element={<ContractorGuard><ProgressProofUpload /></ContractorGuard>} />
        <Route path="/contractor/complaints" element={<ContractorGuard><ComplaintsOnMyRoads /></ContractorGuard>} />
        <Route path="/contractor/complaint/:id" element={<ContractorGuard><ContractorComplaintDetail /></ContractorGuard>} />
        <Route path="/contractor/chat" element={<ContractorGuard><AgentChatContractor /></ContractorGuard>} />
        <Route path="/contractor/vault" element={<ContractorGuard><DocumentVault /></ContractorGuard>} />

        {/* Super Admin */}
        <Route path="/upload" element={<MediaUpload />} />
        <Route path="/dashboard/super-admin" element={<SuperAdminDashboard />} />
        <Route path="/super-admin" element={<Navigate to="/dashboard/super-admin" replace />} />
        
        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

