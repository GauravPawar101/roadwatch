import { ChevronDown, History, LayoutDashboard, LogOut, Menu, Search, ShieldAlert, User, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import NotificationCenter from './NotificationCenter';

export default function HeaderClean() {
  const { isAuthenticated, user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const mobileRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
      if (mobileRef.current && e.target instanceof Node && !mobileRef.current.contains(e.target)) setMobileOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleLogout = () => {
    try { fetch((import.meta as any).env?.VITE_API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' }) } catch(e){/*ignore*/}
    logout();
    setMobileOpen(false);
    navigate('/');
  };

  const isTabActive = (paths: string[]) => {
    return paths.some(path => location.pathname === path || (path !== '/' && location.pathname.startsWith(path)));
  };

  return (
    <header className="sticky top-0 z-[100] border-b border-outline-variant bg-surface-container-lowest/96 backdrop-blur-md shadow-sm select-none">
      <div className="flex w-full max-w-[1440px] items-center justify-between gap-4 px-4 py-3.5 sm:px-8 lg:px-10 mx-auto">
        {/* Brand */}
        <Link to="/" className="flex min-w-0 items-center gap-2 whitespace-nowrap text-base font-bold tracking-tight text-primary transition-opacity hover:opacity-90 sm:text-lg">
          <span className="material-symbols-outlined shrink-0 text-secondary text-xl sm:text-2xl font-bold">account_balance</span>
          <span className="truncate">RoadWatch</span>
        </Link>

        {/* Navigation Tabs (Desktop) */}
        <nav className="hidden items-center gap-4 whitespace-nowrap lg:flex xl:gap-6">
          <Link
            to="/road/r1/report"
            className={`${
              isTabActive(['/road/r1/report', '/report'])
                ? 'text-primary border-b-2 border-primary pb-1 font-semibold'
                : 'text-on-surface-variant font-medium hover:text-primary transition-colors duration-200'
            } text-label-md`}
          >
            Report Issue
          </Link>
          <Link
            to="/complaints"
            className={`${
              isTabActive(['/complaints'])
                ? 'text-primary border-b-2 border-primary pb-1 font-semibold'
                : 'text-on-surface-variant font-medium hover:text-primary transition-colors duration-200'
            } text-label-md`}
          >
            Track Progress
          </Link>
          <Link
            to="/map"
            className={`${
              isTabActive(['/map', '/community-map'])
                ? 'text-primary border-b-2 border-primary pb-1 font-semibold'
                : 'text-on-surface-variant font-medium hover:text-primary transition-colors duration-200'
            } text-label-md`}
          >
            Community Map
          </Link>
          <Link
            to="/settings"
            className={`${
              isTabActive(['/settings'])
                ? 'text-primary border-b-2 border-primary pb-1 font-semibold'
                : 'text-on-surface-variant font-medium hover:text-primary transition-colors duration-200'
            } text-label-md`}
          >
            Help
          </Link>
        </nav>

        {/* Actions & Profiles */}
        <div className="ml-auto flex items-center gap-3 md:gap-4">
          {/* Search bar inside header (Desktop only) */}
          <div className="relative hidden xl:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline w-[16px] h-[16px]" />
            <input
              type="text"
              placeholder="Search reports..."
              style={{ paddingLeft: '38px' }}
              className="w-48 rounded-md border border-outline-variant bg-surface-container-low px-4 py-1.5 text-body-md text-on-surface transition-all placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary xl:w-56"
            />
          </div>

          {/* Notifications (Authenticated users only) */}
          {isAuthenticated && <NotificationCenter />}

          {!isAuthenticated ? (
            <div className="relative hidden lg:block" ref={ref}>
              <button
                onClick={() => setOpen((s) => !s)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-primary px-5 py-2 text-label-md font-semibold text-white shadow-sm transition-all hover:bg-primary-container active:scale-95"
              >
                <span>Sign In</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="absolute right-0 z-[100] mt-2 w-48 overflow-hidden rounded-[10px] border border-outline-variant bg-white shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
                  <Link
                    to={`/auth/citizen/login?next=${encodeURIComponent(location.pathname)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 border-b border-outline-variant/30 px-4 py-3 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
                  >
                    <User className="w-4 h-4 text-secondary" />
                    <span>Citizen Portal</span>
                  </Link>
                  <Link
                    to={`/auth/contractor/login?next=${encodeURIComponent(location.pathname)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 border-b border-outline-variant/30 px-4 py-3 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
                  >
                    <User className="w-4 h-4 text-on-tertiary-container" />
                    <span>Contractor Portal</span>
                  </Link>
                  <Link
                    to={`/auth/authority/login?next=${encodeURIComponent(location.pathname)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-4 py-3 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
                  >
                    <ShieldAlert className="w-4 h-4 text-error" />
                    <span>Authority Portal</span>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="relative hidden lg:block" ref={ref}>
              <div
                onClick={() => setOpen((s) => !s)}
                className="flex cursor-pointer items-center gap-2 rounded-full p-1 transition-colors hover:bg-surface-container"
              >
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-outline-variant bg-surface-container-high">
                  <img
                    alt="User Profile"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuA2CwPC9Bs3HRoRHw3v_MWBUHd_DbvW93LHvzToDaotRnMrtfxgekCezJpVCEWOnpPWbiEk3-cL2w9OxWjebXZQagbNgu_hlTka88SOTK4U4rRU8zzCgS4Nsn2J7lOvpPefa4w0gPn0SSJYurJw9rQ64HRaWzKmK5_FNiyStf8mbc0kfMnNNxGL6dBzglnWm14bkwKaD6bBda1CE6X90-ldvHKnalWqdqAHKlIwLKKyLazqDcb5vobUUWGWV7IG1VWtC_Dhgd7Ivwg"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="hidden select-none pr-1 text-body-sm font-bold capitalize text-on-surface sm:inline">
                  {user?.role || 'Citizen'}
                </span>
                <ChevronDown className="w-4 h-4 text-on-surface-variant" />
              </div>
              {open && (
                <div className="absolute right-0 z-[100] mt-2 w-48 overflow-hidden rounded-[10px] border border-outline-variant bg-white shadow-lg">
                  <div className="border-b border-outline-variant/30 bg-surface-container-low px-4 py-3.5">
                    <p className="text-body-sm font-bold text-on-surface truncate">{user?.username || 'User'}</p>
                    <p className="text-[10px] text-outline font-extrabold uppercase tracking-widest mt-0.5">{user?.role || 'Citizen'}</p>
                  </div>
                  <Link
                    to="/dashboard"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-low"
                  >
                    <LayoutDashboard className="w-4 h-4 text-slate-500" />
                    <span>Overview</span>
                  </Link>
                  <Link
                    to="/complaints"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-low"
                  >
                    <History className="w-4 h-4 text-slate-500" />
                    <span>My History</span>
                  </Link>
                  <button
                    onClick={() => { setOpen(false); handleLogout(); }}
                    className="flex w-full items-center gap-2.5 border-t border-outline-variant/30 px-4 py-2.5 text-left text-body-sm font-medium text-error transition-colors hover:bg-error-container/20"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Log Out</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Hamburger Menu Button (Tablet/Mobile) */}
          <button
            onClick={() => setMobileOpen((s) => !s)}
            className="rounded-md p-2 text-on-surface-variant transition-colors hover:bg-surface-container lg:hidden"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Sliding Mobile Drawer Navigation */}
      {mobileOpen && (
        <div className="animate-in slide-in-from-top border-t border-outline-variant bg-surface-container-lowest shadow-lg lg:hidden duration-200">
          <div className="px-6 py-4 flex flex-col gap-4" ref={mobileRef}>
            {/* Search Input for Mobile */}
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline w-4 h-4" />
              <input
                type="text"
                placeholder="Search reports..."
                style={{ paddingLeft: '34px' }}
                className="w-full rounded-md border border-outline-variant bg-surface-container-low px-4 py-2 text-body-md text-on-surface transition-all placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Mobile Nav Links */}
            <div className="flex flex-col gap-1 border-b border-outline-variant/30 pb-3">
              <Link
                to="/road/r1/report"
                onClick={() => setMobileOpen(false)}
                className={`rounded-md px-3 py-2 text-body-md font-semibold ${
                  isTabActive(['/road/r1/report', '/report'])
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                Report Issue
              </Link>
              <Link
                to="/complaints"
                onClick={() => setMobileOpen(false)}
                className={`rounded-md px-3 py-2 text-body-md font-semibold ${
                  isTabActive(['/complaints'])
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                Track Progress
              </Link>
              <Link
                to="/map"
                onClick={() => setMobileOpen(false)}
                className={`rounded-md px-3 py-2 text-body-md font-semibold ${
                  isTabActive(['/map', '/community-map'])
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                Community Map
              </Link>
              <Link
                to="/settings"
                onClick={() => setMobileOpen(false)}
                className={`rounded-md px-3 py-2 text-body-md font-semibold ${
                  isTabActive(['/settings'])
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                Help
              </Link>
            </div>

            {/* User Auth Section (Mobile) */}
            <div className="pt-1">
              {!isAuthenticated ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] text-outline font-extrabold uppercase tracking-widest px-3">Select Portal Access</p>
                  <Link
                    to="/auth/citizen/login"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-on-surface hover:bg-surface-container-low transition-colors font-semibold"
                  >
                    <User className="w-5 h-5 text-secondary" />
                    <span>Citizen Portal</span>
                  </Link>
                  <Link
                    to="/auth/contractor/login"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-on-surface hover:bg-surface-container-low transition-colors font-semibold"
                  >
                    <User className="w-5 h-5 text-on-tertiary-container" />
                    <span>Contractor Portal</span>
                  </Link>
                  <Link
                    to="/auth/authority/login"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-on-surface hover:bg-surface-container-low transition-colors font-semibold"
                  >
                    <ShieldAlert className="w-5 h-5 text-error" />
                    <span>Authority Portal</span>
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-container-low rounded-xl">
                    <div className="h-10 w-10 rounded-full overflow-hidden border border-outline-variant">
                      <img
                        alt="User Profile"
                        src="https://lh3.googleusercontent.com/aida-public/AB6AXuA2CwPC9Bs3HRoRHw3v_MWBUHd_DbvW93LHvzToDaotRnMrtfxgekCezJpVCEWOnpPWbiEk3-cL2w9OxWjebXZQagbNgu_hlTka88SOTK4U4rRU8zzCgS4Nsn2J7lOvpPefa4w0gPn0SSJYurJw9rQ64HRaWzKmK5_FNiyStf8mbc0kfMnNNxGL6dBzglnWm14bkwKaD6bBda1CE6X90-ldvHKnalWqdqAHKlIwLKKyLazqDcb5vobUUWGWV7IG1VWtC_Dhgd7Ivwg"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div>
                      <p className="text-body-md font-bold text-on-surface leading-none">{user?.username || 'User'}</p>
                      <p className="text-[10px] text-outline font-extrabold uppercase tracking-widest mt-1">{user?.role || 'Citizen'}</p>
                    </div>
                  </div>
                  <Link
                    to="/dashboard"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-on-surface hover:bg-surface-container-low font-semibold transition-colors"
                  >
                    <LayoutDashboard className="w-5 h-5 text-slate-500" />
                    <span>Overview</span>
                  </Link>
                  <Link
                    to="/complaints"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-on-surface hover:bg-surface-container-low font-semibold transition-colors"
                  >
                    <History className="w-5 h-5 text-slate-500" />
                    <span>My History</span>
                  </Link>
                  <button
                    onClick={() => { handleLogout(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-error hover:bg-error-container/20 font-semibold transition-colors text-left"
                  >
                    <LogOut className="w-5 h-5" />
                    <span>Log Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

