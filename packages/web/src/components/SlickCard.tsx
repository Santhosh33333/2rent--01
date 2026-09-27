import { motion } from 'motion/react';

interface SlickCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  variant?: 'glass' | 'dark' | 'primary';
}

export function SlickCard({ children, className = '', delay = 0, variant = 'glass' }: SlickCardProps) {
  const styles = {
    glass: 'bg-surface-50/40 dark:bg-surface-900/40 backdrop-blur-2xl border border-white/20 dark:border-surface-800/50 shadow-xl',
    dark: 'bg-surface-950 border border-surface-800 shadow-2xl',
    primary: 'bg-primary-600 text-white border border-primary-400/30 shadow-primary-500/20',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`${styles[variant]} ${className} rounded-3xl p-6 overflow-hidden relative group`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      {children}
    </motion.div>
  );
}