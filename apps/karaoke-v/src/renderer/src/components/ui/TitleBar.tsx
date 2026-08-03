import { X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { IconButton } from "./IconButton"

export function TitleBar({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useTranslation()

  return (
    <header className="drag-region flex h-7.5 flex-none select-none items-center gap-2 bg-titlebar pr-1.5 pl-3">
      <span className="min-w-0 flex-1 truncate text-2xs leading-none font-medium text-muted">
        {title}
      </span>
      <IconButton
        className="no-drag size-5.5 rounded"
        title={t("common.close")}
        aria-label={t("common.close")}
        onClick={onClose}
      >
        <X size={13} strokeWidth={2.25} aria-hidden="true" />
      </IconButton>
    </header>
  )
}
