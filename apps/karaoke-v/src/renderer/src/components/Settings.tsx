import { Check, SlidersHorizontal, Sparkles, Undo2 } from "lucide-react"
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
import { Button } from "./ui/Button"
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
  { id: "general", label: "일반", Icon: SlidersHorizontal },
  { id: "effects", label: "노트 이펙트", Icon: Sparkles },
] as const

type SectionId = (typeof SECTIONS)[number]["id"]

const DIRECTION_OPTIONS: readonly { value: ParticleDirection; label: string }[] = [
  { value: "directional", label: "한 방향" },
  { value: "radial", label: "방사형" },
]

/** Same values, field by field. Every preference is a flat scalar. */
function sameValues<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((key) => a[key] === b[key])
}

export function Settings() {
  const [active, setActive] = useState<SectionId>("general")
  // `saved` is what is on disk; `draft` is what the controls show. The effect
  // groups edit the draft alone and reach disk only through 저장, so tuning is
  // something you can back out of — the overlay is not repainted per slider tick
  // either, only when the values are committed.
  const [saved, setSaved] = useState<Preferences | null>(null)
  const [draft, setDraft] = useState<Preferences | null>(null)
  const section = SECTIONS.find((s) => s.id === active)

  useEffect(() => {
    window.preferences.get().then((p) => {
      setSaved(p)
      setDraft(p)
    })
    // A broadcast means someone committed. Adopt the stored value, but keep any
    // effect edits in flight: the immediate controls (below) are what normally
    // trigger this, and they must not throw away unsaved tuning.
    return window.preferences.onChange((p) => {
      setSaved(p)
      setDraft((d) => (d ? { ...d, debug: p.debug } : p))
    })
  }, [])

  // The immediate path, for controls with nothing to preview and no group to
  // commit: applied locally first so they respond at once, then written.
  const update = (patch: PreferencesPatch) => {
    setSaved((p) => (p ? mergePreferences(p, patch) : p))
    setDraft((p) => (p ? mergePreferences(p, patch) : p))
    window.preferences.update(patch)
  }

  // The draft path: edits live here until 저장 writes them.
  const edit = (patch: PreferencesPatch) => {
    setDraft((p) => (p ? mergePreferences(p, patch) : p))
  }

  return (
    <div className="flex h-full w-full bg-app text-fg antialiased">
      <nav className="flex w-55 flex-none select-none flex-col gap-0.5 border-r border-border bg-titlebar p-2">
        {SECTIONS.map(({ id, label, Icon }) => (
          <NavItem key={id} active={id === active} onClick={() => setActive(id)}>
            <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="flex-none" />
            {label}
          </NavItem>
        ))}
      </nav>

      {/* The column itself does not scroll — a section decides which of its own
          parts do, so the effects preview can stay put while the rest moves.
          It carries no padding either: the inset belongs to whatever is inside
          a scroll region, so the scrollbar can ride the window's own edge and
          the last row can scroll clear of the bottom instead of being cut by a
          band of padding it cannot reach into. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <h1 className="flex-none select-none px-6 pt-5 pb-2 text-base font-medium">
          {section?.label}
        </h1>
        {draft && saved && (
          <SectionBody
            id={active}
            draft={draft}
            saved={saved}
            update={update}
            edit={edit}
            onSave={() =>
              window.preferences.update({ particles: draft.particles, glow: draft.glow })
            }
            onRevert={() =>
              setDraft((d) => (d ? { ...d, particles: saved.particles, glow: saved.glow } : d))
            }
          />
        )}
      </main>
    </div>
  )
}

function SectionBody({
  id,
  draft,
  saved,
  update,
  edit,
  onSave,
  onRevert,
}: {
  id: SectionId
  draft: Preferences
  saved: Preferences
  /** Write straight through. */
  update: (patch: PreferencesPatch) => void
  /** Change the draft only. */
  edit: (patch: PreferencesPatch) => void
  onSave: () => void
  onRevert: () => void
}) {
  switch (id) {
    case "general":
      return (
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-6 pb-5">
            <SettingRow
              label="디버깅 모드 활성화"
              description="디버깅에 도움을 줄 수 있는 정보를 화면에 표시 합니다."
            >
              <Switch
                checked={draft.debug}
                onChange={(e) => update({ debug: e.currentTarget.checked })}
              />
            </SettingRow>
          </div>
        </ScrollArea>
      )
    case "effects":
      return (
        <EffectsSection
          prefs={draft}
          saved={saved}
          update={edit}
          onSave={onSave}
          onRevert={onRevert}
        />
      )
  }
}

function EffectsSection({
  prefs,
  saved,
  update,
  onSave,
  onRevert,
}: {
  prefs: Preferences
  saved: Preferences
  update: (patch: PreferencesPatch) => void
  onSave: () => void
  onRevert: () => void
}) {
  const { particles, glow } = prefs
  const dirty = !sameValues(particles, saved.particles) || !sameValues(glow, saved.glow)
  // Tracked as what the user has closed, so a group is open unless they said
  // otherwise — including any group added later.
  const [collapsed, setCollapsed] = useState<Partial<Record<"glow" | "particles", boolean>>>({})
  const toggle = (group: "glow" | "particles") => (open: boolean) =>
    setCollapsed((s) => ({ ...s, [group]: !open }))
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-6 pb-4">
        <EffectPreview particles={particles} glow={glow} />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* Extra room at the bottom while the bar is up, so the last row can
            still be scrolled out from under it. */}
        <div className={`px-6 ${dirty ? "pb-20" : "pb-5"}`}>
          <EffectAccordion
            title="하이라이트"
            description="노트가 시작될 때 터지고, 소리가 나는 동안 유지되는 빛입니다."
            open={!collapsed.glow}
            onOpenChange={toggle("glow")}
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
            <SettingRow
              label="지터"
              description="소리가 나는 동안 빛이 부들부들 떨리는 정도입니다. 0이면 흔들리지 않습니다."
            >
              {glowSlider("jitter", `${Math.round(glow.jitter * 100)}%`)}
            </SettingRow>
            {glow.jitter > 0 && (
              <SettingRow label="지터 속도" description="빛이 떨리는 빠르기입니다.">
                {glowSlider("jitterRate", `${Math.round(glow.jitterRate)}회/초`)}
              </SettingRow>
            )}
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
            open={!collapsed.particles}
            onOpenChange={toggle("particles")}
            enabled={particles.enabled}
            onEnabledChange={(v) => setParticles({ enabled: v })}
          >
            {/* First: it decides what two of the rows below even mean, and the
                angle stays pinned to it — a mode and its one parameter split up
                by unrelated sliders would read as unrelated settings. */}
            <SettingRow label="확산 방향" description="파티클이 퍼져 나가는 방식입니다.">
              <Segmented
                name="particle-direction"
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
            <SettingRow label="양" description="노트가 울리는 동안 초당 방출되는 개수입니다.">
              {particleSlider("rate", `${Math.round(particles.rate)}/s`)}
            </SettingRow>
            <SettingRow
              label="지속 시간"
              description="파티클 하나가 사라지기까지 걸리는 시간입니다."
            >
              {particleSlider("life", `${particles.life.toFixed(2)}초`)}
            </SettingRow>
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
        </div>
      </ScrollArea>

      {/* Floats over the list rather than taking a strip out of it, and only
          once there is something to commit. The gradient is what keeps the rows
          passing underneath legible; it is click-through, so only the text and
          the two buttons take the pointer. */}
      {dirty && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-linear-to-t from-app from-55% to-transparent px-6 pt-10 pb-5">
          <span className="pointer-events-auto mr-auto select-none text-xs text-muted">
            저장하지 않은 변경 사항이 있습니다.
          </span>
          <Button className="pointer-events-auto" onClick={onRevert}>
            <Undo2 size={13} strokeWidth={2} aria-hidden="true" />
            되돌리기
          </Button>
          <Button className="pointer-events-auto" tone="primary" onClick={onSave}>
            <Check size={13} strokeWidth={2.5} aria-hidden="true" />
            저장
          </Button>
        </div>
      )}
    </div>
  )
}
