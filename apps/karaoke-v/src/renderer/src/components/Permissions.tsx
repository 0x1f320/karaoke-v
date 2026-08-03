import { Check, ChevronRight, ExternalLink, KeyRound } from "lucide-react"
import { Collapsible } from "radix-ui"
import { useEffect, useRef, useState } from "react"
import type { PermissionKey } from "../../../shared/permissions"
import { Button } from "./ui/Button"

const ACCESSIBILITY_STEPS = [
  "'시스템 설정 열기'를 눌러 손쉬운 사용 항목을 엽니다.",
  "목록에서 karaoke-v를 찾아 스위치를 켭니다.",
  "이 창으로 돌아와 시작하기를 누릅니다.",
]

export function Permissions() {
  const [granted, setGranted] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.permissions.get().then((s) => setGranted(s.accessibility))
    return window.permissions.onChange((s) => setGranted(s.accessibility))
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    const observer = new ResizeObserver(() => window.permissions.resize(root.offsetHeight))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="flex w-full flex-col bg-app px-8 py-7 text-fg antialiased">
      <h1 className="select-none text-base font-medium">
        {granted ? "이제 시작할 수 있습니다" : "시작하려면 권한이 하나 필요합니다"}
      </h1>

      <p className="mt-2 select-none text-xs leading-relaxed text-muted">
        특수화된 기능을 사용하기 위해 다음과 같은 권한이 필요합니다.
      </p>

      <div className="mt-5 flex flex-col gap-2">
        <PermissionCard
          permission="accessibility"
          title="손쉬운 사용"
          description="노트의 위치를 읽기 위해 필요한 권한입니다."
          steps={ACCESSIBILITY_STEPS}
          granted={granted}
        />
      </div>

      <div className="mt-6 flex justify-end">
        <Button tone="primary" disabled={!granted} onClick={() => window.permissions.proceed()}>
          시작하기
        </Button>
      </div>
    </div>
  )
}

function PermissionCard({
  permission,
  title,
  description,
  steps,
  granted,
}: {
  permission: PermissionKey
  title: string
  description: string
  steps: readonly string[]
  granted: boolean
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-lg border border-border bg-titlebar px-4 py-3.5">
      <div className="flex items-center gap-3">
        <KeyRound
          size={20}
          strokeWidth={1.75}
          aria-hidden="true"
          className={`flex-none ${granted ? "text-accent" : "text-muted"}`}
        />
        <div className="min-w-0 flex-1 select-none">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm">{title}</span>
            <Status granted={granted} />
          </div>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
        <Button
          className="flex-none"
          aria-label={`${title} 시스템 설정 열기`}
          onClick={() => window.permissions.openSettings(permission)}
        >
          <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
          시스템 설정 열기
        </Button>
      </div>

      {!granted && (
        <Collapsible.Root open={open} onOpenChange={setOpen}>
          <Collapsible.Trigger className="group mt-2.5 flex select-none items-center gap-1 text-muted text-xs outline-none transition-colors hover:text-fg focus-visible:text-fg">
            <ChevronRight
              size={13}
              strokeWidth={2}
              aria-hidden="true"
              className="transition-transform group-data-[state=open]:rotate-90"
            />
            허용하는 방법
          </Collapsible.Trigger>
          <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse-up data-[state=open]:animate-collapse-down">
            <ol className="mt-3 flex select-none flex-col gap-2.5 text-xs text-muted">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-2">
                  <span className="flex size-4 flex-none items-center justify-center rounded-full bg-white/5 text-2xs text-fg">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </div>
  )
}

function Status({ granted }: { granted: boolean }) {
  return (
    <span
      role="status"
      className={`inline-flex flex-none select-none items-center gap-1.5 text-2xs ${
        granted ? "text-accent" : "text-warn"
      }`}
    >
      {granted ? (
        <>
          허용됨
          <Check size={11} strokeWidth={2.75} aria-hidden="true" />
        </>
      ) : (
        <>
          기다리는 중
          <span className="relative flex size-1.5" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping-wide rounded-full bg-warn" />
            <span className="relative inline-flex size-full rounded-full bg-warn" />
          </span>
        </>
      )}
    </span>
  )
}
