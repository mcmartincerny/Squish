interface NumberControlProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: NumberControlProps) {
  return (
    <label className="control">
      <span className="control__label">{label}</span>
      <div className="control__inputs">
        <input
          className="control__slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          className="control__number"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const nextValue = Number(event.target.value)

            if (Number.isNaN(nextValue)) {
              return
            }

            onChange(clamp(nextValue, min, max))
          }}
        />
      </div>
    </label>
  )
}
