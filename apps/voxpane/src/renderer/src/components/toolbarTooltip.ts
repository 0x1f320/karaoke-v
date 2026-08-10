export type ToolbarTooltipSide = "top" | "bottom"

export function toolbarTooltipSide(index: number, total: number): ToolbarTooltipSide {
  return index < total / 2 ? "bottom" : "top"
}
