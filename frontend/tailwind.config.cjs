/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        "surface-dim": "var(--surface-dim)",
        "outline": "var(--outline)",
        "tertiary": "var(--tertiary)",
        "surface": "var(--surface)",
        "tertiary-container": "var(--tertiary-container)",
        "background": "var(--background)",
        "inverse-surface": "var(--inverse-surface)",
        "outline-variant": "var(--outline-variant)",
        "surface-container-highest": "var(--surface-container-highest)",
        "primary-fixed": "var(--primary-fixed)",
        "on-surface-variant": "var(--on-surface-variant)",
        "on-secondary": "var(--on-secondary)",
        "surface-tint": "var(--surface-tint)",
        "tertiary-fixed-dim": "var(--tertiary-fixed-dim)",
        "on-surface": "var(--on-surface)",
        "on-secondary-container": "var(--on-secondary-container)",
        "surface-bright": "var(--surface-bright)",
        "on-tertiary-fixed": "var(--on-tertiary-fixed)",
        "on-primary-container": "var(--on-primary-container)",
        "surface-container-lowest": "var(--surface-container-lowest)",
        "surface-container": "var(--surface-container)",
        "secondary-fixed-dim": "var(--secondary-fixed-dim)",
        "on-secondary-fixed": "var(--on-secondary-fixed)",
        "secondary-container": "var(--secondary-container)",
        "primary-container": "var(--primary-container)",
        "on-tertiary-container": "var(--on-tertiary-container)",
        "primary": "var(--primary)",
        "on-secondary-fixed-variant": "var(--on-secondary-fixed-variant)",
        "inverse-primary": "var(--inverse-primary)",
        "on-primary": "var(--on-primary)",
        "surface-variant": "var(--surface-variant)",
        "surface-container-high": "var(--surface-container-high)",
        "error-container": "var(--error-container)",
        "error": "var(--error)",
        "secondary": "var(--secondary)",
        "surface-container-low": "var(--surface-container-low)",
        "on-primary-fixed-variant": "var(--on-primary-fixed-variant)",
        "inverse-on-surface": "var(--inverse-on-surface)",
        "on-error": "var(--on-error)",
        "on-tertiary-fixed-variant": "var(--on-tertiary-fixed-variant)",
        "on-error-container": "var(--on-error-container)",
        "on-primary-fixed": "var(--on-primary-fixed)",
        "secondary-fixed": "var(--secondary-fixed)",
        "primary-fixed-dim": "var(--primary-fixed-dim)",
        "on-tertiary": "var(--on-tertiary)",
        "tertiary-fixed": "var(--tertiary-fixed)",
        "on-background": "var(--on-background)",
        "status-pending": "var(--status-pending)",
        "status-pending-text": "var(--status-pending-text)",
        "status-resolved": "var(--status-resolved)",
        "status-resolved-text": "var(--status-resolved-text)"
      },
      spacing: {
        "base": "8px",
        "margin-desktop": "64px",
        "container-max": "1280px",
        "gutter": "24px",
        "margin-mobile": "16px",
        "xs": "4px", "xxl": "80px", "md": "16px", "xl": "48px", "sm": "8px", "lg": "24px"
      },
      borderRadius: {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      boxShadow: {
        'stripe-sm': '0 2px 6px rgba(3,30,66,0.06)',
        'stripe-md': '0 6px 18px rgba(3,30,66,0.08)',
        'stripe-lg': '0 20px 60px rgba(3,30,66,0.14)'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui']
      },
      fontSize: {
        "headline-md": ["32px", {"lineHeight": "1.2", "letterSpacing": "-0.02em", "fontWeight": "700"}],
        "title-lg": ["24px", {"lineHeight": "1.4", "letterSpacing": "-0.01em", "fontWeight": "600"}],
        "headline-lg": ["40px", {"lineHeight": "1.2", "letterSpacing": "-0.02em", "fontWeight": "700"}],
        "body-lg": ["18px", {"lineHeight": "1.6", "letterSpacing": "0em", "fontWeight": "400"}],
        "body-md": ["16px", {"lineHeight": "1.6", "letterSpacing": "0em", "fontWeight": "400"}],
        "label-md": ["14px", {"lineHeight": "1.2", "letterSpacing": "0.05em", "fontWeight": "600"}],
        "display-xl": ["64px", {"lineHeight": "1.1", "letterSpacing": "-0.04em", "fontWeight": "800"}],
        "caption": ["12px", {"lineHeight": "1.4", "letterSpacing": "0em", "fontWeight": "400"}],
        "body-sm": ["14px", {"lineHeight": "1.5", "fontWeight": "400"}],
        "headline-sm": ["20px", {"lineHeight": "1.4", "fontWeight": "500"}]
      },
      transitionDuration: {
        '250': '250ms',
        '350': '350ms'
      },
      transitionTimingFunction: {
        'smooth-expand': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'smooth-collapse': 'cubic-bezier(0.4, 0, 0.2, 1)'
      },
      animation: {
        'expand-height': 'expandHeight 250ms ease-out forwards',
        'collapse-height': 'collapseHeight 250ms ease-in forwards',
        'fade-in': 'fadeIn 250ms ease-out',
        'scale-in': 'scaleIn 250ms ease-out'
      }
    }
  },
  plugins: []
}

