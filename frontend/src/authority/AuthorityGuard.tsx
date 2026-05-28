import { Navigate } from 'react-router-dom'

export default function AuthorityGuard({ children }:{children:JSX.Element}){
  const role = localStorage.getItem('roadwatch_role')
  const authId = localStorage.getItem('roadwatch_authority_id')
  if (role !== 'authority' || !authId) return <Navigate to="/auth/authority/login" replace />
  return children
}
