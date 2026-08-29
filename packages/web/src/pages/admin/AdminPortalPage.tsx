import { Link } from 'react-router-dom'
import {
  LayoutDashboard, Users, ShieldCheck, Handshake,
  Banknote, Flag, ScrollText, ArrowLeft, Settings, Percent, CalendarCheck, Wallet, Radio, Users2, CalendarDays, Layers, ShieldAlert
} from 'lucide-react'
import { RoleSwitcher } from '../../components/RoleSwitcher'

export function AdminPortalPage() {
  const sections = [
    { path: '/admin/dashboard', title: 'Dashboard', desc: 'Overview & analytics', icon: LayoutDashboard },
    { path: '/admin/users', title: 'Users', desc: 'Manage user accounts', icon: Users },
    { path: '/admin/kyc', title: 'KYC Verification', desc: 'Review identity documents', icon: ShieldCheck },
    { path: '/admin/partners', title: 'Partners', desc: 'Approve & manage partners', icon: Handshake },
    { path: '/admin/withdrawals', title: 'Withdrawals', desc: 'Review withdrawal requests', icon: Banknote },
    { path: '/admin/bookings', title: 'Bookings', desc: 'Live booking pipeline & settlements', icon: CalendarCheck },
    { path: '/admin/wallets', title: 'Wallets', desc: 'User balances & platform float', icon: Wallet },
    { path: '/admin/dispatch', title: 'Dispatch', desc: 'Live assignment monitor', icon: Radio },
    { path: '/admin/communities', title: 'Communities', desc: 'All communities & members', icon: Users2 },
    { path: '/admin/events', title: 'Events', desc: 'All events & attendance', icon: CalendarDays },
    { path: '/admin/services', title: 'Services', desc: 'Partner ecosystem & pricing', icon: Layers },
    { path: '/admin/chat-reports', title: 'Chat Reports', desc: 'Messaging safety moderation', icon: ShieldAlert },
    { path: '/admin/payments', title: 'Payment Center', desc: 'Transactions & cash stats', icon: Banknote },
    { path: '/admin/reports', title: 'Reports', desc: 'Review user reports', icon: Flag },
    { path: '/admin/audit-logs', title: 'Audit Logs', desc: 'System activity logs', icon: ScrollText },
    { path: '/admin/pricing', title: 'Pricing & Fees', desc: 'User & partner fee control', icon: Percent },
    { path: '/admin/settings', title: 'Settings', desc: 'Platform configuration', icon: Settings },
  ]

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Link to="/dashboard" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">Admin Portal</h1>
            <p className="text-gray-400 text-sm mt-1">Manage your RentBuddy platform</p>
          </div>
          {/* Switch between admin / user / partner account views */}
          <RoleSwitcher />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sections.map((s) => (
            <Link
              key={s.path}
              to={s.path}
              className="bg-gray-800 p-6 rounded-xl hover:bg-gray-700 transition group"
            >
              <div className="w-12 h-12 rounded-xl bg-gray-700 group-hover:bg-gray-600 flex items-center justify-center mb-3 transition">
                <s.icon className="w-6 h-6 text-blue-400" />
              </div>
              <h2 className="text-white font-semibold text-lg">{s.title}</h2>
              <p className="text-gray-400 text-sm mt-1">{s.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
