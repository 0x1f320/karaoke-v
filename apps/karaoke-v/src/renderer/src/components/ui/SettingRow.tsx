import type { ReactNode } from "react"

// One settings entry: label (and optional description) on the left, its control
// on the right. Rows are separated by a rule, except the last in a group.
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 select-none">
        <div className="text-sm">{label}</div>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {children && <div className="flex-none">{children}</div>}
    </div>
  )
}
