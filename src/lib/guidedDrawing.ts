import type { ImageBounds } from './imageProcessing'

export type PracticeMode = 'identify' | 'simulate' | 'draw' | 'correct'
export type StrokeKind = 'construction' | 'ink' | 'tone' | 'color' | 'erase' | 'check'
export interface StrokeStyle { color?: string; width?: number; opacity?: number; kind?: StrokeKind }
export interface SketchStroke extends StrokeStyle { key: string; path: string; step: number; partId: string }
export interface GuidedStroke extends StrokeStyle { path: string; label: string; instruction: string }
export interface GuidedPart {
  id: string
  label: string
  shape: string
  bounds: ImageBounds
  strokes: GuidedStroke[]
  checkpoint: string
  correction: string
}
export { uploadedParts } from './uploadedPlan.ts'

/** One pen-down path per stroke, including relative SVG moveto commands. */
export function normalizeParts(parts: GuidedPart[]): GuidedPart[] {
  return parts.map(part => ({ ...part, strokes: part.strokes.flatMap(stroke => {
    // Plans use absolute M for each independent stroke. Never lose styling
    // when splitting an old compound path into separate pen movements.
    const paths = stroke.path.match(/M[^M]*/g) ?? []
    return paths.map((path, index) => ({ ...stroke, path, label: index ? `${stroke.label} (tiếp)` : stroke.label }))
  }) })).filter(part => part.strokes.length > 0)
}

export function materialize(plans: GuidedPart[][], beforeStep: number): SketchStroke[] {
  return plans.slice(0, beforeStep).flatMap((parts, step) => parts.flatMap(part => part.strokes.map((stroke, index) => ({ ...stroke, key: `${step}:${part.id}:${index}`, step, partId: part.id }))))
}
