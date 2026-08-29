import { Navigate } from 'react-router-dom'
import { useRole } from '../lib/roleContext'

interface AdminRouteProps {
  children?: React.ReactNode
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { activeRole } = useRole()

  const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT', 'FINANCE']
  if (!adminRoles.includes(activeRole)) {
    return <Navigate to="/dashboard" replace />
  }

  return children ? <>{children}</> : null
}
