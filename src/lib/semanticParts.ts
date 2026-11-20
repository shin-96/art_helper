/** A subject part named by AI vision. `box` uses fractions of the image (0..1). */
export interface SemanticPart {
  name: string
  note: string
  order: number
  box: { x: number; y: number; width: number; height: number }
}
