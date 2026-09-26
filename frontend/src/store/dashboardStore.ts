import { create } from 'zustand'
import type { AuthorityLevel, DashboardRole } from '../data/roadwatchDashboard'

type DashboardState = {
  role: DashboardRole
  darkMode: boolean
  jurisdiction: string
  authorityLevel: AuthorityLevel
  chatOpen: boolean
  setRole: (role: DashboardRole) => void
  setDarkMode: (value: boolean) => void
  setJurisdiction: (value: string) => void
  setAuthorityLevel: (value: AuthorityLevel) => void
  setChatOpen: (value: boolean) => void
}

const storedRole = localStorage.getItem('roadwatch_role')
const storedJurisdiction = localStorage.getItem('roadwatch_dashboard_jurisdiction') || 'All districts'
const storedDarkMode = localStorage.getItem('roadwatch_dark_mode') === 'true'

// Validate the persisted level rather than casting it: an unknown value (older
// build, hand-edited storage) used to flow straight into jurisdiction scoping,
// which silently widened or emptied the complaint queue.
const AUTHORITY_LEVELS: AuthorityLevel[] = ['junior-engineer', 'district-officer', 'chief-engineer']
const storedAuthorityLevelRaw = localStorage.getItem('roadwatch_authority_level')
const storedAuthorityLevel = AUTHORITY_LEVELS.includes(storedAuthorityLevelRaw as AuthorityLevel)
  ? (storedAuthorityLevelRaw as AuthorityLevel)
  : null

export const useDashboardStore = create<DashboardState>((set) => ({
  role:
    storedRole === 'authority' || storedRole === 'contractor' || storedRole === 'citizen' || storedRole === 'super-admin'
      ? storedRole
      : 'citizen',
  darkMode: storedDarkMode,
  jurisdiction: storedJurisdiction,
  authorityLevel: storedAuthorityLevel ?? 'district-officer',
  chatOpen: true,
  setRole: (role) => {
    localStorage.setItem('roadwatch_role', role)
    set({ role })
  },
  setDarkMode: (value) => {
    localStorage.setItem('roadwatch_dark_mode', String(value))
    set({ darkMode: value })
  },
  setJurisdiction: (jurisdiction) => {
    localStorage.setItem('roadwatch_dashboard_jurisdiction', jurisdiction)
    set({ jurisdiction })
  },
  setAuthorityLevel: (authorityLevel) => {
    localStorage.setItem('roadwatch_authority_level', authorityLevel)
    set({ authorityLevel })
  },
  setChatOpen: (chatOpen) => set({ chatOpen }),
}))
