import { Check, ExternalLink, KeyRound } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "./ui/Button"

const STEPS = [
  "아래 버튼으로 시스템 설정의 '손쉬운 사용' 항목을 엽니다.",
  "목록에서 karaoke-v를 찾아 스위치를 켭니다.",
  "이 창으로 돌아와 시작하기를 누릅니다.",
]

export function Permissions() {
  const [granted, setGranted] = useState(false)

  useEffect(() => {
    window.permissions.get().then((s) => setGranted(s.accessibility))
    return window.permissions.onChange((s) => setGranted(s.accessibility))
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-app px-8 py-7 text-fg antialiased">
      <h1 className="select-none text-base font-medium">
        {granted ? "이제 시작할 수 있습니다" : "시작하려면 권한이 하나 필요합니다"}
      </h1>

      <p className="mt-2 select-none text-xs leading-relaxed text-muted">
        karaoke-v는 SynthV 창의 피아노 롤을 읽어 그 위에 노트 이펙트를 겹쳐 그립니다. 화면을
        녹화하거나 다른 앱의 내용을 읽지는 않습니다.
      </p>

      <div className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-titlebar px-4 py-3.5">
        <KeyRound
          size={20}
          strokeWidth={1.75}
          aria-hidden="true"
          className={`flex-none ${granted ? "text-accent" : "text-muted"}`}
        />
        <div className="min-w-0 select-none">
          <div className="text-sm">손쉬운 사용</div>
          <p className="mt-0.5 text-xs text-muted">노트의 위치를 읽는 데 사용합니다. 필수입니다.</p>
        </div>
        <StatusPill granted={granted} />
      </div>

      {!granted && (
        <ol className="mt-5 flex select-none flex-col gap-2 text-xs text-muted">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-2.5">
              <span className="flex size-4.5 flex-none items-center justify-center rounded-full bg-white/5 text-2xs text-fg">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-auto flex items-center justify-end gap-2 pt-5">
        <Button onClick={() => window.permissions.openSettings()}>
          <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
          시스템 설정 열기
        </Button>
        <Button tone="primary" disabled={!granted} onClick={() => window.permissions.proceed()}>
          시작하기
        </Button>
      </div>
    </div>
  )
}

function StatusPill({ granted }: { granted: boolean }) {
  return (
    <span
      role="status"
      className={`ml-auto inline-flex flex-none select-none items-center gap-1 rounded-full px-2 py-1 text-2xs ${
        granted ? "bg-accent/15 text-accent" : "bg-warn/15 text-warn"
      }`}
    >
      {granted ? (
        <>
          <Check size={11} strokeWidth={2.75} aria-hidden="true" />
          허용됨
        </>
      ) : (
        <>
          <span className="relative flex size-1.5" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping-wide rounded-full bg-warn" />
            <span className="relative inline-flex size-full rounded-full bg-warn" />
          </span>
          기다리는 중
        </>
      )}
    </span>
  )
}
