import { NavLink, Outlet } from "react-router-dom";
import { UserButton, OrganizationSwitcher } from "@clerk/clerk-react";
import {
  BookOpen,
  Briefcase,
  Clock,
  FileText,
  LayoutDashboard,
  Bell,
  Plug,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PiButton } from "@/components/PiButton";
import { useMe } from "@/hooks/use-me";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/time", label: "Time", icon: Clock },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/settings/integrations", label: "Integrations", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/docs", label: "Docs", icon: BookOpen },
];

const ADMIN_NAV: NavItem = {
  to: "/admin/users",
  label: "Admin",
  icon: ShieldCheck,
};

export function AppShell() {
  const { data: me } = useMe();
  const navItems = me?.user?.is_admin ? [...NAV, ADMIN_NAV] : NAV;
  return (
    <div className="flex h-full min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
      <aside className="hidden w-60 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-card)] md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 px-4 border-b border-[var(--color-border)]">
          <Briefcase className="h-5 w-5 text-[var(--color-primary)]" />
          <span className="font-semibold tracking-tight">
            Professional Billing
          </span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)] font-medium"
                      : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-3 text-xs text-[var(--color-muted-foreground)] border-t border-[var(--color-border)]">
          Phase 1 · Foundation
        </div>
      </aside>
      <div className="flex flex-1 min-w-0 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-card)]/60 px-4 backdrop-blur">
          <div className="min-w-0">
            <OrganizationSwitcher
              hidePersonal
              appearance={{ elements: { rootBox: "flex items-center" } }}
            />
          </div>
          <div className="flex items-center gap-2">
            <PiButton />
            <ThemeToggle />
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-6xl p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
