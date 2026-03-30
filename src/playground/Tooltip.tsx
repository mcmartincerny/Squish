interface TooltipProps {
  label: string
  content: string
}

export function Tooltip({ label, content }: TooltipProps) {
  return (
    <div className="tooltip">
      <button className="tooltip__trigger" type="button" aria-label={label}>
        <span className="tooltip__triggerLabel">{label}</span>
        <span className="tooltip__triggerIcon" aria-hidden="true">
          i
        </span>
      </button>
      <div className="tooltip__content" role="tooltip">
        <strong>{label}</strong>
        <p>{content}</p>
      </div>
    </div>
  )
}
