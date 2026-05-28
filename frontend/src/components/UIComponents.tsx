import React from 'react'

/* Lightweight, self-contained UI primitives using inline styles
   to avoid reliance on external CSS class names. Components still
   accept `className` for optional overrides but provide full styling
   through style props and CSS variables.
*/

const palette = {
  surface: 'var(--color-surface, #ffffff)',
  border: 'var(--color-border, #c4c6cf)',
  primary: 'var(--color-primary, #002045)',
  primaryLight: 'var(--color-primary-light, rgba(0,32,69,0.08))',
  accent: 'var(--color-accent, #515f74)',
  text: 'var(--color-text, #1a1b1e)',
  textSecondary: 'var(--color-text-secondary, #44474e)',
  success: 'var(--color-success, #005321)',
  error: 'var(--color-error, #ba1a1a)'
}

const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  full: 9999
}

/* ---- Card ---- */
export const Card: React.FC<{
  className?: string
  children: React.ReactNode
  interactive?: boolean
  style?: React.CSSProperties
}> = ({ className = '', children, interactive = false, style = {} }) => {
  const base: React.CSSProperties = {
    background: 'rgba(255,255,255,0.96)',
    border: `1px solid ${palette.border}`,
    borderRadius: radius.lg,
    boxShadow: 'var(--shadow-sm, 0 4px 18px rgba(0,9,27,0.04))',
    padding: 0,
    overflow: 'hidden'
  }
  const interactiveStyle: React.CSSProperties = interactive
    ? { cursor: 'pointer', transition: 'transform 150ms ease, box-shadow 150ms ease' }
    : {}
  return (
    <div className={className} style={{ ...base, ...interactiveStyle, ...style }}>{children}</div>
  )
}

export const CardHeader: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style = {} }) => (
  <div className={className} style={{ padding: 18, borderBottom: `1px solid ${palette.border}`, background: 'rgba(250,249,252,0.8)', ...style }}>{children}</div>
)

export const CardTitle: React.FC<{ children: React.ReactNode; subtitle?: string; style?: React.CSSProperties }> = ({ children, subtitle, style = {} }) => (
  <div style={style}>
    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: palette.text, letterSpacing: '-0.02em' }}>{children}</h2>
    {subtitle && <p style={{ margin: '6px 0 0', color: palette.textSecondary }}>{subtitle}</p>}
  </div>
)

export const CardBody: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style = {} }) => (
  <div className={className} style={{ padding: 18, ...style }}>{children}</div>
)

export const CardFooter: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style = {} }) => (
  <div className={className} style={{ padding: 14, borderTop: `1px solid ${palette.border}`, ...style }}>{children}</div>
)

/* ---- Button ---- */
export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'ghost-white' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: 'linear-gradient(135deg, var(--color-primary-container, #002045) 0%, var(--color-secondary, #1960a3) 100%)', color: '#fff', border: `1px solid ${palette.primary}` },
  secondary: { background: 'transparent', color: palette.text, border: `1px solid ${palette.border}` },
  accent: { background: palette.accent, color: '#fff', border: `1px solid ${palette.accent}` },
  ghost: { background: 'transparent', color: palette.text, border: 'none' },
  'ghost-white': { background: 'transparent', color: '#fff', border: 'none' },
  danger: { background: palette.error, color: '#fff', border: `1px solid ${palette.error}` },
  success: { background: palette.success, color: '#fff', border: `1px solid ${palette.success}` }
}

const buttonSizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '6px 10px', fontSize: 13, borderRadius: 6 },
  md: { padding: '8px 14px', fontSize: 14, borderRadius: 8 },
  lg: { padding: '12px 18px', fontSize: 15, borderRadius: 10 }
}

export const Button: React.FC<{
  children: React.ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  loading?: boolean
  full?: boolean
  className?: string
  type?: 'button' | 'submit' | 'reset'
  style?: React.CSSProperties
}> = ({ children, onClick, variant = 'primary', size = 'md', disabled = false, loading = false, full = false, className = '', type = 'button', style = {} }) => {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    fontWeight: 700,
    border: 'none',
    whiteSpace: 'nowrap',
    letterSpacing: '0.01em',
    transition: 'transform 150ms ease, opacity 150ms ease, box-shadow 150ms ease'
  }
  const variantStyle = buttonVariantStyles[variant]
  const sizeStyle = buttonSizeStyles[size]
  const fullStyle = full ? { width: '100%' } : {}

  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} className={className} style={{ ...base, ...variantStyle, ...sizeStyle, ...fullStyle, ...style }}>
      {loading ? 'Loading...' : children}
    </button>
  )
}

/* ---- Badge ---- */
export type BadgeVariant = 'primary' | 'success' | 'error' | 'warning' | 'info'

const badgeStyles: Record<BadgeVariant, React.CSSProperties> = {
  primary: { background: 'rgba(0,32,69,0.08)', color: palette.primary, padding: '4px 8px', borderRadius: 6, fontWeight: 700, fontSize: 12 },
  success: { background: 'rgba(0,157,70,0.08)', color: palette.success, padding: '4px 8px', borderRadius: 6, fontWeight: 700, fontSize: 12 },
  error: { background: 'rgba(186,26,26,0.08)', color: palette.error, padding: '4px 8px', borderRadius: 6, fontWeight: 700, fontSize: 12 },
  warning: { background: 'rgba(245,158,11,0.08)', color: '#b45309', padding: '4px 8px', borderRadius: 6, fontWeight: 700, fontSize: 12 },
  info: { background: 'rgba(81,95,116,0.08)', color: palette.accent, padding: '4px 8px', borderRadius: 6, fontWeight: 700, fontSize: 12 }
}

export const Badge: React.FC<{ children: React.ReactNode; variant?: BadgeVariant; className?: string; style?: React.CSSProperties }> = ({ children, variant = 'primary', className = '', style = {} }) => (
  <span className={className} style={{ display: 'inline-block', ...badgeStyles[variant], ...style }}>{children}</span>
)

/* ---- Alert ---- */
export type AlertVariant = 'success' | 'error' | 'warning' | 'info'
export const Alert: React.FC<{ children: React.ReactNode; variant?: AlertVariant; title?: string; onClose?: () => void; className?: string; style?: React.CSSProperties }> = ({ children, variant = 'info', title, onClose, className = '', style = {} }) => {
  const tone = variant === 'success' ? { borderLeft: `4px solid ${palette.success}` } : variant === 'error' ? { borderLeft: `4px solid ${palette.error}` } : {}
  return (
    <div className={className} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, border: `1px solid ${palette.border}`, borderRadius: radius.md, background: palette.surface, ...tone, ...style }}>
      <div style={{ flex: 1 }}>
        {title && <strong style={{ display: 'block', marginBottom: 6 }}>{title}</strong>}
        {children}
      </div>
      {onClose && (
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
      )}
    </div>
  )
}

/* ---- Form ---- */
export const FormGroup: React.FC<{ label: string; required?: boolean; error?: string; children: React.ReactNode; helperText?: string; className?: string; style?: React.CSSProperties }> = ({ label, required = false, error, children, helperText, className = '', style = {} }) => (
  <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
    <label style={{ fontWeight: 700, color: palette.text }}>{label}{required && <span style={{ color: palette.error }}> *</span>}</label>
    {children}
    {error && <span style={{ color: palette.error, fontSize: 12 }}>{error}</span>}
    {helperText && !error && <span style={{ color: palette.textSecondary, fontSize: 12 }}>{helperText}</span>}
  </div>
)

/* ---- Inputs ---- */
const baseInputStyle: React.CSSProperties = {
  border: `1px solid ${palette.border}`,
  padding: '8px 10px',
  borderRadius: radius.md,
  fontSize: 14,
  outline: 'none',
  background: palette.surface,
  color: palette.text,
  width: '100%',
  boxSizing: 'border-box'
}

export const Input: React.FC<{
  type?: string
  placeholder?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  disabled?: boolean
  className?: string
  error?: boolean
  startIcon?: React.ReactNode
  style?: React.CSSProperties
  [key: string]: any
}> = ({ type = 'text', className = '', error = false, startIcon, style = {}, ...props }) => {
  const inputProps: Record<string, any> = { ...props }
  // remove non-standard props that should not reach the DOM
  delete inputProps.startIcon

  return (
    <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, background: 'transparent' }} className={className}>
      {startIcon && <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>{startIcon}</span>}
      <input
        type={type}
        {...inputProps}
        style={{ ...baseInputStyle, flex: 1, ...(error ? { borderColor: palette.error } : {}), ...(props.disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}), ...style }}
      />
    </div>
  )
}

export const Textarea: React.FC<{
  placeholder?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  disabled?: boolean
  className?: string
  rows?: number
  style?: React.CSSProperties
  [key: string]: any
}> = ({ className = '', style = {}, rows = 4, ...props }) => (
  <textarea className={className} rows={rows} style={{ ...baseInputStyle, minHeight: 80, resize: 'vertical', ...style }} {...props} />
)

export const Select: React.FC<{
  options?: { label: string; value: string | number }[]
  placeholder?: string
  value?: string | number
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
  [key: string]: any
}> = ({ options, placeholder, className = '', style = {}, children, ...props }) => {
  // Support either passing an `options` array or children <option/> elements
  return (
    <select className={className} style={{ ...baseInputStyle, appearance: 'none', backgroundImage: 'none', ...style }} {...props}>
      {placeholder && <option value="">{placeholder}</option>}
      {children ? (
        // render provided option children
        children
      ) : (
        // render options array if provided
        (options || []).map((opt) => (
          <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
        ))
      )}
    </select>
  )
}

/* ---- Stats / Grid ---- */
export const StatsGrid: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style = {} }) => (
  <div className={className} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, ...style }}>{children}</div>
)

export const StatCard: React.FC<{ value: string | number; label: string; change?: { value: number; type: 'positive' | 'negative' }; icon?: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ value, label, change, icon, className = '', style = {} }) => (
  <div className={className} style={{ padding: 12, borderRadius: radius.md, background: palette.surface, border: `1px solid ${palette.border}`, ...style }}>
    {icon && <div style={{ marginBottom: 8 }}>{icon}</div>}
    <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
    <div style={{ color: palette.textSecondary, marginTop: 6 }}>{label}</div>
    {change && <div style={{ marginTop: 8, color: change.type === 'positive' ? palette.success : palette.error, fontWeight: 700 }}>{change.type === 'positive' ? '↑' : '↓'} {Math.abs(change.value)}%</div>}
  </div>
)

/* ---- Hero / Container / Grid ---- */
export const Hero: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ title, subtitle, actions, className = '', style = {} }) => (
  <div className={className} style={{ padding: '24px 20px', ...style }}>
    <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, letterSpacing: '-0.03em' }}>{title}</h1>
    {subtitle && <p style={{ marginTop: 8, color: palette.textSecondary, maxWidth: 760, lineHeight: 1.6 }}>{subtitle}</p>}
    {actions && <div style={{ marginTop: 12 }}>{actions}</div>}
  </div>
)

export const Container: React.FC<{ children: React.ReactNode; maxWidth?: string; className?: string; style?: React.CSSProperties }> = ({ children, maxWidth = '1200px', className = '', style = {} }) => (
  <div className={className} style={{ maxWidth, margin: '0 auto', padding: '0 16px', ...style }}>{children}</div>
)

export const Grid: React.FC<{ cols?: number; gap?: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ cols = 3, gap = '12px', children, className = '', style = {} }) => (
  <div className={className} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap, ...style }}>{children}</div>
)

/* ---- Spinner ---- */
export const Spinner: React.FC<{ size?: 'sm' | 'md' | 'lg'; className?: string; style?: React.CSSProperties }> = ({ size = 'md', className = '', style = {} }) => {
  const sizeMap: Record<string, number> = { sm: 24, md: 40, lg: 60 }
  const s = sizeMap[size]
  return <div className={className} style={{ width: s, height: s, border: '3px solid var(--color-border)', borderTopColor: palette.primary, borderRadius: '50%', animation: 'spin 600ms linear infinite', ...style }} />
}

/* ---- ProgressBar ---- */
export const ProgressBar: React.FC<{ progress: number; showLabel?: boolean; className?: string; style?: React.CSSProperties }> = ({ progress, showLabel = true, className = '', style = {} }) => (
  <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
    <div style={{ height: 6, background: palette.border, borderRadius: radius.full, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, progress))}%`, background: `linear-gradient(90deg, ${palette.primary}, ${palette.accent})`, transition: 'width 300ms ease-out' }} />
    </div>
    {showLabel && <span style={{ fontSize: 12, color: palette.textSecondary }}>{Math.round(progress)}%</span>}
  </div>
)

/* ---- Pill / Divider / Section ---- */
export const Pill: React.FC<{ children: React.ReactNode; onRemove?: () => void; variant?: 'primary' | 'secondary' | 'success' | 'error'; className?: string; style?: React.CSSProperties }> = ({ children, onRemove, variant = 'secondary', className = '', style = {} }) => (
  <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: radius.full, fontSize: 13, fontWeight: 600, background: variant === 'primary' ? palette.primaryLight : 'rgba(0,0,0,0.04)', color: variant === 'primary' ? palette.primary : palette.text, ...style }}>
    {children}
    {onRemove && <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>×</button>}
  </span>
)

export const Divider: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className = '', style = {} }) => (
  <div className={className} style={{ height: 1, background: palette.border, margin: '16px 0', ...style }} />
)

export const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ title, subtitle, children, className = '', style = {} }) => (
  <section className={className} style={{ marginBottom: 32, ...style }}>
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{title}</h2>
      {subtitle && <p style={{ color: palette.textSecondary, fontSize: 13, marginTop: 6 }}>{subtitle}</p>}
    </div>
    {children}
  </section>
)

/* ---- Accordion / Collapsible ---- */
export const Accordion: React.FC<{ items: Array<{ id: string; title: string | React.ReactNode; content: React.ReactNode; disabled?: boolean }>; allowMultiple?: boolean; className?: string; defaultOpen?: string[]; style?: React.CSSProperties }> = ({ items, allowMultiple = false, className = '', defaultOpen = [], style = {} }) => {
  const [openItems, setOpenItems] = React.useState<Set<string>>(new Set(defaultOpen))
  const toggleItem = (id: string) => {
    const newOpen = new Set(openItems)
    if (newOpen.has(id)) newOpen.delete(id)
    else {
      if (!allowMultiple) newOpen.clear()
      newOpen.add(id)
    }
    setOpenItems(newOpen)
  }

  return (
    <div className={className} style={{ border: `1px solid ${palette.border}`, borderRadius: radius.lg, overflow: 'hidden', ...style }}>
      {items.map((item, index) => (
        <div key={item.id} style={{ borderBottom: index < items.length - 1 ? `1px solid ${palette.border}` : 'none' }}>
          <button type="button" onClick={() => !item.disabled && toggleItem(item.id)} disabled={item.disabled} aria-expanded={openItems.has(item.id)} style={{ width: '100%', padding: 12, background: openItems.has(item.id) ? palette.primaryLight : 'transparent', border: 'none', textAlign: 'left', cursor: item.disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700, color: openItems.has(item.id) ? palette.primary : palette.text }}>
            <span>{item.title}</span>
            <span style={{ transform: openItems.has(item.id) ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 160ms ease' }}>▼</span>
          </button>
          {openItems.has(item.id) && <div style={{ padding: 12, background: 'transparent' }}>{item.content}</div>}
        </div>
      ))}
    </div>
  )
}

export const Collapsible: React.FC<{ trigger: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; className?: string; onChange?: (open: boolean) => void; style?: React.CSSProperties }> = ({ trigger, children, defaultOpen = false, className = '', onChange, style = {} }) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)
  const handleToggle = () => {
    const newOpen = !isOpen
    setIsOpen(newOpen)
    onChange?.(newOpen)
  }
  return (
    <div className={className} style={{ border: `1px solid ${palette.border}`, borderRadius: radius.lg, overflow: 'hidden', ...style }}>
      <button type="button" onClick={handleToggle} aria-expanded={isOpen} style={{ cursor: 'pointer', padding: 12, background: isOpen ? palette.primaryLight : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', border: 'none', fontWeight: 700 }}>
        <span>{trigger}</span>
        <span style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 160ms ease' }}>▼</span>
      </button>
      {isOpen && <div style={{ padding: 12 }}>{children}</div>}
    </div>
  )
}

/* ---- Empty state ---- */
export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ icon, title, description, action, className = '', style = {} }) => (
  <div className={className} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, textAlign: 'center', gap: 12, ...style }}>
    {icon && <div style={{ fontSize: 48, opacity: 0.6 }}>{icon}</div>}
    <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{title}</h3>
    {description && <p style={{ color: palette.textSecondary }}>{description}</p>}
    {action && <div>{action}</div>}
  </div>
)

export default {}
