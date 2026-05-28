export type AppRole = 'citizen' | 'authority' | 'contractor'

export function getActiveRole(): AppRole {
  const role = localStorage.getItem('roadwatch_role')
  if (role === 'authority' || role === 'contractor' || role === 'citizen') return role
  return 'citizen'
}

export function getRoleLabel(role: AppRole) {
  if (role === 'authority') return 'Authority'
  if (role === 'contractor') return 'Contractor'
  return 'Citizen'
}
