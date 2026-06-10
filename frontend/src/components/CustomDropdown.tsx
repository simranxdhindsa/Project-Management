import React, { useRef, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface DropdownOption<T extends string = string> {
  value: T
  label: string
  icon?: React.ReactNode
}

interface CustomDropdownProps<T extends string = string> {
  options: DropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Icon shown before the label in the trigger */
  icon?: React.ReactNode
  /** Shown when value matches none of the options (e.g. "All Devs") */
  placeholder?: string
  className?: string
}

/**
 * Reusable dropdown following the pm-custom-dropdown pattern.
 * Drop-in replacement for native <select> across all feature pages.
 */
export function CustomDropdown<T extends string = string>({
  options,
  value,
  onChange,
  icon,
  placeholder,
  className = '',
}: CustomDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const current = options.find(o => o.value === value)
  const label = current?.label ?? placeholder ?? value

  return (
    <div ref={containerRef} className={`pm-custom-dropdown ${className}`.trim()}>
      <button className="pm-custom-dropdown-trigger" onClick={() => setOpen(o => !o)}>
        {icon}
        <span>{label}</span>
        <ChevronDown size={11} className={`dropdown-chevron${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="pm-custom-dropdown-menu">
          {options.map(opt => (
            <button
              key={opt.value}
              className={`pm-dropdown-item${value === opt.value ? ' active' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false) }}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
