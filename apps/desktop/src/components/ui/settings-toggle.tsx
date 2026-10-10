import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> & {
  label: ReactNode
  description?: ReactNode
}

export function SettingsToggle({ label, description, className = '', id, ...input }: Props) {
  const generatedId = useId(), inputId = id ?? generatedId
  return <div className={`settings-toggle-row ${className}`}>
    <div className="settings-toggle-copy">
      <label htmlFor={inputId}>{label}</label>
      {description && <div id={`${inputId}-description`} className="settings-toggle-description">{description}</div>}
    </div>
    <input {...input} id={inputId} type="checkbox" role="switch" className="settings-toggle" aria-describedby={description ? `${inputId}-description` : undefined}/>
  </div>
}
