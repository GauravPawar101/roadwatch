import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Search, ChevronDown, User, LogOut, LayoutDashboard, Map, History, ShieldAlert, Menu, X } from 'lucide-react';

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
    <header className="bg-surface-container-lowest border-b border-outline-variant sticky top-0 z-[100] shadow-sm select-none">
      <div className="flex justify-between items-center px-4 sm:px-8 lg:px-16 py-4 max-w-[1280px] mx-auto w-full gap-4">
        {/* Brand */}
        <Link to="/" className="text-base sm:text-headline-sm font-bold text-primary tracking-tight flex items-center gap-2 select-none hover:opacity-90 transition-opacity whitespace-nowrap min-w-0">
          <span className="material-symbols-outlined text-secondary text-xl sm:text-2xl font-bold shrink-0">account_balance</span>
          <span className="truncate">Infrastructure Grievance Platform</span>
        </Link>

        {/* Navigation Tabs (Desktop) */}
        <nav className="hidden lg:flex items-center gap-4 xl:gap-6 whitespace-nowrap">
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
        <div className="flex items-center gap-3 md:gap-4 ml-auto">
          {/* Search bar inside header (Desktop only) */}
          <div className="relative hidden xl:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline w-[16px] h-[16px]" />
            <input
              type="text"
              placeholder="Search reports..."
              style={{ paddingLeft: '38px' }}
              className="bg-surface-container-low border border-outline-variant rounded-lg pr-4 py-1.5 text-body-md focus:outline-none focus:ring-1 focus:ring-primary w-48 xl:w-56 text-on-surface transition-all placeholder:text-outline"
            />
          </div>

          {!isAuthenticated ? (
            <div className="relative hidden lg:block" ref={ref}>
              <button
                onClick={() => setOpen((s) => !s)}
                className="bg-primary text-white px-5 py-2 rounded-lg text-label-md font-semibold hover:bg-primary-container transition-all active:scale-95 shadow-sm inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <span>Sign In</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-150">
                  <Link
                    to={`/auth/citizen/login?next=${encodeURIComponent(location.pathname)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-4 py-3 text-on-surface hover:bg-surface-container-low transition-colors text-body-sm font-semibold border-b border-outline-variant/30"
                  >
                    <User className="w-4 h-4 text-secondary" />
                    <span>Citizen Portal</span>
                  </Link>
                  <Link
                    to={`/auth/contractor/login?next=${encodeURIComponent(location.pathname)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-4 py-3 text-on-surface hover:bg-surface-container-low transition-colors text-body-sm font-semibold border-b border-outline-variant/30"
                  >
                    <User className="w-4 h-4 text-on-tertiary-container" />
                    <span>Contractor Portal</span>
                  </Link>
                  <Link
                    to={`/auth/authority/login?next=${encodeURIComponent(location.pathname)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-4 py-3 text-on-surface hover:bg-surface-container-low transition-colors text-body-sm font-semibold"
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
                className="flex items-center gap-2 cursor-pointer p-1 rounded-full hover:bg-surface-container transition-colors"
              >
                <div className="h-8 w-8 rounded-full overflow-hidden border border-outline-variant bg-surface-container-high flex items-center justify-center">
                  <img
                    alt="User Profile"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuA2CwPC9Bs3HRoRHw3v_MWBUHd_DbvW93LHvzToDaotRnMrtfxgekCezJpVCEWOnpPWbiEk3-cL2w9OxWjebXZQagbNgu_hlTka88SOTK4U4rRU8zzCgS4Nsn2J7lOvpPefa4w0gPn0SSJYurJw9rQ64HRaWzKmK5_FNiyStf8mbc0kfMnNNxGL6dBzglnWm14bkwKaD6bBda1CE6X90-ldvHKnalWqdqAHKlIwLKKyLazqDcb5vobUUWGWV7IG1VWtC_Dhgd7Ivwg"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="hidden sm:inline text-body-sm font-bold text-on-surface pr-1 select-none capitalize">
                  {user?.role || 'Citizen'}
                </span>
                <ChevronDown className="w-4 h-4 text-on-surface-variant" />
              </div>
              {open && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden z-[100]">
                  <div className="px-4 py-3.5 bg-surface-container-low border-b border-outline-variant/30">
                    <p className="text-body-sm font-bold text-on-surface truncate">{user?.username || 'User'}</p>
                    <p className="text-[10px] text-outline font-extrabold uppercase tracking-widest mt-0.5">{user?.role || 'Citizen'}</p>
                  </div>
                  <Link
                    to="/dashboard"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-on-surface hover:bg-surface-container-low transition-colors text-body-sm font-medium"
                  >
                    <LayoutDashboard className="w-4 h-4 text-slate-500" />
                    <span>Overview</span>
                  </Link>
                  <Link
                    to="/complaints"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-on-surface hover:bg-surface-container-low transition-colors text-body-sm font-medium"
                  >
                    <History className="w-4 h-4 text-slate-500" />
                    <span>My History</span>
                  </Link>
                  <button
                    onClick={() => { setOpen(false); handleLogout(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-error hover:bg-error-container/20 transition-colors text-body-sm font-medium border-t border-outline-variant/30 text-left"
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
            className="lg:hidden p-2 rounded-lg hover:bg-surface-container text-on-surface-variant transition-colors"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Sliding Mobile Drawer Navigation */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-outline-variant bg-surface-container-lowest shadow-lg animate-in slide-in-from-top duration-200">
          <div className="px-6 py-4 flex flex-col gap-4" ref={mobileRef}>
            {/* Search Input for Mobile */}
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline w-4 h-4" />
              <input
                type="text"
                placeholder="Search reports..."
                style={{ paddingLeft: '34px' }}
                className="bg-surface-container-low border border-outline-variant rounded-lg pr-4 py-2 text-body-md focus:outline-none focus:ring-1 focus:ring-primary w-full text-on-surface transition-all placeholder:text-outline"
              />
            </div>

            {/* Mobile Nav Links */}
            <div className="flex flex-col gap-1 border-b border-outline-variant/30 pb-3">
              <Link
                to="/road/r1/report"
                onClick={() => setMobileOpen(false)}
                className={`px-3 py-2 rounded-lg text-body-md font-semibold ${
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
                className={`px-3 py-2 rounded-lg text-body-md font-semibold ${
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
                className={`px-3 py-2 rounded-lg text-body-md font-semibold ${
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
                className={`px-3 py-2 rounded-lg text-body-md font-semibold ${
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

