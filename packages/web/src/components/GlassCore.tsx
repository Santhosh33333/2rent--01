import { motion } from 'motion/react';

/** 
 * The 3D Design System Core for Nabri Ultra
 * Based on 'Liquid Glass' and 'Kinetic Depth' principles
 */

export const GLASS_THEME = {
  surface: 'bg-surface-50/40 dark:bg-surface-950/40 backdrop-blur-3xl border border-white/20 dark:border-surface-800/50 shadow-[0_8px_32px_0_rgba(31,38,135,0.07)]',
  border: 'border-white/30 dark:border-surface-700/30',
  glow: 'shadow-[0_0_20px_rgba(var(--color-primary-rgb),0.15)]',
};

export function GlassContainer({ children, className = '', variant = 'default' }: { children: React.ReactNode, className?: string, variant?: 'default' | 'elevated' | 'sunken' }) {
  const variantStyles = {
    default: 'bg-surface-50/40 dark:bg-surface-950/40 backdrop-blur-3xl border border-white/20 dark:border-surface-800/50 shadow-xl',
    elevated: 'bg-white/60 dark:bg-surface-900/60 backdrop-blur-3xl border border-white/40 dark:border-surface-700/40 shadow-2xl ring-1 ring-white/10',
    sunken: 'bg-surface-100/30 dark:bg-surface-900/30 backdrop-blur-md border border-surface-200/50 dark:border-surface-800/50 shadow-inner',
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={`${variantStyles[variant]} ${className} rounded-3xl p-6 relative overflow-hidden`}
    >
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent pointer-events-none" />
      {children}
    </motion.div>
  );
}

export function KineticButton({ children, onClick, className = '', variant = 'primary' }: { children: React.ReactNode, onClick: () => void, className?: string, variant?: 'primary' | 'secondary' | 'danger' }) {
  const variants = {
    primary: 'bg-primary-600 text-white shadow-primary-500/30 hover:bg-primary-500',
    secondary: 'bg-surface-200 dark:bg-surface-800 text-surface-900 dark:text-white hover:bg-surface-300 dark:hover:bg-surface-700',
    danger: 'bg-red-500 text-white shadow-red-500/30 hover:bg-red-600',
  };

  return (
    <motion.button
      whileTap={{ scale: 0.92, y: 2 }}
      onClick={onClick}
      className={`px-6 py-3 rounded-2xl font-semibold transition-all duration-200 shadow-lg ${variants[variant]} ${className}`}
    >
      {children}
    </motion.button>
  );
}