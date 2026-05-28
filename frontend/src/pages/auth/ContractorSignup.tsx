

export default function ContractorSignup() {
  return (
    <div className="min-h-screen bg-background text-on-background relative overflow-hidden">
      <main className="relative z-10 flex min-h-screen flex-col items-center px-4 pt-8 pb-24 sm:pt-10 sm:pb-20">
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-on-surface-variant">
            <span className="h-1.5 w-1.5 rounded-full bg-on-surface-variant" aria-hidden="true" />
            <span>CivicGuard</span>
          </div>
          <p className="mt-3 max-w-[26rem] text-[11px] leading-4 text-on-surface-variant sm:text-[12px] sm:leading-5">
            Contractor signup is restricted.
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center py-10 sm:py-12">
          <div className="w-full max-w-[372px] rounded-[14px] border border-outline-variant bg-surface-container-lowest px-5 py-5 text-center shadow-[0_1px_0_rgba(0,0,0,0.02)] sm:px-6 sm:py-6">
            <p className="text-[13px] leading-5 text-on-surface-variant">
              Contractor accounts are provisioned by the super administrator. There is no open signup path for Contractor users. Please contact your administrator to request an account.
            </p>
          </div>
        </div>

        <footer className="absolute bottom-0 left-0 right-0 border-t border-outline-variant/60 bg-background/90 px-4 py-3 backdrop-blur-sm sm:px-6">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 text-[11px] text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
            <p>© 2024 CivicGuard Institutional Portal. All rights reserved.</p>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:justify-end">
              <a className="transition-colors hover:text-primary" href="#">Help Center</a>
              <a className="transition-colors hover:text-primary" href="#">Privacy Policy</a>
              <a className="transition-colors hover:text-primary" href="#">Legal Disclosure</a>
            </nav>
          </div>
        </footer>
      </main>
    </div>
  );
}
