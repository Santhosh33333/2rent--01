import { useState, useEffect, useRef, type MouseEvent } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import {
  Home, User, Wallet, Users, Sun, Moon, Menu, X, Bell,
  MapPin, LogOut, Calendar, Settings, Shield, Info, LayoutDashboard,
  ClipboardList, Search, QrCode, MoreHorizontal, Send
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ImpersonationBanner } from './ImpersonationBanner';
import { OfflineBanner } from './OfflineBanner';
import { useRole } from '../lib/roleContext';
import { useTheme } from '../lib/themeContext';
import { RoleSwitcher } from './RoleSwitcher';
import { PartnerLiveLocationSharer } from './PartnerLiveLocationSharer';
import { UserLiveLocationSharer } from './UserLiveLocationSharer';
import { api } from '../lib/api';
import { useNotifications } from '../hooks/useSocket';

/** Live unread badge for the header bell: initial fetch + realtime bumps. */
function UnreadBadge() {
  const [count, setCount] = useState(0);
  const { user } = useAuth();
  const { listenToNotifications } = useNotifications();

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    let alive = true;
    const fetchCount = async () => {
      try {
        const res = await api.get('/notifications', { params: { limit: 1 } });
        const n = res.data?.data?.unreadCount;
        if (alive && Number.isFinite(Number(n))) setCount(Number(n));
      } catch {
        /* badge stays stale rather than breaking the header */
      }
    };
    fetchCount();
    const timer = setInterval(fetchCount, 30000);
    const off = listenToNotifications(() => {
      setCount((c) => c + 1);
    });
    const onFocus = () => fetchCount();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      if (typeof off === 'function') off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user || count <= 0) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
      {count > 99 ? '99+' : count}
    </span>
  );
}

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
  { to: '/admin/upi-verification', icon: QrCode, label: 'UPI Verify' },
  { to: '/admin/live-tracking', icon: MapPin, label: 'Live' },
  { to: '/admin/email', icon: Send, label: 'Email All' },
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
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bottomNavRef = useRef<HTMLElement>(null);
  const drawerOpenerRef = useRef<HTMLElement | null>(null);

  const openDrawer = (event: MouseEvent<HTMLElement>) => {
    drawerOpenerRef.current = event.currentTarget;
    setSidebarOpen(true);
  };

  const navItems = activeRole === 'PARTNER' ? partnerNav
    : ['ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'FINANCE', 'SUPPORT_ADMIN', 'FINANCE_ADMIN', 'KYC_ADMIN', 'MARKETING_ADMIN', 'PARTNER_ADMIN'].includes(activeRole) ? adminNav
    : userNav;

  // SUPER_ADMIN-only privileges: admin-account management and audit logs sit in
  // their own nav section so they're never confused with everyday admin tasks.
  const isSuperAdmin = String(user?.role || '').toUpperCase() === 'SUPER_ADMIN' || activeRole === 'SUPER_ADMIN';
  const superAdminNav = isSuperAdmin
    ? [
        { to: '/admin/admins', icon: User, label: 'Admin Accounts' },
        { to: '/admin/audit-logs', icon: ClipboardList, label: 'Audit Logs' },
      ]
    : [];

  // On phones the bottom bar holds up to 5 slots. If the role has more items
  // (admin: 7), show the first 4 + a "More" button whose drawer holds the rest —
  // otherwise all items are shy of the 390px width. Desktop keeps all links in
  // the hamburger drawer regardless.
  const bottomNavItems = navItems.length > 5 ? navItems.slice(0, 4) : navItems;
  const hasMoreNav = navItems.length > 5;
  const drawerNavItems = hasMoreNav ? navItems.slice(4) : [];

  useEffect(() => {
    setSidebarOpen(false);
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    drawerCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const drawer = drawerRef.current;
      if (!drawer) return;
      const tabbable = Array.from(drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      if (!tabbable.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    const background = [headerRef.current, mainRef.current, bottomNavRef.current].filter(
      (element): element is HTMLElement => element !== null
    );
    const previousInert = background.map((element) => element.inert);
    document.body.style.overflow = 'hidden';
    background.forEach((element) => { element.inert = true; });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => { element.inert = previousInert[index]; });
      window.removeEventListener('keydown', onKeyDown);
      drawerOpenerRef.current?.focus();
      drawerOpenerRef.current = null;
    };
  }, [sidebarOpen]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <ImpersonationBanner />
      <OfflineBanner />
      {/* Header */}
      <header ref={headerRef} className="sticky top-0 z-50 bg-surface-50/95 dark:bg-surface-950/95 border-b border-surface-200 dark:border-surface-800 pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left */}
            <div className="flex items-center gap-3">
              <button
                onClick={openDrawer}
                className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition btn-icon lg:hidden"
                aria-label="Open menu"
                aria-expanded={sidebarOpen}
                aria-controls="sidebud-navigation-drawer"
              >
                <Menu className="w-5 h-5" />
              </button>
              <Link to="/dashboard" className="flex items-center gap-2.5">
                <img src="/images/logo-mark-3d.png" alt="Nabri logo" className="w-9 h-9 transition-transform duration-300 hover:-rotate-6 hover:scale-105" />
                <span className="text-lg font-extrabold font-display tracking-[-0.06em] text-surface-900 dark:text-surface-50 hidden sm:block">
                  NABRI
                </span>
              </Link>
            </div>

            {/* Center - Role Switcher */}
            <RoleSwitcher />

            {/* Right */}
            <div className="flex items-center gap-1 sm:gap-2">
              <Link to="/search" className="btn-icon rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition hidden sm:block" title="Search" aria-label="Search">
                <Search className="w-5 h-5" />
              </Link>
              <button
                onClick={toggleTheme}
                className="btn-icon rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition"
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun className="w-5 h-5 text-yellow-500" /> : <Moon className="w-5 h-5 text-surface-600" />}
              </button>
              <Link to="/notifications" className="btn-icon rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition relative" aria-label="Notifications">
                <Bell className="w-5 h-5" />
                <UnreadBadge />
              </Link>
              <button
                onClick={openDrawer}
                className="btn-icon rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition hidden lg:block"
                aria-label="Open profile menu"
                aria-expanded={sidebarOpen}
                aria-controls="sidebud-navigation-drawer"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-300 flex items-center justify-center text-white text-sm font-bold">
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
          <button className="drawer-scrim fixed inset-0 bg-surface-900/55 dark:bg-black/65 z-50 cursor-default" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />
          <aside id="sidebud-navigation-drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Navigation menu" className="navigation-drawer fixed inset-y-0 left-0 w-80 max-w-[88vw] bg-surface-50 dark:bg-surface-900 z-50 shadow-2xl p-4 overflow-y-auto overscroll-contain pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-accent-300 flex items-center justify-center text-white font-bold">
                  {user?.name?.charAt(0) || 'U'}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{user?.name}</p>
                  <p className="text-xs text-surface-500 truncate">{user?.email}</p>
                </div>
              </div>
              <button ref={drawerCloseRef} onClick={() => setSidebarOpen(false)} className="btn-icon rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" aria-label="Close menu">
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="space-y-1">
              {drawerNavItems.length > 0 && (
                <>
                  <p className="px-3 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-surface-400">Menu</p>
                  {drawerNavItems.map(({ to, icon: Icon, label }) => (
                    <Link
                      key={to}
                      to={to}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition ${
                      location.pathname === to
                        ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200 font-semibold'
                          : 'text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </Link>
                  ))}
                  <div className="h-px bg-surface-200 dark:bg-surface-800 my-2" />
                </>
              )}
              {superAdminNav.length > 0 && (
                <>
                  <p className="px-3 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-300">Super Admin</p>
                  {superAdminNav.map(({ to, icon: Icon, label }) => (
                    <Link
                      key={to}
                      to={to}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition ${
                        location.pathname === to
                          ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200 font-semibold'
                          : 'text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-medium">SUPER</span>
                    </Link>
                  ))}
                  <div className="h-px bg-surface-200 dark:bg-surface-800 my-2" />
                </>
              )}
              {sidebarLinks.map(({ to, icon: Icon, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition ${
                    location.pathname === to
                          ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200 font-semibold'
                      : 'text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              ))}
            </nav>

            <hr className="my-4 border-surface-200 dark:border-surface-800" />

            <button
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </aside>
        </>
      )}

      {/* Main Content */}
      <main ref={mainRef} className="pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-8">
        {/* Partners silently stream live GPS for their active booking so the
            user can track them in real time (no UI of its own). */}
        <PartnerLiveLocationSharer />
        <UserLiveLocationSharer />
        <div key={location.pathname} className="route-content max-w-7xl mx-auto px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav ref={bottomNavRef} aria-label="Primary navigation" className="fixed bottom-0 inset-x-0 bg-white dark:bg-surface-950 border-t border-surface-200 dark:border-surface-800 z-40 lg:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-around h-16 px-2 max-w-xl mx-auto">
          {bottomNavItems.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
            return (
              <Link
                key={to}
                to={to}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-2xl transition-all min-w-0 flex-1 py-1 ${
                  isActive
                    ? 'bottom-nav-active text-primary-700 dark:text-primary-300 bg-primary-500/10 dark:bg-primary-500/15'
                    : 'text-surface-400 dark:text-surface-500'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-semibold leading-none">{label}</span>
              </Link>
            );
          })}
          {hasMoreNav && (
            <button
              onClick={openDrawer}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl transition-all min-w-0 flex-1 text-surface-400 dark:text-surface-500`}
              aria-label="More menu"
            >
              <div className="p-1 rounded-xl">
                <MoreHorizontal className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-semibold leading-none">More</span>
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}
