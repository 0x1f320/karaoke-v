import { Popover } from "radix-ui"
import { HexColorInput, HexColorPicker } from "react-colorful"
import { useTranslation } from "react-i18next"
import { useDisabled } from "./disabled"

export function ColorInput({
  value,
  onChange,
  disabled,
  className = "",
  ...props
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  "aria-label"?: string
}) {
  const { t } = useTranslation()

  return (
    <Popover.Root>
      <Popover.Trigger
        {...props}
        disabled={useDisabled(disabled)}
        style={{ backgroundColor: value }}
        className={`h-7 w-12 rounded-md border border-border outline-none inset-ring inset-ring-white/10 transition-[filter] hover:brightness-115 focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app disabled:pointer-events-none disabled:opacity-40 ${className}`.trim()}
      />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          className="flex w-56 flex-col gap-2.5 rounded-lg border border-border bg-app p-3 text-fg shadow-2xl outline-none antialiased"
        >
          <HexColorPicker className="color-picker" color={value} onChange={onChange} />
          <HexColorInput
            prefixed
            color={value}
            onChange={onChange}
            aria-label={t("common.colorCode")}
            className="w-full rounded-md border border-border bg-black/15 px-2.5 py-1.5 text-center text-xs uppercase tabular-nums text-fg outline-none focus-visible:border-accent"
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
