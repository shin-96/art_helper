export type LessonPhase = 'observe' | 'construct' | 'refine' | 'shade' | 'finish'
export interface LessonStep {
  title: string
  shortTitle: string
  phase: LessonPhase
  duration: number
  description: string
  actions: string[]
  tip: string
  mistake: string
  tool: string
  checkpoint: string
}
export interface Lesson {
  title: string
  subject: string
  description: string
  difficulty: string
  duration: number
  observations: string[]
  palette: string[]
  steps: LessonStep[]
}
