import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useBranding } from "@/lib/branding";
import BrandMark from "@/components/BrandMark";
import { canView } from "@/lib/perm";
import { buildApplyUrl } from "@/lib/applyUrl";
import { photoSrc } from "@/pages/Clients";
import NotificationsBell from "@/components/NotificationsBell";
import BottomNav from "@/components/BottomNav";
import InstallPrompt from "@/components/InstallPrompt";
import {
  House, Gear, SignOut, Sun, Moon, List as ListIcon, MagnifyingGlass,
  ShieldCheck, ChatCircleDots, ArrowUpRight,
  Target, Handshake, UserCircle, ClockCounterClockwise,
} from "@phosphor-icons/react";

// Sidebar nav with role gating.
//   roles: array of roles that can see this item. Omitting `roles` means all.
//   perm: page-permission key — when present, item is hidden if canView(user, perm) is false.
//   userRoleAllowed: explicit allow-list flag for the lightweight "user" role.
//     Omit (or set falsy) to hide the item from "user" role accounts.
const ALL_NAV = [
  { to: "/", label: "Overview", icon: House, end: true, tid: "nav-overview", perm: "overview", module: "overview", userRoleAllowed: true },
  { to: "/leads", label: "CRM / Leads", icon: Target, tid: "nav-leads", roles: ["super_admin", "office_admin", "staff"], perm: "leads", module: "leads", userRoleAllowed: false },
  { to: "/clients", label: "Employees", icon: Handshake, tid: "nav-clients", roles: ["super_admin", "office_admin"], perm: "clients", module: "clients" },
  { to: "/messages", label: "Messages", icon: ChatCircleDots, tid: "nav-messages", module: "messages", userRoleAllowed: true },
  { to: "/users", label: "Team", icon: ShieldCheck, tid: "nav-users", roles: ["super_admin"], module: "users" },
  { to: "/activity", label: "Activity", icon: ClockCounterClockwise, tid: "nav-activity", roles: ["super_admin", "office_admin"], module: "activity" },
  { to: "/settings", label: "Settings", icon: Gear, tid: "nav-settings", perm: "settings", module: "settings", userRoleAllowed: true },
];

// path → module key, for blocking direct URL access to a disabled module.
const PATH_MODULE = {
  "/messages": "messages",
  "/clients": "clients",
  "/leads": "leads",
  "/activity": "activity",
};

const PAGE_TITLES = {
  "/": "Overview",
  "/messages": "Messages",
  "/clients": "Employees",
  "/leads": "CRM / Leads",
  "/settings": "Settings",
  "/users": "Team & approvals",
  "/branding": "Customize",
  "/activity": "Activity",
};

function initialsOf(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

// Single flat sidebar list for every role — the CRM surface is small enough
// that collapsible groups add no value.
function buildSections(navItems) {
  return [{ type: "items", label: "Workspace", items: navItems }];
}

function SidebarContent({ onItemClick, user, onLogout }) {
  const role = user?.role;
  const { branding } = useBranding();
  const enabled = user?.enabled_modules;
  const navItems = ALL_NAV.filter((i) => {
    if (i.roles && !i.roles.includes(role)) return false;
    if (i.perm && !canView(user, i.perm)) return false;
    if (i.module && Array.isArray(enabled) && !enabled.includes(i.module)) return false;
    return true;
  }).map((i) => {
    if (role !== "staff") return i;
    if (i.to === "/settings") return { ...i, label: "Profile", icon: UserCircle };
    if (i.to === "/leads") return { ...i, label: "My Leads" };
    return i;
  });

  const linkClass = (indent) => ({ isActive }) =>
    `flex items-center gap-3 ${indent ? "pl-11 pr-4" : "px-4"} py-2.5 rounded-lg text-sm transition-all ${
      isActive
        ? "bg-amber-gradient text-white font-medium shadow-md shadow-orange-500/25"
        : "text-[hsl(var(--sidebar-fg))] hover:bg-orange-500/10 hover:text-orange-600 dark:hover:text-orange-400"
    }`;

  const renderLink = (item, indent) => (
    <NavLink key={item.to} to={item.to} end={item.end} data-testid={item.tid} onClick={onItemClick} className={linkClass(indent)}>
      <item.icon size={18} weight="regular" />
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <>
      {/* Brand */}
      <div className="px-6 py-5 flex items-center gap-3 border-b border-[hsl(var(--sidebar-border))]">
        <BrandMark size={44} className="shadow-sm" />
        <div className="flex flex-col min-w-0">
          <span className="font-display text-base font-semibold tracking-tight text-[hsl(var(--sidebar-fg))] truncate">{branding?.app_name || "Connect Pro - Zelix"}</span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--sidebar-muted))] truncate">{branding?.company_line || ""}</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="px-3 py-6 flex-1 space-y-0.5 overflow-y-auto" data-testid="sidebar-nav">
        {buildSections(navItems).map((section, idx) => (
          <div key={`sec-${idx}`} className={idx > 0 ? "pt-3" : ""}>
            {section.label && (
              <p className="px-3 mb-2 text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--sidebar-muted))] font-semibold">{section.label}</p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => renderLink(item, false))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: user info + sign out (mobile drawer only — hidden on desktop where topbar handles it) */}
      {onLogout && (
        <div className="md:hidden border-t border-[hsl(var(--sidebar-border))] p-3 space-y-2 shrink-0">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="w-9 h-9 rounded-full bg-amber-gradient text-white text-xs font-semibold flex items-center justify-center shrink-0 overflow-hidden">
              {user?.photo_url ? (
                <img
                  src={photoSrc(user.photo_url)}
                  alt={user?.name || "profile"}
                  className="w-full h-full object-cover"
                />
              ) : (
                initialsOf(user?.name).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[hsl(var(--sidebar-fg))] truncate" data-testid="drawer-user-name">{user?.name}</p>
              <p className="text-[10px] uppercase tracking-wider text-[hsl(var(--sidebar-muted))] truncate">{user?.role?.replace("_", " ")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            data-testid="drawer-logout-btn"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-sm font-medium transition-colors"
          >
            <SignOut size={16} weight="bold" />
            Sign out
          </button>
        </div>
      )}
    </>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className="relative w-10 h-10 rounded-full bg-muted/60 hover:bg-muted text-foreground flex items-center justify-center transition-colors"
    >
      {theme === "dark" ? <Sun size={18} weight="fill" className="text-amber-400" /> : <Moon size={18} weight="fill" className="text-orange-600" />}
    </button>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const nav = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const pageTitle = (user?.role === "staff" && location.pathname === "/settings" ? "Profile" : null)
    || (user?.role === "staff" && location.pathname === "/leads" ? "My Leads" : null)
    || PAGE_TITLES[location.pathname]
    || (location.pathname.startsWith("/students/") ? "Student" : "")
    || (location.pathname.startsWith("/agents/") ? "Agent detail" : "")
    || (branding?.app_name || "Connect Pro - Zelix");

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    nav("/login");
  };

  // Block direct URL access to a module the company has switched off.
  const disabledModule = useMemo(() => {
    const mod = PATH_MODULE[location.pathname];
    const enabled = user?.enabled_modules;
    return mod && Array.isArray(enabled) && !enabled.includes(mod);
  }, [location.pathname, user]);
  if (disabledModule) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex">
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex w-64 shrink-0 flex-col border-r bg-[hsl(var(--sidebar-bg))] border-[hsl(var(--sidebar-border))] sticky top-0 h-screen"
        data-testid="desktop-sidebar"
      >
        <SidebarContent user={user} />
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            data-testid="mobile-drawer-overlay"
          />
          <aside
            className="md:hidden fixed top-0 left-0 z-50 w-72 h-full bg-[hsl(var(--sidebar-bg))] border-r border-[hsl(var(--sidebar-border))] flex flex-col animate-fade-in"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            data-testid="mobile-drawer"
          >
            <SidebarContent user={user} onItemClick={() => setMobileOpen(false)} onLogout={handleLogout} />
          </aside>
        </>
      )}

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header
          className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b border-border"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
          data-testid="topbar"
        >
          <div className="h-16 px-4 md:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              data-testid="mobile-menu-btn"
              className="md:hidden w-10 h-10 rounded-lg bg-muted text-foreground flex items-center justify-center hover:bg-muted/80"
            >
              <ListIcon size={20} />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">Workspace</p>
              <h2 className="font-display text-base md:text-lg font-semibold tracking-tight truncate" data-testid="topbar-page-title">{pageTitle}</h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
            <div className="hidden lg:flex relative w-64 xl:w-80">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search…"
                className="w-full h-10 pl-10 pr-3 rounded-full bg-muted/60 border border-transparent focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm transition-all"
                data-testid="topbar-search"
              />
            </div>
            {user?.role === "super_admin" && !!process.env.REACT_APP_APPLY_PUBLIC_URL && (
              <a
                href={buildApplyUrl()}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="topbar-open-public-form"
                title="Open the public admission form in a new tab"
                className="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-muted/60 hover:bg-amber-gradient-soft hover:text-amber-700 dark:hover:text-amber-300 text-xs font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-orange-500/30 transition-colors"
              >
                <span>Public form</span>
                <ArrowUpRight size={12} weight="bold" />
              </a>
            )}
            <NotificationsBell />
            <ThemeToggle />
            <div className="flex items-center gap-2 sm:gap-2.5 pl-2 sm:pl-3 ml-0.5 sm:ml-1 border-l border-border h-8">
              <div className="w-8 h-8 rounded-full bg-amber-gradient text-white text-xs font-semibold flex items-center justify-center shrink-0 overflow-hidden" data-testid="topbar-avatar">
                {user?.photo_url ? (
                  <img
                    src={photoSrc(user.photo_url)}
                    alt={user?.name || "profile"}
                    className="w-full h-full object-cover"
                    data-testid="topbar-avatar-img"
                  />
                ) : (
                  initialsOf(user?.name).toUpperCase()
                )}
              </div>
              <div className="hidden lg:block min-w-0">
                <p className="text-xs font-medium leading-tight truncate max-w-[140px]" data-testid="topbar-user-name">{user?.name}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{user?.business_name || user?.currency || "USD"}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                data-testid="logout-btn"
                title="Sign out"
                className="ml-0.5 sm:ml-1 w-9 h-9 rounded-full bg-muted/60 hover:bg-rose-500/15 text-foreground hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition-colors"
              >
                <SignOut size={16} />
              </button>
            </div>
          </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-10 py-6 sm:py-8 pb-28 md:pb-12 max-w-[1500px] w-full mx-auto">
          <Outlet />
        </div>
      </main>
      <BottomNav />
      <InstallPrompt />
    </div>
  );
}
