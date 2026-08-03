import { Check, ExternalLink, ShieldAlert } from "lucide-react"
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
      <div className="flex select-none items-center gap-2.5">
        {granted ? (
          <Check size={18} strokeWidth={2.25} aria-hidden="true" className="text-accent" />
        ) : (
          <ShieldAlert size={18} strokeWidth={1.75} aria-hidden="true" className="text-muted" />
        )}
        <h1 className="text-base font-medium">
          {granted ? "권한이 허용되었습니다" : "손쉬운 사용 권한이 필요합니다"}
        </h1>
      </div>

      <p className="mt-3 select-none text-xs leading-relaxed text-muted">
        karaoke-v는 macOS의 손쉬운 사용(Accessibility) 권한으로 SynthV 창의 피아노 롤을 읽어, 그
        위에 노트 이펙트를 겹쳐 그립니다. 권한이 없으면 노트의 위치를 알 수 없어 아무것도 표시할 수
        없습니다. 화면을 녹화하거나 다른 앱의 내용을 읽지는 않습니다.
      </p>

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

      {granted && (
        <p className="mt-5 select-none text-xs leading-relaxed text-muted">
          이제 SynthV를 열면 karaoke-v가 자동으로 연결됩니다.
        </p>
      )}

      <div className="mt-auto flex items-center gap-2">
        <span className="mr-auto select-none text-2xs text-muted">
          {granted ? "손쉬운 사용: 허용됨" : "손쉬운 사용: 허용 안 됨"}
        </span>
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
