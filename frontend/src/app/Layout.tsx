import { ClipboardCheck, Database, FlaskConical, History, LayoutDashboard, LogOut, Moon, Plus, Settings, Sun, Timer } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { hasRole, type Role } from '@silkgrade/shared';
import { useAuth } from '@/lib/auth';
import { cn, useTheme } from '@/lib/utils';

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; min?: Role; mobile?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, mobile: true },
  { to: '/tests/new', label: 'New Test', icon: Plus, min: 'TESTER', mobile: true },
  { to: '/pending', label: 'Pending Wash', icon: Timer, mobile: true },
  { to: '/review', label: 'Review Queue', icon: ClipboardCheck, min: 'EXPERT', mobile: true },
  { to: '/history', label: 'History', icon: History, mobile: true },
  { to: '/dataset', label: 'Dataset', icon: Database, min: 'EXPERT' },
  { to: '/settings', label: 'Settings', icon: Settings, min: 'ADMIN' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const items = NAV.filter((n) => !n.min || hasRole(user?.role, n.min));

  return (
    <div className="flex min-h-full">
      {/* desktop sidebar */}
      <aside className="surface sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-y-0 border-l-0 md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <FlaskConical className="size-5" aria-hidden />
          <span className="font-semibold tracking-tight">SilkGrade</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-2" aria-label="Main">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => cn('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', isActive ? 'bg-[var(--surface-2)] font-medium' : 'muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]')}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[var(--border)] p-3 text-sm">
          <div className="truncate font-medium">{user?.name}</div>
          <div className="muted mb-2 text-xs">{user?.role}</div>
          <div className="flex gap-1">
            <button onClick={toggle} className="rounded p-1.5 hover:bg-[var(--surface-2)]" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <button onClick={() => { logout(); nav('/login'); }} className="rounded p-1.5 hover:bg-[var(--surface-2)]" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* phone top bar */}
        <header className="surface sticky top-0 z-30 flex items-center justify-between border-x-0 border-t-0 px-4 py-2.5 md:hidden">
          <span className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4" /> SilkGrade</span>
          <div className="flex gap-1">
            {hasRole(user?.role, 'ADMIN') && <NavLink to="/settings" className="rounded p-1.5" aria-label="Settings"><Settings className="size-4" /></NavLink>}
            {hasRole(user?.role, 'EXPERT') && <NavLink to="/dataset" className="rounded p-1.5" aria-label="Dataset"><Database className="size-4" /></NavLink>}
            <button onClick={toggle} className="rounded p-1.5" aria-label="Toggle theme">{theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
            <button onClick={() => { logout(); nav('/login'); }} className="rounded p-1.5" aria-label="Sign out"><LogOut className="size-4" /></button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-10">
          <Outlet />
        </main>
      </div>

      {/* phone bottom tab bar */}
      <nav className="surface fixed inset-x-0 bottom-0 z-40 flex border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        {items.filter((n) => n.mobile).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]', isActive ? 'font-semibold' : 'muted')}>
            <Icon className="size-5" aria-hidden />
            {label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
