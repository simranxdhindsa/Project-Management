import { AlertTriangle, X } from 'lucide-react'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="confirm-modal glass-card" onClick={e => e.stopPropagation()}>
        <button className="confirm-modal-close" onClick={onCancel}>
          <X size={16} />
        </button>

        <div className={`confirm-modal-icon confirm-modal-icon--${variant}`}>
          <AlertTriangle size={28} />
        </div>

        <h3 className="confirm-modal-title">{title}</h3>
        <p className="confirm-modal-message">{message}</p>

        <div className="confirm-modal-actions">
          <button className="confirm-modal-btn confirm-modal-btn--cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`confirm-modal-btn confirm-modal-btn--${variant}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
