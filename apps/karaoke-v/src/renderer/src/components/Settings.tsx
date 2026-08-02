import { useEffect, useState } from "react"
import {
  GLOW_LIMITS,
  type GlowPreferences,
  mergePreferences,
  PARTICLE_LIMITS,
  type ParticleDirection,
  type ParticlePreferences,
  type Preferences,
  type PreferencesPatch,
} from "../../../shared/preferences"
import { EffectPreview } from "./EffectPreview"
import { ColorInput } from "./ui/ColorInput"
import { EffectAccordion } from "./ui/EffectAccordion"
import { NavItem } from "./ui/NavItem"
import { ScrollArea } from "./ui/ScrollArea"
import { Segmented } from "./ui/Segmented"
import { SettingRow } from "./ui/SettingRow"
import { Slider } from "./ui/Slider"
import { Switch } from "./ui/Switch"

// Left-hand nav sections. Adding a section means adding an entry here and a
// case in SectionBody.
const SECTIONS = [
  { id: "general", label: "일반" },
  { id: "effects", label: "노트 이펙트" },
] as const

type SectionId = (typeof SECTIONS)[number]["id"]

const DIRECTION_OPTIONS: readonly { value: ParticleDirection; label: string }[] = [
  { value: "directional", label: "한 방향" },
  { value: "radial", label: "방사형" },
]

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
  const update = (patch: PreferencesPatch) => {
    setPrefs((p) => (p ? mergePreferences(p, patch) : p))
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

      {/* The column itself does not scroll — a section decides which of its own
          parts do, so the effects preview can stay put while the rest moves. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden px-6 py-5">
        <h1 className="mb-2 flex-none select-none text-base font-medium">{section?.label}</h1>
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
  update: (patch: PreferencesPatch) => void
}) {
  switch (id) {
    case "general":
      return (
        <ScrollArea className="min-h-0 flex-1">
          <SettingRow
            label="디버깅 모드 활성화"
            description="디버깅에 도움을 줄 수 있는 정보를 화면에 표시 합니다."
          >
            <Switch
              checked={prefs.debug}
              onChange={(e) => update({ debug: e.currentTarget.checked })}
            />
          </SettingRow>
        </ScrollArea>
      )
    case "effects":
      return <EffectsSection prefs={prefs} update={update} />
  }
}

function EffectsSection({
  prefs,
  update,
}: {
  prefs: Preferences
  update: (patch: PreferencesPatch) => void
}) {
  const { particles, glow } = prefs
  const [open, setOpen] = useState({ glow: true, particles: true })
  // The two spread sliders mean different things per mode, so their rows are
  // labelled from it.
  const radial = particles.direction === "radial"

  const setParticles = (patch: Partial<ParticlePreferences>) => update({ particles: patch })
  const setGlow = (patch: Partial<GlowPreferences>) => update({ glow: patch })

  const particleSlider = (key: keyof typeof PARTICLE_LIMITS, readout: string) => (
    <Slider
      {...PARTICLE_LIMITS[key]}
      value={particles[key]}
      readout={readout}
      onChange={(e) => setParticles({ [key]: e.currentTarget.valueAsNumber })}
    />
  )
  const glowSlider = (key: keyof typeof GLOW_LIMITS, readout: string) => (
    <Slider
      {...GLOW_LIMITS[key]}
      value={glow[key]}
      readout={readout}
      onChange={(e) => setGlow({ [key]: e.currentTarget.valueAsNumber })}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none pb-4">
        <EffectPreview particles={particles} glow={glow} />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <EffectAccordion
          title="하이라이트"
          description="노트가 시작될 때 터지고, 소리가 나는 동안 유지되는 빛입니다."
          open={open.glow}
          onOpenChange={(v) => setOpen((s) => ({ ...s, glow: v }))}
          enabled={glow.enabled}
          onEnabledChange={(v) => setGlow({ enabled: v })}
        >
          <SettingRow label="밝기" description="소리가 나는 동안 유지되는 밝기입니다.">
            {glowSlider("level", `${Math.round(glow.level * 100)}%`)}
          </SettingRow>
          <SettingRow
            label="번쩍임 길이"
            description="노트가 시작될 때의 섬광이 잦아드는 시간입니다."
          >
            {glowSlider("flash", `${glow.flash.toFixed(2)}초`)}
          </SettingRow>
          <SettingRow label="크기" description="노트 높이에 대한 빛의 반지름 배율입니다.">
            {glowSlider("size", `${glow.size.toFixed(1)}배`)}
          </SettingRow>
          <SettingRow label="색상" description="빛을 칠할 색상입니다.">
            <ColorInput
              value={glow.color}
              onChange={(e) => setGlow({ color: e.currentTarget.value })}
            />
          </SettingRow>
        </EffectAccordion>

        <EffectAccordion
          title="파티클"
          description="플레이헤드가 노트를 지나며 흩뿌리는 불꽃입니다."
          open={open.particles}
          onOpenChange={(v) => setOpen((s) => ({ ...s, particles: v }))}
          enabled={particles.enabled}
          onEnabledChange={(v) => setParticles({ enabled: v })}
        >
          <SettingRow label="양" description="노트가 울리는 동안 초당 방출되는 개수입니다.">
            {particleSlider("rate", `${Math.round(particles.rate)}/s`)}
          </SettingRow>
          <SettingRow label="지속 시간" description="파티클 하나가 사라지기까지 걸리는 시간입니다.">
            {particleSlider("life", `${particles.life.toFixed(2)}초`)}
          </SettingRow>
          <SettingRow label="확산 방향" description="파티클이 퍼져 나가는 방식입니다.">
            <Segmented
              value={particles.direction}
              options={DIRECTION_OPTIONS}
              onChange={(direction) => setParticles({ direction })}
            />
          </SettingRow>
          {particles.direction === "directional" && (
            <SettingRow label="각도" description="0°가 위쪽이고, 시계 방향으로 돕니다.">
              {particleSlider("angle", `${Math.round(particles.angle)}°`)}
            </SettingRow>
          )}
          <SettingRow
            label={radial ? "가로 반경" : "가로 확산"}
            description={
              radial
                ? "파티클이 좌우로 퍼져 나가는 반경입니다."
                : "파티클이 진행 방향과 직각으로 퍼지는 폭입니다."
            }
          >
            {particleSlider("spreadX", `${Math.round(particles.spreadX)}px`)}
          </SettingRow>
          <SettingRow
            label={radial ? "세로 반경" : "이동 거리"}
            description={
              radial
                ? "파티클이 위아래로 퍼져 나가는 반경입니다."
                : "파티클이 진행 방향으로 나아가는 거리입니다."
            }
          >
            {particleSlider("spreadY", `${Math.round(particles.spreadY)}px`)}
          </SettingRow>
          <SettingRow label="시작점 너비" description="파티클이 생겨나는 지점의 가로 폭입니다.">
            {particleSlider("originX", `${Math.round(particles.originX)}px`)}
          </SettingRow>
          <SettingRow label="색상" description="파티클을 칠할 색상입니다.">
            <ColorInput
              value={particles.color}
              onChange={(e) => setParticles({ color: e.currentTarget.value })}
            />
          </SettingRow>
        </EffectAccordion>
      </ScrollArea>
    </div>
  )
}
