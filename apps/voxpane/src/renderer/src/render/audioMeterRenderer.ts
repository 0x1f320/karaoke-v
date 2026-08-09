import { Container, Graphics, Text } from "pixi.js"
import type { AudioMeterSnapshot } from "../../../shared/audioMeter"
import {
  type AudioMeterLabels,
  type AudioMeterRect,
  audioMeterLevel,
  audioMeterLevelColor,
  audioMeterReadout,
  audioMeterRect,
  audioMeterTicks,
} from "./audioMeterDisplay"

export interface AudioMeterDrawParams {
  clip: AudioMeterRect
  snapshot: AudioMeterSnapshot
  labels: AudioMeterLabels
}

const TEXT_X = 8
const BAR_X = 132
const BAR_Y = 20
const BAR_W = 10
const BAR_H = 96
const TICK_X = 116
const TICK_LABEL_RIGHT_X = TICK_X - 5
const RADIUS = 6

export class AudioMeterRenderer {
  private readonly container = new Container()
  private readonly panel = new Graphics()
  private readonly bar = new Graphics()
  private readonly ticks = new Graphics()
  private readonly title = new Text({
    text: "",
    style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10 },
  })
  private readonly primary = new Text({
    text: "",
    style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 18 },
  })
  private readonly secondary = new Text({
    text: "",
    style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 },
  })
  private readonly tertiary = new Text({
    text: "",
    style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 },
  })
  private readonly tickLabels = audioMeterTicks().map(
    (tick) =>
      new Text({
        text: tick.label,
        style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 8 },
      }),
  )
  private key = ""

  constructor(stage: Container) {
    for (const label of this.tickLabels) {
      label.anchor.set(1, 0)
    }
    this.title.position.set(TEXT_X, 9)
    this.primary.position.set(TEXT_X, 31)
    this.secondary.position.set(TEXT_X, 61)
    this.tertiary.position.set(TEXT_X, 80)
    this.container.addChild(
      this.panel,
      this.ticks,
      this.bar,
      this.title,
      this.primary,
      this.secondary,
      this.tertiary,
      ...this.tickLabels,
    )
    this.container.visible = false
    stage.addChild(this.container)
  }

  update(params: AudioMeterDrawParams | null): void {
    if (!params) {
      this.container.visible = false
      this.key = ""
      return
    }
    const rect = audioMeterRect(params.clip)
    if (!rect) {
      this.container.visible = false
      this.key = ""
      return
    }
    const readout = audioMeterReadout(params.snapshot, params.labels)
    const level = audioMeterLevel(params.snapshot.momentaryLufs)
    const nextKey = [
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      level,
      readout.title,
      readout.primary,
      readout.secondary,
      readout.tertiary,
      readout.state,
    ].join("|")
    this.container.visible = true
    if (nextKey === this.key) {
      return
    }
    this.key = nextKey
    this.container.position.set(rect.x, rect.y)
    this.drawPanel(rect)
    this.drawTicks()
    this.drawBar(level, readout.state)
    this.title.text = readout.title
    this.primary.text = readout.primary
    this.secondary.text = readout.secondary
    this.tertiary.text = readout.tertiary
    this.title.style.fill = 0x9ba7b4
    this.primary.style.fill = readout.state === "error" ? 0xff746c : 0xffffff
    this.secondary.style.fill = readout.state === "unsupported" ? 0xffc857 : 0xb7c1cc
    this.tertiary.style.fill = 0xb7c1cc
  }

  dispose(): void {
    this.container.destroy({ children: true })
  }

  private drawPanel(rect: AudioMeterRect): void {
    this.panel
      .clear()
      .roundRect(0, 0, rect.w, rect.h, RADIUS)
      .fill({ color: 0x05070a, alpha: 0.62 })
      .stroke({ width: 1, color: 0xffffff, alpha: 0.18, alignment: 1 })
  }

  private drawBar(level: number, state: AudioMeterSnapshot["state"]): void {
    const fillH = Math.round(BAR_H * level)
    this.bar.clear().roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 4).fill({ color: 0xffffff, alpha: 0.12 })
    if (fillH <= 0) {
      return
    }
    const top = BAR_Y + BAR_H - fillH
    for (let row = 0; row < fillH; row += 1) {
      const y = top + row
      const position = 1 - (y - BAR_Y) / BAR_H
      this.bar.rect(BAR_X, y, BAR_W, 1).fill({
        color: audioMeterLevelColor(position, state),
        alpha: 0.94,
      })
    }
    this.bar.roundRect(BAR_X, top, BAR_W, fillH, 4).stroke({
      width: 1,
      color: 0xffffff,
      alpha: 0.16,
      alignment: 1,
    })
  }

  private drawTicks(): void {
    this.ticks.clear()
    const ticks = audioMeterTicks()
    for (let index = 0; index < ticks.length; index += 1) {
      const tick = ticks[index]
      const y = BAR_Y + BAR_H - Math.round(BAR_H * tick.level)
      this.ticks.rect(TICK_X, y, BAR_X - TICK_X - 3, 1).fill({ color: 0xffffff, alpha: 0.28 })
      const label = this.tickLabels[index]
      label.text = tick.label
      label.position.set(TICK_LABEL_RIGHT_X, y - 5)
      label.style.fill = tick.value > 0 ? 0xffb0a8 : 0x8b98a8
    }
  }
}
