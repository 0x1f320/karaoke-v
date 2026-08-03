import { BookmarkPlus, Check, SlidersHorizontal, Sparkles, Trash2, Undo2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  LANGUAGE_LABELS,
  LANGUAGE_PREFERENCES,
  type LanguagePreference,
} from "../../../shared/language"
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
import { TitleBar } from "./ui/TitleBar"

// Left-hand nav sections. Adding a section means adding an entry here, a case in
// SectionBody, and a label under settings.sections.
const SECTIONS = [
  { id: "general", Icon: SlidersHorizontal },
  { id: "effects", Icon: Sparkles },
] as const

type SectionId = (typeof SECTIONS)[number]["id"]

const DIRECTIONS: readonly ParticleDirection[] = ["directional", "radial"]

const SHAPES: readonly GlowShape[] = ["bloom", "cross", "x", "star"]

// Picker entries that are not presets. Neither can collide with a preset id:
// those are UUIDs.
const DEFAULT_ENTRY = "default"
/** Shown only while the draft matches nothing on the list, and never selectable. */
const CUSTOM_ENTRY = "custom"

export function Settings() {
  const { t } = useTranslation()
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
    <div className="flex h-full w-full flex-col bg-app text-fg antialiased">
      {window.settings.customTitleBar && (
        <TitleBar title={t("settings.title")} onClose={() => window.settings.close()} />
      )}
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-55 flex-none select-none flex-col gap-0.5 border-r border-border bg-titlebar p-2">
          {SECTIONS.map(({ id, Icon }) => (
            <NavItem key={id} active={id === active} onClick={() => setActive(id)}>
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="flex-none" />
              {t(`settings.sections.${id}`)}
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
            {t(`settings.sections.${active}`)}
          </h1>
          {prefs && <SectionBody id={active} prefs={prefs} update={update} />}
        </main>
      </div>
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
      return <GeneralSection prefs={prefs} update={update} />
    case "effects":
      return <EffectsSection prefs={prefs} update={update} />
  }
}

function GeneralSection({
  prefs,
  update,
}: {
  prefs: Preferences
  update: (patch: PreferencesPatch) => void
}) {
  const { t } = useTranslation()

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-6 pb-5">
        <SettingRow
          label={t("settings.general.language.label")}
          description={t("settings.general.language.description")}
        >
          <Select
            className="w-40"
            aria-label={t("settings.general.language.label")}
            value={prefs.language}
            onValueChange={(language) => update({ language: language as LanguagePreference })}
          >
            {LANGUAGE_PREFERENCES.map((language) => (
              <SelectItem key={language} value={language}>
                {language === "system"
                  ? t("settings.general.language.system")
                  : LANGUAGE_LABELS[language]}
              </SelectItem>
            ))}
          </Select>
        </SettingRow>
        <SettingRow
          label={t("settings.general.debug.label")}
          description={t("settings.general.debug.description")}
        >
          <Switch
            aria-label={t("settings.general.debug.label")}
            checked={prefs.debug}
            onCheckedChange={(debug) => update({ debug })}
          />
        </SettingRow>
      </div>
    </ScrollArea>
  )
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
  const { t } = useTranslation()
  const { particles, glow, presets, activePreset } = prefs
  // Where the current values came from, and so what saving overwrites and
  // reverting returns to. null is the built-in defaults, which cannot be
  // overwritten — edits made against them can only become a preset of their own.
  const origin = presets.find((p) => p.id === activePreset) ?? null
  const basis = origin ?? DEFAULT_EFFECTS
  const drifted = !sameEffects(prefs, basis)
  // Which dialog is up, if any. Only one can be, so this is a single slot.
  const [dialog, setDialog] = useState<"save" | "delete" | null>(null)
  // The unnamed values are a place you can be, so they have to be a place you
  // can get back to: leaving them for a preset stows them for the session, and
  // the custom entry stays on the list until they are picked back up. Without
  // this, trying another preset to compare would quietly discard the tuning.
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
      // leaving the picker on the custom entry would be a lie.
      activePreset: id,
    })
    setDialog(null)
  }

  const deleteOrigin = () => {
    if (origin) {
      // Nothing is left pointing at it — dropping to the defaults is the same
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
            aria-label={t("settings.effects.preset.label")}
            value={entry}
            onValueChange={applyEntry}
          >
            {/* The values that belong to no preset. On the list whenever there
                are any — the ones in effect now, or the ones set aside when a
                preset was tried out. */}
            {(drifted || stash) && (
              <SelectItem value={CUSTOM_ENTRY}>{t("settings.effects.preset.custom")}</SelectItem>
            )}
            <SelectItem value={DEFAULT_ENTRY}>{t("settings.effects.preset.default")}</SelectItem>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </Select>
          {/* Only for what the picker is actually naming: while the values have
              drifted it reads as the custom entry, and a delete that reached
              past that to the preset behind it would be a trap. */}
          <IconButton
            tone="danger"
            className="size-7 flex-none rounded disabled:opacity-20"
            disabled={drifted || !origin}
            title={t("settings.effects.preset.delete")}
            aria-label={t("settings.effects.preset.delete")}
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
            title={t("settings.effects.glow.title")}
            description={t("settings.effects.glow.description")}
            open={!collapsed.glow}
            onOpenChange={toggle("glow")}
            enabled={glow.enabled}
            onEnabledChange={(v) => setGlow({ enabled: v })}
          >
            <SettingRow
              label={t("settings.effects.glow.shape.label")}
              description={t("settings.effects.glow.shape.description")}
            >
              <Segmented
                aria-label={t("settings.effects.glow.shape.label")}
                value={glow.shape}
                options={SHAPES.map((shape) => ({
                  value: shape,
                  label: t(`settings.effects.glow.shape.${shape}`),
                }))}
                onChange={(shape) => setGlow({ shape })}
              />
            </SettingRow>
            <SettingRow
              label={t("settings.effects.glow.level.label")}
              description={t("settings.effects.glow.level.description")}
            >
              {glowSlider("level", t("units.percent", { value: Math.round(glow.level * 100) }))}
            </SettingRow>
            <SettingRow
              label={t("settings.effects.glow.flash.label")}
              description={t("settings.effects.glow.flash.description")}
            >
              {glowSlider("flash", t("units.seconds", { value: glow.flash.toFixed(2) }))}
            </SettingRow>
            <SettingRow
              label={t("settings.effects.glow.size.label")}
              description={t("settings.effects.glow.size.description")}
            >
              {glowSlider("size", t("units.times", { value: glow.size.toFixed(1) }))}
            </SettingRow>
            <SettingRow
              label={t("settings.effects.glow.jitter.label")}
              description={t("settings.effects.glow.jitter.description")}
            >
              {glowSlider("jitter", t("units.percent", { value: Math.round(glow.jitter * 100) }))}
            </SettingRow>
            {glow.jitter > 0 && (
              <SettingRow
                label={t("settings.effects.glow.jitterRate.label")}
                description={t("settings.effects.glow.jitterRate.description")}
              >
                {glowSlider(
                  "jitterRate",
                  t("units.timesPerSecond", { value: Math.round(glow.jitterRate) }),
                )}
              </SettingRow>
            )}
            <SettingRow
              label={t("settings.effects.glow.color.label")}
              description={t("settings.effects.glow.color.description")}
            >
              <ColorInput
                aria-label={t("settings.effects.glow.color.aria")}
                value={glow.color}
                onChange={(color) => setGlow({ color })}
              />
            </SettingRow>
          </EffectAccordion>

          <EffectAccordion
            title={t("settings.effects.particles.title")}
            description={t("settings.effects.particles.description")}
            open={!collapsed.particles}
            onOpenChange={toggle("particles")}
            enabled={particles.enabled}
            onEnabledChange={(v) => setParticles({ enabled: v })}
          >
            {/* First: it decides what two of the rows below even mean, and the
                angle stays pinned to it — a mode and its one parameter split up
                by unrelated sliders would read as unrelated settings. */}
            <SettingRow
              label={t("settings.effects.particles.direction.label")}
              description={t("settings.effects.particles.direction.description")}
            >
              <Segmented
                aria-label={t("settings.effects.particles.direction.label")}
                value={particles.direction}
                options={DIRECTIONS.map((direction) => ({
                  value: direction,
                  label: t(`settings.effects.particles.direction.${direction}`),
                }))}
                onChange={(direction) => setParticles({ direction })}
              />
            </SettingRow>
            {particles.direction === "directional" && (
              <SettingRow
                label={t("settings.effects.particles.angle.label")}
                description={t("settings.effects.particles.angle.description")}
              >
                {particleSlider(
                  "angle",
                  t("units.degrees", { value: Math.round(particles.angle) }),
                )}
              </SettingRow>
            )}
            <SettingRow
              label={t("settings.effects.particles.rate.label")}
              description={t("settings.effects.particles.rate.description")}
            >
              {particleSlider("rate", t("units.perSecond", { value: Math.round(particles.rate) }))}
            </SettingRow>
            <SettingRow
              label={t("settings.effects.particles.life.label")}
              description={t("settings.effects.particles.life.description")}
            >
              {particleSlider("life", t("units.seconds", { value: particles.life.toFixed(2) }))}
            </SettingRow>
            <SettingRow
              label={t(`settings.effects.particles.${radial ? "radiusX" : "spreadX"}.label`)}
              description={t(
                `settings.effects.particles.${radial ? "radiusX" : "spreadX"}.description`,
              )}
            >
              {particleSlider(
                "spreadX",
                t("units.pixels", { value: Math.round(particles.spreadX) }),
              )}
            </SettingRow>
            <SettingRow
              label={t(`settings.effects.particles.${radial ? "radiusY" : "spreadY"}.label`)}
              description={t(
                `settings.effects.particles.${radial ? "radiusY" : "spreadY"}.description`,
              )}
            >
              {particleSlider(
                "spreadY",
                t("units.pixels", { value: Math.round(particles.spreadY) }),
              )}
            </SettingRow>
            <SettingRow
              label={t("settings.effects.particles.originX.label")}
              description={t("settings.effects.particles.originX.description")}
            >
              {particleSlider(
                "originX",
                t("units.pixels", { value: Math.round(particles.originX) }),
              )}
            </SettingRow>
            <SettingRow
              label={t("settings.effects.particles.color.label")}
              description={t("settings.effects.particles.color.description")}
            >
              <ColorInput
                aria-label={t("settings.effects.particles.color.aria")}
                value={particles.color}
                onChange={(color) => setParticles({ color })}
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
            {origin
              ? t("settings.effects.preset.changedFrom", { name: origin.name })
              : t("settings.effects.preset.changedFromDefault")}
          </span>
          <Button className="pointer-events-auto" onClick={revert}>
            <Undo2 size={13} strokeWidth={2} aria-hidden="true" />
            {t("settings.effects.preset.revert")}
          </Button>
          <Button
            className="pointer-events-auto"
            disabled={presets.length >= PRESET_LIMITS.count}
            onClick={() => setDialog("save")}
          >
            <BookmarkPlus size={13} strokeWidth={2} aria-hidden="true" />
            {t("settings.effects.preset.saveAs")}
          </Button>
          {/* Absent rather than disabled on the defaults: there is no such
              thing as overwriting them, so offering it greyed out would only
              pose a question with no answer. */}
          {origin && (
            <Button className="pointer-events-auto" tone="primary" onClick={overwriteOrigin}>
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
              {t("common.save")}
            </Button>
          )}
        </div>
      )}

      {dialog === "save" && (
        <SavePresetDialog presets={presets} onSave={savePreset} onClose={() => setDialog(null)} />
      )}
      {dialog === "delete" && origin && (
        <Dialog
          title={t("settings.effects.preset.delete")}
          description={t("settings.effects.preset.deleteConfirm", { name: origin.name })}
          onClose={() => setDialog(null)}
        >
          <DialogActions>
            <Button onClick={() => setDialog(null)}>{t("common.cancel")}</Button>
            <Button tone="danger" onClick={deleteOrigin}>
              {t("common.delete")}
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
  const { t } = useTranslation()
  // Suggested rather than blank: naming a look is work, and most of the time
  // the number is answer enough.
  const [name, setName] = useState(() => {
    const taken = new Set(presets.map((p) => p.name))
    let n = presets.length + 1
    while (taken.has(t("settings.effects.preset.suggestedName", { index: n }))) {
      n += 1
    }
    return t("settings.effects.preset.suggestedName", { index: n })
  })

  const trimmed = name.trim().slice(0, PRESET_LIMITS.nameLength)
  const overwriting = presets.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())

  return (
    <Dialog
      title={t("settings.effects.preset.saveAs")}
      description={t("settings.effects.preset.saveAsDescription")}
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
            placeholder={t("settings.effects.preset.name")}
            aria-label={t("settings.effects.preset.name")}
            onChange={(e) => setName(e.currentTarget.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          {overwriting && (
            <p className="select-none text-2xs text-muted">
              {t("settings.effects.preset.overwriteWarning")}
            </p>
          )}
        </div>
        <DialogActions>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" tone="primary" disabled={!trimmed}>
            {overwriting ? t("settings.effects.preset.overwrite") : t("common.save")}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
