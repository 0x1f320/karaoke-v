import { useEffect, useState } from "react"
import type { Preferences } from "../../../shared/preferences"
import { ColorInput } from "./ui/ColorInput"
import { NavItem } from "./ui/NavItem"
import { SettingRow } from "./ui/SettingRow"
import { Switch } from "./ui/Switch"

// Left-hand nav sections. Adding a section means adding an entry here and a
// case in SectionBody.
const SECTIONS = [
  { id: "general", label: "일반" },
  { id: "effects", label: "노트 이펙트" },
] as const

type SectionId = (typeof SECTIONS)[number]["id"]

export function Settings() {
  const [active, setActive] = useState<SectionId>("general")
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const section = SECTIONS.find((s) => s.id === active)

  useEffect(() => {
    window.preferences.get().then(setPrefs)
    return window.preferences.onChange(setPrefs)
  }, [])

  // Applied locally first so the control responds immediately; main broadcasts
  // the stored result back and the two converge.
  const update = (patch: Partial<Preferences>) => {
    setPrefs((p) => (p ? { ...p, ...patch } : p))
    window.preferences.update(patch)
  }

  return (
    <div className="flex h-full w-full bg-app text-fg antialiased">
      <nav className="flex w-55 flex-none select-none flex-col gap-0.5 border-r border-border bg-titlebar p-2">
        {SECTIONS.map((s) => (
          <NavItem key={s.id} active={s.id === active} onClick={() => setActive(s.id)}>
            {s.label}
          </NavItem>
        ))}
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
        <h1 className="mb-2 select-none text-base font-medium">{section?.label}</h1>
        {prefs && <SectionBody id={active} prefs={prefs} update={update} />}
      </main>
    </div>
  )
}

function SectionBody({
  id,
  prefs,
  update,
}: {
  id: SectionId
  prefs: Preferences
  update: (patch: Partial<Preferences>) => void
}) {
  switch (id) {
    case "general":
      return (
        <div>
          <SettingRow
            label="디버깅 모드 활성화"
            description="디버깅에 도움을 줄 수 있는 정보를 화면에 표시 합니다."
          >
            <Switch
              checked={prefs.debug}
              onChange={(e) => update({ debug: e.currentTarget.checked })}
            />
          </SettingRow>
        </div>
      )
    case "effects":
      return (
        <div>
          <SettingRow label="노트 색상" description="노트를 채울 색상입니다.">
            <ColorInput defaultValue="#50b4ff" />
          </SettingRow>
        </div>
      )
  }
}
