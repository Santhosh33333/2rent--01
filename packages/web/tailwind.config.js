/** @type {import('tailwindcss').Config} */
// Brand colors are runtime CSS variables (--c-50..--c-950) styled per accent
// theme via `html[data-accent="..."]`, so the whole app follows the chosen
// theme without rebuilding utility classes.
const accentScale = {
  50: 'rgb(var(--c-50) / <alpha-value>)',
  100: 'rgb(var(--c-100) / <alpha-value>)',
  200: 'rgb(var(--c-200) / <alpha-value>)',
  300: 'rgb(var(--c-300) / <alpha-value>)',
  400: 'rgb(var(--c-400) / <alpha-value>)',
  500: 'rgb(var(--c-500) / <alpha-value>)',
  600: 'rgb(var(--c-600) / <alpha-value>)',
  700: 'rgb(var(--c-700) / <alpha-value>)',
  800: 'rgb(var(--c-800) / <alpha-value>)',
  900: 'rgb(var(--c-900) / <alpha-value>)',
  950: 'rgb(var(--c-950) / <alpha-value>)',
}

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: accentScale,
        // Legacy page classes continue to resolve into the current brand.
        indigo: accentScale,
        violet: accentScale,
        purple: accentScale,
        accent: {
          50: '#f8ffd9',
          100: '#eeffad',
          200: '#e1ff70',
          300: '#d2f53c',
          400: '#b9dc20',
          500: '#92b51a',
          600: '#708d14',
          700: '#556c16',
          800: '#435518',
          900: '#394819',
        },
        surface: {
          50: '#fbf7ef',
          100: '#f2ece0',
          200: '#e4dacb',
          300: '#cfc1ae',
          400: '#9d8f7e',
          500: '#716457',
          600: '#554b42',
          700: '#3d3732',
          800: '#292522',
          900: '#1c1917',
          950: '#12100f',
        },
        success: {
          50: '#f0fdf4',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
        },
        warning: {
          50: '#fffbeb',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        danger: {
          50: '#fef2f2',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        'glass': '0 2px 8px rgba(30, 41, 36, 0.04)',
        'glass-lg': '0 6px 18px rgba(30, 41, 36, 0.07)',
        'glass-xl': '0 10px 28px rgba(30, 41, 36, 0.1)',
        'glow': '0 2px 10px rgba(13, 55, 139, 0.14)',
        'glow-lg': '0 4px 16px rgba(13, 55, 139, 0.22)',
        'glow-accent': '0 2px 10px rgba(210, 245, 60, 0.18)',
        'beacon': '0 0 0 1px rgba(216,245,60,0.25), 0 8px 24px -10px rgba(13, 55, 139, 0.45)',
        'card': '0 1px 3px 0 rgba(0, 0, 0, 0.03), 0 1px 2px -1px rgba(0, 0, 0, 0.03)',
        'card-hover': '0 8px 25px -5px rgba(0, 0, 0, 0.08), 0 4px 10px -6px rgba(0, 0, 0, 0.04)',
        'card-dark': '0 1px 3px 0 rgba(0, 0, 0, 0.2), 0 1px 2px -1px rgba(0, 0, 0, 0.2)',
        'card-dark-hover': '0 8px 25px -5px rgba(0, 0, 0, 0.4), 0 4px 10px -6px rgba(0, 0, 0, 0.2)',
        'float': '0 20px 60px -15px rgba(0, 0, 0, 0.15)',
        'float-dark': '0 20px 60px -15px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in-up': 'fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in-down': 'fadeInDown 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slideInRight 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'float': 'float 1.8s ease-in-out 2 alternate',
        'slide-up': 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          '0%': { opacity: '0', transform: 'translateY(-16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        float: {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-6px)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(100%)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-100%)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backdropBlur: {
        xs: '2px',
        '3xl': '64px',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'gradient-mesh': 'radial-gradient(at 12% 18%, hsla(222, 78%, 55%, 0.14) 0px, transparent 50%), radial-gradient(at 88% 6%, hsla(74, 90%, 62%, 0.10) 0px, transparent 50%), radial-gradient(at 0% 92%, hsla(220, 60%, 30%, 0.08) 0px, transparent 50%)',
      },
    },
  },
  plugins: [],
}
