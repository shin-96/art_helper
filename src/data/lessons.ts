import type { Lesson } from '../types'
import { createLesson } from './stages'

export type { Lesson, LessonPhase, LessonStep } from '../types'
export const SAMPLE_REFERENCE_URL = '/pear-reference.svg'
export const SAMPLE_LESSON: Lesson = createLesson('Quả lê bên cửa sổ')
