import { useState, useEffect } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import {
  Home, User, Wallet, Users, Sun, Moon, Menu, X, Bell,
  MapPin, LogOut, Calendar, Settings, Shield, Info, LayoutDashboard,
  ClipboardList, Search
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { isClerkConfigured } from '../lib/clerkAuth';
import { UserButton, useUser } from '@clerk/clerk-react';

function ClerkUserButton() {
  const { isSignedIn } = useUser();
  if (!isSignedIn) return null;
  return (
    <div className="px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Clerk account</p>
      <UserButton afterSignOutUrl="/account-type" />
    </div>
  );
}
import { useRole } from '../lib/roleContext';
import { useTheme } from '../lib/themeContext';
import { RoleSwitcher } from './RoleSwitcher';
import { PartnerLiveLocationSharer } from './PartnerLiveLocationSharer';
import { UserLiveLocationSharer } from './UserLiveLocationSharer';

const userNav = [
  { to: '/home', icon: Home, label: 'Home' },
  { to: '/discover', icon: Search, label: 'Discover' },
  { to: '/bookings', icon: Calendar, label: 'Bookings' },
  { to: '/communities', icon: Users, label: 'Social' },
  { to: '/profile', icon: User, label: 'Profile' },
];

const partnerNav = [
  { to: '/partner/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/partner/jobs', icon: ClipboardList, label: 'Jobs' },
  { to: '/partner/map', icon: MapPin, label: 'Map' },
  { to: '/partner/wallet', icon: Wallet, label: 'Wallet' },
  { to: '/partner/profile', icon: User, label: 'Profile' },
];

const adminNav = [
  { to: '/admin/dashboard', icon: Shield, label: 'Dashboard' },
  { to: '/admin/users', icon: Users, label: 'Users' },
  { to: '/admin/partners', icon: Users, label: 'Partners' },
  { to: '/admin/payments', icon: Wallet, label: 'Payments' },
  { to: '/admin/live-tracking', icon: MapPin, label: 'Live' },
  { to: '/admin/reports', icon: Shield, label: 'Reports' },
];

const sidebarLinks = [
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/notifications', icon: Bell, label: 'Notifications' },
  { to: '/settings/privacy', icon: Shield, label: 'Privacy' },
  { to: '/home', icon: Info, label: 'About' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { activeRole } = useRole();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [, setMobileMenuOpen] = useState(false);

  const navItems = activeRole === 'PARTNER' ? partnerNav
    : ['ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'FINANCE'].includes(activeRole) ? adminNav
    : userNav;

  useEffect(() => {
    setSidebarOpen(false);
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-violet-50/20 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-gray-950/80 border-b border-gray-200/50 dark:border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition lg:hidden"
              >
                <Menu className="w-5 h-5" />
              </button>
              <Link to="/dashboard" className="flex items-center gap-2.5">
                <img src="/logo-mark.svg" alt="RentBuddy logo" className="w-9 h-9 rounded-xl shadow-md shadow-primary-500/25" />
                <span className="text-lg font-extrabold font-display tracking-tight bg-gradient-to-r from-indigo-600 via-violet-600 to-pink-500 bg-clip-text text-transparent hidden sm:block">
                  RentBuddy
                </span>
              </Link>
            </div>

            {/* Center - Role Switcher */}
            <RoleSwitcher />

            {/* Right */}
            <div className="flex items-center gap-2">
              <Link to="/search" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition hidden sm:block" title="Search">
                <Search className="w-5 h-5" />
              </Link>
              <button
                onClick={toggleTheme}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              >
                {theme === 'dark' ? <Sun className="w-5 h-5 text-yellow-500" /> : <Moon className="w-5 h-5 text-gray-600" />}
              </button>
              <Link to="/notifications" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition relative">
                <Bell className="w-5 h-5" />
              </Link>
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition hidden lg:block"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold">
                  {user?.name?.charAt(0) || 'U'}
                </div>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50 lg:hidden" onClick={() => setSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 w-72 bg-white dark:bg-gray-900 z-50 shadow-2xl p-4 overflow-y-auto animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-bold">
                  {user?.name?.charAt(0) || 'U'}
                </div>
                <div>
                  <p className="font-semibold text-sm">{user?.name}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="space-y-1">
              {sidebarLinks.map(({ to, icon: Icon, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                    location.pathname === to
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              ))}
            </nav>

            <hr className="my-4 border-gray-200 dark:border-gray-800" />

            <button
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>

            {isClerkConfigured() && <ClerkUserButton />}
          </div>
        </>
      )}

      {/* Main Content */}
      <main className="pb-20 lg:pb-4">
        {/* Partners silently stream live GPS for their active booking so the
            user can track them in real time (no UI of its own). */}
        <PartnerLiveLocationSharer />
        <UserLiveLocationSharer />
        <Outlet />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 inset-x-0 bg-white/90 dark:bg-gray-950/90 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 z-40 lg:hidden">
        <div className="flex items-center justify-around h-16 px-2">
          {navItems.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to || location.pathname.startsWith(to.split('/').slice(0, -1).join('/') + '/');
            return (
              <Link
                key={to}
                to={to}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all min-w-[60px] ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                <div className={`p-1 rounded-xl transition ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
