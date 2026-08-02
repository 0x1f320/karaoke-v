import { BookmarkPlus, Check, SlidersHorizontal, Sparkles, Trash2, Undo2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  DEFAULT_EFFECTS,
  type EffectPreset,
  type EffectSettings,
  GLOW_LIMITS,
  type GlowPreferences,
  type GlowShape,
  mergePreferences,
  PARTICLE_LIMITS,
  type ParticleDirection,
  type ParticlePreferences,
  PRESET_LIMITS,
  type Preferences,
  type PreferencesPatch,
  sameEffects,
} from "../../../shared/preferences"
import { EffectPreview } from "./EffectPreview"
import { Button } from "./ui/Button"
import { ColorInput } from "./ui/ColorInput"
import { Dialog, DialogActions } from "./ui/Dialog"
import { EffectAccordion } from "./ui/EffectAccordion"
import { IconButton } from "./ui/IconButton"
import { NavItem } from "./ui/NavItem"
import { ScrollArea } from "./ui/ScrollArea"
import { Segmented } from "./ui/Segmented"
import { Select, SelectItem } from "./ui/Select"
import { SettingRow } from "./ui/SettingRow"
import { Slider } from "./ui/Slider"
import { Switch } from "./ui/Switch"
import { TextInput } from "./ui/TextInput"

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

const SHAPE_OPTIONS: readonly { value: GlowShape; label: string }[] = [
  { value: "bloom", label: "원형" },
  { value: "cross", label: "십자" },
  { value: "x", label: "X자" },
  { value: "star", label: "별" },
]

// Picker entries that are not presets. Neither can collide with a preset id:
// those are UUIDs.
const DEFAULT_ENTRY = "default"
/** Shown only while the draft matches nothing on the list, and never selectable. */
const CUSTOM_ENTRY = "custom"

export function Settings() {
  const [active, setActive] = useState<SectionId>("general")
  // One state, and it is the live one: every control writes straight through,
  // so what this panel shows is what the overlay is drawing. Whether a setting
  // is kept is a separate question, and the only thing that asks it is the
  // preset bar — see EffectsSection.
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  // Our own writes come back as broadcasts, and out of step with the local
  // state: mid-drag, adopting the echo of the update before last would snap the
  // slider backwards. So while any write of ours is outstanding the local value
  // is the truth; once things are quiet, another window's change is welcome.
  const outstanding = useRef(0)
  const section = SECTIONS.find((s) => s.id === active)

  useEffect(() => {
    window.preferences.get().then(setPrefs)
    return window.preferences.onChange((p) => {
      if (outstanding.current === 0) {
        setPrefs(p)
      }
    })
  }, [])

  // Applied locally first so the control responds at once, then written.
  const update = (patch: PreferencesPatch) => {
    setPrefs((p) => (p ? mergePreferences(p, patch) : p))
    outstanding.current += 1
    window.preferences.update(patch).finally(() => {
      outstanding.current -= 1
    })
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
          <div className="px-6 pb-5">
            <SettingRow
              label="디버깅 모드 활성화"
              description="디버깅에 도움을 줄 수 있는 정보를 화면에 표시 합니다."
            >
              <Switch
                aria-label="디버깅 모드 활성화"
                checked={prefs.debug}
                onCheckedChange={(debug) => update({ debug })}
              />
            </SettingRow>
          </div>
        </ScrollArea>
      )
    case "effects":
      return <EffectsSection prefs={prefs} update={update} />
  }
}

// The picker says what is applied; the bar underneath asks whether to keep it.
// Every control here takes effect the moment it is touched — what the bar
// offers is somewhere to put the result, not permission to have it.
function EffectsSection({
  prefs,
  update,
}: {
  prefs: Preferences
  update: (patch: PreferencesPatch) => void
}) {
  const { particles, glow, presets, activePreset } = prefs
  // Where the current values came from, and so what 저장 overwrites and
  // 되돌리기 returns to. null is the built-in defaults, which cannot be
  // overwritten — edits made against them can only become a preset of their own.
  const origin = presets.find((p) => p.id === activePreset) ?? null
  const basis = origin ?? DEFAULT_EFFECTS
  const drifted = !sameEffects(prefs, basis)
  // Which dialog is up, if any. Only one can be, so this is a single slot.
  const [dialog, setDialog] = useState<"save" | "delete" | null>(null)
  // The unnamed values are a place you can be, so they have to be a place you
  // can get back to: leaving them for a preset stows them for the session, and
  // 사용자 지정 stays on the list until they are picked back up. Without this,
  // trying another preset to compare would quietly discard the tuning.
  const [stash, setStash] = useState<(EffectSettings & { origin: string | null }) | null>(null)
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

  // A preset is named only while the values still are that preset; the moment
  // they drift, the picker says so rather than going on claiming a preset that
  // is not what you are hearing.
  const entry = drifted ? CUSTOM_ENTRY : (origin?.id ?? DEFAULT_ENTRY)

  const applyEntry = (id: string) => {
    if (id === CUSTOM_ENTRY) {
      if (stash) {
        update({ particles: stash.particles, glow: stash.glow, activePreset: stash.origin })
        setStash(null)
      }
      return
    }
    if (drifted) {
      setStash({ particles, glow, origin: activePreset })
    }
    const picked = presets.find((p) => p.id === id) ?? null
    const next = picked ?? DEFAULT_EFFECTS
    update({ particles: next.particles, glow: next.glow, activePreset: picked?.id ?? null })
  }

  /** Back to what the origin holds, staying on it. */
  const revert = () => update({ particles: basis.particles, glow: basis.glow })

  /** Put the current values back on the preset they came from. */
  const overwriteOrigin = () => {
    if (origin) {
      update({
        presets: presets.map((p) => (p.id === origin.id ? { ...p, particles, glow } : p)),
      })
    }
  }

  const savePreset = (name: string) => {
    // Same name means the same preset: two entries reading alike in the picker
    // would leave no way to tell which is which.
    const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase())
    const id = existing?.id ?? crypto.randomUUID()
    update({
      presets: existing
        ? presets.map((p) => (p.id === id ? { ...p, particles, glow } : p))
        : [...presets, { id, name, particles, glow }],
      // Saved and selected in one move: the values are that preset now, so
      // leaving the picker on 사용자 지정 would be a lie.
      activePreset: id,
    })
    setDialog(null)
  }

  const deleteOrigin = () => {
    if (origin) {
      // Nothing is left pointing at it — dropping to 기본 설정 is the same
      // landing the picker would give, and mergePreferences would clear a
      // dangling id anyway.
      update({
        presets: presets.filter((p) => p.id !== origin.id),
        particles: DEFAULT_EFFECTS.particles,
        glow: DEFAULT_EFFECTS.glow,
        activePreset: null,
      })
    }
    setDialog(null)
  }

  const particleSlider = (key: keyof typeof PARTICLE_LIMITS, readout: string) => (
    <Slider
      {...PARTICLE_LIMITS[key]}
      value={particles[key]}
      readout={readout}
      onValueChange={(value) => setParticles({ [key]: value })}
    />
  )
  const glowSlider = (key: keyof typeof GLOW_LIMITS, readout: string) => (
    <Slider
      {...GLOW_LIMITS[key]}
      value={glow[key]}
      readout={readout}
      onValueChange={(value) => setGlow({ [key]: value })}
    />
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* The picker sits under the preview rather than in the list below,
          because it is not one more setting: it sets all of them at once, and
          what it changes is the thing directly above it. */}
      <div className="flex-none px-6 pb-4">
        <EffectPreview particles={particles} glow={glow} />
        <div className="mt-2 flex items-center gap-1.5">
          <Select
            className="min-w-0 flex-1"
            aria-label="프리셋"
            value={entry}
            onValueChange={applyEntry}
          >
            {/* The values that belong to no preset. On the list whenever there
                are any — the ones in effect now, or the ones set aside when a
                preset was tried out. */}
            {(drifted || stash) && <SelectItem value={CUSTOM_ENTRY}>사용자 지정</SelectItem>}
            <SelectItem value={DEFAULT_ENTRY}>기본 설정</SelectItem>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </Select>
          {/* Only for what the picker is actually naming: while the values have
              drifted it reads 사용자 지정, and a delete that reached past that
              to the preset behind it would be a trap. */}
          <IconButton
            tone="danger"
            className="size-7 flex-none rounded disabled:opacity-20"
            disabled={drifted || !origin}
            title="프리셋 삭제"
            aria-label="프리셋 삭제"
            onClick={() => setDialog("delete")}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* Extra room at the bottom while the bar is up, so the last row can
            still be scrolled out from under it. */}
        <div className={`px-6 ${drifted ? "pb-20" : "pb-5"}`}>
          <EffectAccordion
            title="하이라이트"
            description="노트가 시작될 때 터지고, 소리가 나는 동안 유지되는 빛입니다."
            open={!collapsed.glow}
            onOpenChange={toggle("glow")}
            enabled={glow.enabled}
            onEnabledChange={(v) => setGlow({ enabled: v })}
          >
            <SettingRow label="모양" description="빛이 퍼져 나가는 형태입니다.">
              <Segmented
                aria-label="모양"
                value={glow.shape}
                options={SHAPE_OPTIONS}
                onChange={(shape) => setGlow({ shape })}
              />
            </SettingRow>
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
                aria-label="확산 방향"
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
          once the values have drifted off the preset they came from. It is not
          asking whether to apply them — they are already applied — only where
          to keep them. The gradient is what keeps the rows passing underneath
          legible; it is click-through, so only the text and the buttons take
          the pointer. */}
      {drifted && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-linear-to-t from-app from-55% to-transparent px-6 pt-10 pb-5">
          <span className="pointer-events-auto mr-auto select-none text-xs text-muted">
            {origin ? `'${origin.name}'에서 변경되었습니다.` : "기본 설정에서 변경되었습니다."}
          </span>
          <Button className="pointer-events-auto" onClick={revert}>
            <Undo2 size={13} strokeWidth={2} aria-hidden="true" />
            되돌리기
          </Button>
          <Button
            className="pointer-events-auto"
            disabled={presets.length >= PRESET_LIMITS.count}
            onClick={() => setDialog("save")}
          >
            <BookmarkPlus size={13} strokeWidth={2} aria-hidden="true" />
            별도 프리셋으로 저장
          </Button>
          {/* Absent rather than disabled on the defaults: there is no such
              thing as overwriting them, so offering it greyed out would only
              pose a question with no answer. */}
          {origin && (
            <Button className="pointer-events-auto" tone="primary" onClick={overwriteOrigin}>
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
              저장
            </Button>
          )}
        </div>
      )}

      {dialog === "save" && (
        <SavePresetDialog presets={presets} onSave={savePreset} onClose={() => setDialog(null)} />
      )}
      {dialog === "delete" && origin && (
        <Dialog
          title="프리셋 삭제"
          description={`'${origin.name}'을(를) 삭제합니다. 되돌릴 수 없습니다.`}
          onClose={() => setDialog(null)}
        >
          <DialogActions>
            <Button onClick={() => setDialog(null)}>취소</Button>
            <Button tone="danger" onClick={deleteOrigin}>
              삭제
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  )
}

/** Names the current values and puts them on the preset list as their own entry. */
function SavePresetDialog({
  presets,
  onSave,
  onClose,
}: {
  presets: EffectPreset[]
  onSave: (name: string) => void
  onClose: () => void
}) {
  // Suggested rather than blank: naming a look is work, and most of the time
  // the number is answer enough.
  const [name, setName] = useState(() => {
    const taken = new Set(presets.map((p) => p.name))
    let n = presets.length + 1
    while (taken.has(`프리셋 ${n}`)) {
      n += 1
    }
    return `프리셋 ${n}`
  })

  const trimmed = name.trim().slice(0, PRESET_LIMITS.nameLength)
  const overwriting = presets.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())

  return (
    <Dialog
      title="별도 프리셋으로 저장"
      description="지금 적용된 이펙트 설정을 이름 붙여 보관합니다."
      onClose={onClose}
    >
      {/* A form, so Enter submits the way it does in every other dialog. */}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) {
            onSave(trimmed)
          }
        }}
      >
        <div className="flex flex-col gap-1.5">
          <TextInput
            // The dialog exists to take this one value; anything else to focus
            // first would just be in the way.
            autoFocus
            value={name}
            maxLength={PRESET_LIMITS.nameLength}
            placeholder="프리셋 이름"
            aria-label="프리셋 이름"
            onChange={(e) => setName(e.currentTarget.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          {overwriting && (
            <p className="select-none text-2xs text-muted">
              같은 이름의 프리셋이 이미 있습니다. 덮어쓰게 됩니다.
            </p>
          )}
        </div>
        <DialogActions>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" tone="primary" disabled={!trimmed}>
            {overwriting ? "덮어쓰기" : "저장"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
