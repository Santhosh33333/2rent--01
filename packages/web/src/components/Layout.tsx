import { useState, useEffect, type MouseEvent } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { 
  Home, User, Wallet, Users, Sun, Moon, Menu, X, Bell, 
  MapPin, LogOut, Calendar, Settings, Shield, Info, LayoutDashboard, 
  ClipboardList, Search, QrCode, Send, LifeBuoy 
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ImpersonationBanner } from './ImpersonationBanner';
import { OfflineBanner } from './OfflineBanner';
import { useRole } from '../lib/roleContext';
import { isAdminTierRole, isSuperAdminRole } from '../lib/roles';
import { useTheme } from '../lib/themeContext';
import { RoleSwitcher } from './RoleSwitcher';
import { Avatar } from './Avatar';
import { PartnerLiveLocationSharer } from './PartnerLiveLocationSharer';
import { UserLiveLocationSharer } from './UserLiveLocationSharer';
import { api } from '../lib/api';
import { useNotifications } from '../hooks/useSocket';
import { 
  destroyBanner, isNative, maybeShowInterstitial, 
  prepareInterstitial, showBanner, subscribeAdsState 
} from '../lib/ads';
import { motion, AnimatePresence } from 'motion/react';
import { ReConsentBanner } from './legal/ReConsentBanner';
import { AppTabBar } from './navigation/AppTabBar';
import { MoreSheet } from './navigation/MoreSheet';
import { AgentLauncher } from './agent/AgentLauncher';
import { NavGroupList, groupsForRole } from './navigation/NavGroupList';

function UnreadBadge() {
  const [count, setCount] = useState(0);
  const { user } = useAuth();
  const { listenToNotifications } = useNotifications();

  useEffect(() => {
    if (!user) { setCount(0); return; }
    let alive = true;
    const fetchCount = async () => {
      try {
        const res = await api.get('/notifications', { params: { limit: 1 } });
        const n = res.data?.data?.unreadCount;
        if (alive && Number.isFinite(Number(n))) setCount(Number(n));
      } catch { }
    };
    fetchCount();
    const timer = setInterval(fetchCount, 30000);
    const off = listenToNotifications(() => { setCount((c) => c + 1); });
    const onFocus = () => fetchCount();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      if (typeof off === 'function') off();
    };
  }, [user?.id]);

  if (!user || count <= 0) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-lg shadow-red-500/40">
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
  { to: '/admin/support', icon: LifeBuoy, label: 'Support' },
];

const sidebarLinks = [
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/notifications', icon: Bell, label: 'Notifications' },
  { to: '/support', icon: LifeBuoy, label: 'Help & support' },
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [adsReady, setAdsReady] = useState(false);
  const [bannerUp, setBannerUp] = useState(false);

  const navItems = activeRole === 'PARTNER' ? partnerNav
    : isAdminTierRole(activeRole) ? adminNav
    : userNav;

  const isSuperAdmin = isSuperAdminRole(user?.role) || activeRole === 'SUPER_ADMIN';
  const superAdminNav = isSuperAdmin
    ? [
        { to: '/admin/admins', icon: User, label: 'Admin Accounts' },
        { to: '/admin/audit-logs', icon: ClipboardList, label: 'Audit Logs' },
      ] : [];

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);
  useEffect(() => subscribeAdsState((state) => setAdsReady(state.canRequestAds)), []);

  useEffect(() => {
    if (!adsReady || !isNative()) return;
    let cancelled = false;
    const sync = async () => {
      const wide = window.matchMedia('(min-width: 1024px)').matches;
      if (cancelled) return;
      if (wide) { await showBanner(); if (!cancelled) setBannerUp(true); }
      else if (bannerUp) { await destroyBanner(); if (!cancelled) setBannerUp(false); }
    };
    void sync();
    const mq = window.matchMedia('(min-width: 1024px)');
    mq.addEventListener('change', () => void sync());
    return () => { cancelled = true; mq.removeEventListener('change', () => void sync()); setBannerUp(false); void destroyBanner(); };
  }, [adsReady]);

  useEffect(() => {
    if (!adsReady) return;
    void prepareInterstitial();
  }, [adsReady]);

  useEffect(() => {
    if (!adsReady) return;
    const path = location.pathname;
    const segment = `/${path.split('/').filter(Boolean)[0] ?? ''}`;
    const safe = new Set(['/home', '/bookings', '/discover', '/communities', '/partner/dashboard', '/partner/jobs']);
    if (!safe.has(segment)) return;
    const timer = window.setTimeout(() => void maybeShowInterstitial(), 2500);
    return () => window.clearTimeout(timer);
  }, [adsReady, location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 transition-colors duration-500">
      <ImpersonationBanner />
      <OfflineBanner />

      {/* Floating Header Capsule */}
      <header className="fixed top-0 inset-x-0 z-50 px-4 pt-4 pointer-events-none">
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="max-w-7xl mx-auto h-16 px-3 rounded-3xl bg-surface-50/60 dark:bg-surface-900/60 backdrop-blur-2xl border border-surface-200/50 dark:border-surface-800/50 shadow-xl shadow-black/5 pointer-events-auto flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors lg:hidden"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link to="/dashboard" className="flex items-center gap-2 pl-1 shrink-0" aria-label="Nabri home">
              <span className="brand-badge h-8 w-8">
                <img src="/logo-glyph-white.svg" alt="" className="h-5 w-5" />
              </span>
              {/* Was `hidden sm:block`, which hid the wordmark below 640px in BOTH
                  themes. That read as "the app name disappears in dark mode",
                  because dark mode is mostly checked on a phone - but the color
                  was always correct (light in dark mode, verified in a browser).
                  Now it shrinks to a smaller size on narrow screens instead of
                  vanishing, since the header row genuinely has room for it. */}
              <span className="block text-base sm:text-lg font-black font-display tracking-tight text-surface-900 dark:text-surface-50">
                Nabri<span className="text-primary-500">.</span>
              </span>
            </Link>
          </div>

          <RoleSwitcher />

          <div className="flex items-center gap-1 sm:gap-2">
            <Link to="/search" className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition hidden sm:block">
              <Search className="w-5 h-5" />
            </Link>
            <button onClick={toggleTheme} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition">
              {theme === 'dark' ? <Sun className="w-5 h-5 text-yellow-500" /> : <Moon className="w-5 h-5 text-surface-600" />}
            </button>
            <Link
              to="/wallet"
              aria-label="Wallet"
              className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition"
            >
              <Wallet className="w-5 h-5" />
            </Link>
            <Link to="/notifications" className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition relative">
              <Bell className="w-5 h-5" />
              <UnreadBadge />
            </Link>
            <button onClick={() => setSidebarOpen(true)} className="hidden lg:block p-1 rounded-full hover:scale-110 transition">
              <Avatar src={user?.avatarUrl} name={user?.name} className="w-8 h-8" />
            </button>
          </div>
        </motion.div>
      </header>

      {/* Kinetic Sidebar Drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          >
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 20, stiffness: 150 }}
              className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-surface-50 dark:bg-surface-900 shadow-2xl p-6 flex flex-col overflow-hidden"
              onClick={(e: MouseEvent) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <Avatar src={user?.avatarUrl} name={user?.name} className="w-12 h-12" />
                  <div>
                    <p className="font-bold text-surface-900 dark:text-white">{user?.name}</p>
                    <p className="text-xs text-surface-500 truncate w-32">{user?.email}</p>
                  </div>
                </div>
                <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* min-h-0 + overflow-y-auto: without it the flex child never
                  shrinks, long nav lists overflow, and the Sign Out button is
                  pushed off-screen where it cannot be scrolled to. */}
              <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-6 pr-1 -mr-2">
                {/* Admins keep their own console list; everyone else renders the
                    same shared groups as the More sheet, so the drawer and the
                    dock cannot teach different navigation. */}
                {isAdminTierRole(activeRole) ? (
                  <>
                    <div>
                      <p className="px-3 text-[10px] font-black uppercase tracking-widest text-surface-400 mb-3">Main Menu</p>
                      <div className="space-y-1">
                        {navItems.map(({ to, icon: Icon, label }) => (
                          <Link
                            key={to} to={to}
                            className={`flex items-center gap-3 px-3 py-3 rounded-2xl text-sm transition-all ${location.pathname === to ? 'bg-primary-500 text-white shadow-md shadow-primary-500/20' : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
                          >
                            <Icon className="w-4 h-4" /> {label}
                          </Link>
                        ))}
                      </div>
                    </div>

                    {superAdminNav.length > 0 && (
                      <div>
                        <p className="px-3 text-[10px] font-black uppercase tracking-widest text-primary-500 mb-3">Super Admin</p>
                        <div className="space-y-1">
                          {superAdminNav.map(({ to, icon: Icon, label }) => (
                            <Link
                              key={to} to={to}
                              className={`flex items-center gap-3 px-3 py-3 rounded-2xl text-sm transition-all ${location.pathname === to ? 'bg-primary-500 text-white shadow-md shadow-primary-500/20' : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
                            >
                              <Icon className="w-4 h-4" /> {label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <NavGroupList
                    groups={groupsForRole(activeRole)}
                    onNavigate={() => setSidebarOpen(false)}
                    variant="drawer"
                  />
                )}

                <div>
                  <p className="px-3 text-[10px] font-black uppercase tracking-widest text-surface-400 mb-3">System</p>
                  <div className="space-y-1">
                    {sidebarLinks.map(({ to, icon: Icon, label }) => (
                      <Link
                        key={to} to={to}
                        className={`flex items-center gap-3 px-3 py-3 rounded-2xl text-sm transition-all ${location.pathname === to ? 'bg-primary-500 text-white shadow-md shadow-primary-500/20' : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
                      >
                        <Icon className="w-4 h-4" /> {label}
                      </Link>
                    ))}
                  </div>
                </div>
              </nav>

              <div className="mt-4 shrink-0 border-t border-surface-200 dark:border-surface-800 pt-4">
                <button onClick={handleLogout} className="flex w-full items-center gap-3 px-3 py-3 rounded-2xl text-sm font-semibold text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition">
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Viewport */}
      <main className={`pt-24 pb-24 lg:pb-12 transition-all duration-500 ${bannerUp ? 'pb-32' : ''}`}>
        <PartnerLiveLocationSharer />
        <UserLiveLocationSharer />
      <div className="max-w-7xl mx-auto px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
        <ReConsentBanner />
        <Outlet />
        </div>
      </main>

{/* Primary tab bar. The five tabs are declared in navigation/tabs.ts and
          shared with the More sheet, so the dock can no longer silently drop
          destinations based on array length.

          Admin-tier accounts navigate through the admin drawer instead. They are
          a separate surface with their own information architecture, so the
          consumer dock and its More sheet are withheld from them; otherwise an
          admin who lands on /admin/dashboard would see two competing navigation
          systems at once. */}
      {!isAdminTierRole(activeRole) && (
        <>
          <AppTabBar onOpenMore={() => setMoreOpen(true)} />
          <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} activeRole={activeRole} />
        </>
      )}

      {/* Floating assistant. Withheld from admin tiers for the same reason the
          consumer dock is: admins work in a separate surface, and the assistant
          exposes account and booking data that does not belong there. */}
      {!isAdminTierRole(activeRole) && <AgentLauncher />}
    </div>
  );
}
