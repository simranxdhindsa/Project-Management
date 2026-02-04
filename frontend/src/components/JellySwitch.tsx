import { useState } from 'react'
import './JellySwitch.css'

interface JellySwitchProps {
  checked?: boolean
  onChange?: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function JellySwitch({ checked = false, onChange, label, disabled = false }: JellySwitchProps) {
  const [isChecked, setIsChecked] = useState(checked)

  const handleToggle = () => {
    if (disabled) return
    const newValue = !isChecked
    setIsChecked(newValue)
    onChange?.(newValue)
  }

  return (
    <label className={`jelly-switch-container ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        className="jelly-switch-input"
        checked={isChecked}
        onChange={handleToggle}
        disabled={disabled}
      />
      <div className={`jelly-switch ${isChecked ? 'checked' : ''}`}>
        <div className="jelly-switch-track">
          <div className="jelly-switch-thumb">
            <div className="jelly-blob"></div>
          </div>
        </div>
      </div>
      {label && <span className="jelly-switch-label">{label}</span>}
    </label>
  )
}
