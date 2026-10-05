import { Link, useLocation } from "react-router-dom";
import {
  PARTNER_MORE,
  USER_MORE,
  isNavItemActive,
  type NavGroup,
} from "../../navigation/tabs";

/**
 * Renders a set of navigation groups as links.
 *
 * Shared by the sidebar drawer and the More sheet on purpose. They previously
 * listed different destinations (the drawer showed "Bookings / Social" while the
 * dock showed "Requests / Chat"), which meant the app taught two different
 * navigation models at once. One component makes that impossible.
 */
export function NavGroupList({
  groups,
  onNavigate,
  variant = "sheet",
}: {
  groups: NavGroup[];
  onNavigate?: () => void;
  variant?: "sheet" | "drawer";
}) {
  const { pathname } = useLocation();
  const isDrawer = variant === "drawer";

  return (
    <>
      {groups.map((group) => (
        <div key={group.title}>
          <p
            className={`mb-3 px-3 text-[10px] font-black uppercase tracking-widest ${
              isDrawer ? "text-surface-400" : "text-slate-400"
            }`}
          >
            {group.title}
          </p>
          <div className="space-y-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isNavItemActive(item, pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={
                    isDrawer
                      ? `flex items-center gap-3 px-3 py-3 rounded-2xl text-sm transition-all ${
                          active
                            ? "bg-primary-500 text-white shadow-md shadow-primary-500/20"
                            : "text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800"
                        }`
                      : `flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition-colors motion-reduce:transition-none ${
                          active
                            ? "bg-primary-500/10 text-primary-700 dark:text-primary-300"
                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

/** The group set for a role, resolved in one place. */
export function groupsForRole(role?: string | null): NavGroup[] {
  return role === "PARTNER" ? PARTNER_MORE : USER_MORE;
}