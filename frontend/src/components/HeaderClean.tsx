import { ChevronDown, LayoutDashboard, LogOut, Menu, ShieldAlert, User, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type Role } from '../contexts/AuthContext';
import { getDashboardPath } from '../lib/authRedirect';
import NotificationCenter from './NotificationCenter';

function UserAvatar({ name }: { name?: string }) {
  const initials = (name || 'U')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U';

  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-bold text-white">
      {initials}
    </div>
  );
}

type NavItem = { label: string; paths: string[]; to: string };

const publicNav: NavItem[] = [
  { label: 'Home', paths: ['/', '/dashboard', '/dashboard/citizen'], to: '/' },
  { label: 'Map', paths: ['/map', '/community-map'], to: '/map' },
];

function navForRole(role?: Role, authenticated = false): NavItem[] {
  if (!authenticated) {
    return [
      ...publicNav,
      { label: 'Report Issue', paths: ['/complaints/new', '/road'], to: '/complaints/new' },
    ];
  }

  if (role === 'CE' || role === 'EE') {
    return [
      { label: 'Dashboard', paths: ['/dashboard/authority', '/authority'], to: '/dashboard/authority' },
      { label: 'Analytics', paths: ['/authority/analytics'], to: '/authority/analytics' },
      { label: 'Map', paths: ['/map', '/community-map'], to: '/map' },
      { label: 'Notifications', paths: ['/authority/notifications'], to: '/authority/notifications' },
    ];
  }

  if (role === 'CONTRACTOR') {
    return [
      { label: 'Dashboard', paths: ['/dashboard/contractor', '/contractor'], to: '/dashboard/contractor' },
      { label: 'Work Orders', paths: ['/contractor/complaints'], to: '/contractor/complaints' },
      { label: 'Map', paths: ['/map', '/community-map'], to: '/map' },
      { label: 'Documents', paths: ['/contractor/vault'], to: '/contractor/vault' },
    ];
  }

  return [
    { label: 'Dashboard', paths: ['/', '/dashboard', '/dashboard/citizen'], to: '/dashboard/citizen' },
    { label: 'My Reports', paths: ['/complaints'], to: '/complaints' },
    { label: 'Map', paths: ['/map', '/community-map'], to: '/map' },
    { label: 'Settings', paths: ['/settings', '/profile'], to: '/settings' },
  ];
}

export default function HeaderClean() {
  const { isAuthenticated, user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const mobileRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = useMemo(
    () => navForRole(user?.role, isAuthenticated),
    [user?.role, isAuthenticated],
  );

  const dashboardPath = getDashboardPath(user?.role);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
      if (mobileRef.current && e.target instanceof Node && !mobileRef.current.contains(e.target)) setMobileOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    try {
      fetch((import.meta as any).env?.VITE_API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    logout();
    setMobileOpen(false);
    navigate('/');
  };

  const isTabActive = (paths: string[]) =>
    paths.some((path) => {
      if (path === '/') return location.pathname === '/';
      return location.pathname === path || location.pathname.startsWith(path + '/');
    });

  const loginNext = encodeURIComponent(location.pathname + location.search);

  return (
    <header className="sticky top-0 z-[100] border-b border-gray-200 bg-white shadow-sm">
      <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4 px-4 py-3 sm:px-8 lg:px-10">
        <Link
          to={isAuthenticated ? dashboardPath : '/'}
          className="flex min-w-0 items-center gap-2.5 whitespace-nowrap text-base font-bold tracking-tight text-primary transition-opacity hover:opacity-90 sm:text-lg"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-white">
            <span className="material-symbols-outlined text-xl">account_balance</span>
          </span>
          <span className="truncate">RoadWatch</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map(({ label, paths, to }) => (
            <Link
              key={label}
              to={to}
              className={isTabActive(paths) ? 'nav-link nav-link-active' : 'nav-link'}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:gap-3">
          {isAuthenticated && <NotificationCenter />}

          {!isAuthenticated ? (
            <div className="relative hidden lg:block" ref={ref}>
              <button
                onClick={() => setOpen((s) => !s)}
                className="btn-primary !rounded-lg !px-5 !py-2 !text-label-md"
              >
                <span>Sign In</span>
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="dropdown-enter absolute right-0 z-[100] mt-2 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                  <Link
                    to={`/auth/citizen/login?next=${loginNext}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 border-b border-gray-100 px-4 py-3 text-body-sm font-medium text-on-surface hover:bg-gray-50"
                  >
                    <User className="h-4 w-4 text-secondary" />
                    Citizen Portal
                  </Link>
                  <Link
                    to={`/auth/contractor/login?next=${loginNext}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 border-b border-gray-100 px-4 py-3 text-body-sm font-medium text-on-surface hover:bg-gray-50"
                  >
                    <User className="h-4 w-4 text-secondary" />
                    Contractor Portal
                  </Link>
                  <Link
                    to={`/auth/authority/login?next=${loginNext}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-3 text-body-sm font-medium text-on-surface hover:bg-gray-50"
                  >
                    <ShieldAlert className="h-4 w-4 text-error" />
                    Authority Portal
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="relative hidden lg:block" ref={ref}>
              <button
                onClick={() => setOpen((s) => !s)}
                className="flex items-center gap-2 rounded-full border border-gray-200 p-1 pr-2 transition-colors hover:bg-gray-50"
              >
                <UserAvatar name={user?.username || user?.email} />
                <span className="max-w-[120px] truncate text-body-sm font-semibold text-on-surface">
                  {user?.username || 'User'}
                </span>
                <ChevronDown className="h-4 w-4 text-on-surface-variant" />
              </button>
              {open && (
                <div className="dropdown-enter absolute right-0 z-[100] mt-2 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                  <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="truncate text-body-sm font-bold text-on-surface">{user?.username || 'User'}</p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-outline">
                      {user?.role || 'Citizen'}
                    </p>
                  </div>
                  <Link
                    to={dashboardPath}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-body-sm font-medium text-on-surface hover:bg-gray-50"
                  >
                    <LayoutDashboard className="h-4 w-4 text-on-surface-variant" />
                    Dashboard
                  </Link>
                  <button
                    onClick={() => { setOpen(false); handleLogout(); }}
                    className="flex w-full items-center gap-2.5 border-t border-gray-100 px-4 py-2.5 text-left text-body-sm font-medium text-error hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Log Out
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setMobileOpen((s) => !s)}
            className="rounded-lg p-2 text-on-surface-variant hover:bg-gray-100 lg:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-gray-200 bg-white shadow-lg lg:hidden">
          <div className="flex flex-col gap-1 px-4 py-4" ref={mobileRef}>
            {navItems.map(({ label, paths, to }) => (
              <Link
                key={label}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={`rounded-lg px-3 py-2.5 text-body-md font-medium ${
                  isTabActive(paths)
                    ? 'bg-blue-50 text-secondary'
                    : 'text-on-surface-variant hover:bg-gray-50'
                }`}
              >
                {label}
              </Link>
            ))}

            <div className="mt-3 border-t border-gray-200 pt-3">
              {!isAuthenticated ? (
                <div className="flex flex-col gap-1">
                  <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-outline">Sign in as</p>
                  <Link to={`/auth/citizen/login?next=${loginNext}`} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium hover:bg-gray-50">
                    <User className="h-5 w-5 text-secondary" /> Citizen
                  </Link>
                  <Link to={`/auth/contractor/login?next=${loginNext}`} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium hover:bg-gray-50">
                    <User className="h-5 w-5 text-secondary" /> Contractor
                  </Link>
                  <Link to={`/auth/authority/login?next=${loginNext}`} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium hover:bg-gray-50">
                    <ShieldAlert className="h-5 w-5 text-error" /> Authority
                  </Link>
                </div>
              ) : (
                <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left font-medium text-error hover:bg-red-50">
                  <LogOut className="h-5 w-5" /> Log Out
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
