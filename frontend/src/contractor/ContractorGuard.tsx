import { Navigate } from 'react-router-dom'

export default function ContractorGuard({ children }:{children:JSX.Element}){
  const role = localStorage.getItem('roadwatch_role')
  const contractorId = localStorage.getItem('roadwatch_contractor_id')
  if (role !== 'contractor' || !contractorId) return <Navigate to="/auth/contractor/login" replace />
  return children
}
