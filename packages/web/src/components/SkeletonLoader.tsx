interface SkeletonLoaderProps {
  lines?: number
  className?: string
  variant?: 'text' | 'card' | 'avatar' | 'list' | 'table' | 'grid'
}

export function SkeletonLoader({ lines = 3, className = '', variant = 'text' }: SkeletonLoaderProps) {
  if (variant === 'card') {
    return (
      <div className={`glass-card-static space-y-4 ${className}`}>
        <div className="skeleton h-5 w-1/3 rounded-xl" />
        <div className="skeleton h-8 w-1/2 rounded-xl" />
        <div className="skeleton h-4 w-2/3 rounded-xl" />
      </div>
    )
  }

  if (variant === 'avatar') {
    return (
      <div className={`flex items-center gap-4 ${className}`}>
        <div className="skeleton w-12 h-12 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-1/3 rounded-xl" />
          <div className="skeleton h-3 w-1/2 rounded-xl" />
        </div>
      </div>
    )
  }

  if (variant === 'list') {
    return (
      <div className={`space-y-3 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-2xl">
            <div className="skeleton w-10 h-10 rounded-xl flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-2/5 rounded-lg" />
              <div className="skeleton h-3 w-3/5 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'table') {
    return (
      <div className={`space-y-2 ${className}`}>
        {/* Header */}
        <div className="flex gap-3 p-3 rounded-2xl">
          <div className="skeleton h-4 w-1/4 rounded-lg" />
          <div className="skeleton h-4 w-1/4 rounded-lg" />
          <div className="skeleton h-4 w-1/4 rounded-lg" />
          <div className="skeleton h-4 w-1/4 rounded-lg" />
        </div>
        {/* Rows */}
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex gap-3 p-3 rounded-2xl">
            <div className="skeleton h-4 w-1/4 rounded-lg" />
            <div className="skeleton h-4 w-1/4 rounded-lg" />
            <div className="skeleton h-4 w-1/4 rounded-lg" />
            <div className="skeleton h-4 w-1/4 rounded-lg" />
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'grid') {
    return (
      <div className={`grid grid-cols-2 gap-4 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="glass-card-static p-4 space-y-3">
            <div className="skeleton h-32 w-full rounded-xl" />
            <div className="skeleton h-4 w-2/3 rounded-lg" />
            <div className="skeleton h-3 w-4/5 rounded-lg" />
            <div className="skeleton h-8 w-full rounded-lg" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-3.5 rounded-xl"
          style={{ width: `${85 - i * 15}%` }}
        />
      ))}
    </div>
  )
}
