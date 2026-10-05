import { NavLink } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { motion } from "motion/react";
import { PRIMARY_TABS, isNavItemActive, type NavItem } from "../../navigation/tabs";
import { useLocation } from "react-router-dom";

/**
 * Bottom tab bar.
 *
 * Replaces the previous floating pill dock. Two changes matter:
 *  - The active pill is a shared `layoutId` element, so it slides between tabs
 *    instead of five independent highlights popping in and out.
 *  - An active tab grows a label. Hiding the label until tap is a common trick,
 *    but it makes the bar unreadable at rest and gives no text alternative.
 *
 * Icons alone are never the only signal: the active tab also carries weight,
 * colour and its label, and each link exposes aria-current.
 */
export function AppTabBar({ onOpenMore }: { onOpenMore: () => void }) {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
      // Respect the iOS home indicator instead of letting the bar sit under it.
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="mx-auto flex max-w-md items-stretch gap-1 rounded-3xl border border-surface-200/60 bg-surface-50/85 px-2 py-2 shadow-2xl shadow-black/10 backdrop-blur-2xl dark:border-surface-800/60 dark:bg-surface-900/85"
      >
        {PRIMARY_TABS.map((item) => (
          <TabLink key={item.to} item={item} active={isNavItemActive(item, pathname)} />
        ))}

        <button
          type="button"
          onClick={onOpenMore}
          aria-label="More"
          className="flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-surface-500 transition-colors hover:text-surface-800 motion-reduce:transition-none dark:text-surface-400 dark:hover:text-surface-100"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className="text-[10px] font-semibold leading-none">More</span>
        </button>
      </motion.div>
    </nav>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      aria-current={active ? "page" : undefined}
      className="relative flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2"
    >
      {active && (
        <motion.span
          // Shared layout id: the highlight travels between tabs instead of
          // cross-fading, which reads as one object rather than two.
          layoutId="tab-active"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="absolute inset-0 rounded-2xl bg-primary-500/12 dark:bg-primary-400/15"
        />
      )}

      <motion.span
        animate={{ scale: active ? 1.08 : 1, y: active ? -1 : 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 24 }}
        className="relative"
      >
        <Icon
          className={`h-5 w-5 transition-colors duration-200 ${
            active
              ? "text-primary-600 dark:text-primary-400"
              : "text-surface-500 dark:text-surface-400"
          }`}
        />
      </motion.span>

      <span
        className={`relative text-[10px] font-semibold leading-none transition-colors duration-200 ${
          active
            ? "text-primary-600 dark:text-primary-400"
            : "text-surface-500 dark:text-surface-400"
        }`}
      >
        {item.label}
      </span>
    </NavLink>
  );
}