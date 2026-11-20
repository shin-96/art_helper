import { callAiJson, DEFAULT_TIMEOUT_MS, LessonError } from './ai.mjs'

const text = { type: 'string' }
const list = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems })
const object = (properties) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
})

export const partsSchema = object({
  subject: text,
  parts: list(object({
    name: text,
    note: text,
    order: { type: 'integer' },
    box: object({
      x: { type: 'integer' },
      y: { type: 'integer' },
      width: { type: 'integer' },
      height: { type: 'integer' },
    }),
  }), 1, 8),
})

const isIntIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

/**
 * Validate and normalize the AI part list. Boxes arrive as integers in
 * 0..1000 image coordinates and leave as fractions (0..1) the client can map
 * onto the drawing board. Returns null for anything unusable so the caller
 * can fall back to the local analysis instead of teaching wrong names.
 */
export function validateParts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.subject !== 'string' || !value.subject.trim() || value.subject.length > 160) return null
  if (!Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > 8) return null
  const parts = []
  for (const part of value.parts) {
    if (!part || typeof part !== 'object') return null
    const name = typeof part.name === 'string' ? part.name.trim() : ''
    const note = typeof part.note === 'string' ? part.note.trim() : ''
    if (!name || name.length > 48 || !note || note.length > 280) return null
    if (!Number.isInteger(part.order)) return null
    const box = part.box
    if (!box || typeof box !== 'object') return null
    if (!isIntIn(box.x, 0, 999) || !isIntIn(box.y, 0, 999)) return null
    if (!isIntIn(box.width, 10, 1000) || !isIntIn(box.height, 10, 1000)) return null
    const width = Math.min(box.width, 1000 - box.x)
    const height = Math.min(box.height, 1000 - box.y)
    parts.push({
      name,
      note,
      order: part.order,
      box: { x: box.x / 1000, y: box.y / 1000, width: width / 1000, height: height / 1000 },
    })
  }
  parts.sort((a, b) => a.order - b.order || (b.box.width * b.box.height) - (a.box.width * a.box.height))
  return { subject: value.subject.trim(), parts: parts.map((part, i) => ({ ...part, order: i + 1 })) }
}

function partsPrompt() {
  return `Bạn là giáo viên dạy vẽ. Hãy nhìn ảnh và chia chủ thể chính thành các bộ phận để dạy vẽ từng phần.

Yêu cầu:
- Chỉ xét chủ thể chính của ảnh, bỏ qua nền và vật phụ không quan trọng.
- parts có từ 2 đến 6 phần thật của chủ thể (ví dụ với động vật: đầu, thân, chân, đuôi; với đồ vật: thân, nắp, tay cầm...). Không bịa bộ phận không nhìn thấy trong ảnh.
- name là tên bộ phận ngắn gọn bằng tiếng Việt.
- note là MỘT câu mẹo vẽ riêng cho bộ phận đó: hình khối gần đúng, tỉ lệ so với phần kề, hoặc điểm mốc dễ nhìn nhất. Không viết câu chung chung dùng được cho mọi bộ phận.
- box là khung bao của bộ phận theo tọa độ nguyên 0 đến 1000 trên toàn ảnh (x, y là góc trên-trái).
- order là thứ tự nên vẽ: khối lớn và tổng quát trước, chi tiết sau, bắt đầu từ 1.
- subject là tên chủ thể chính bằng tiếng Việt.`
}

function invalidResponse() {
  return new LessonError(502, 'INVALID_AI_RESPONSE', 'AI trả về danh sách bộ phận không hợp lệ. Vui lòng thử lại.')
}

export async function generateParts({ config, image, timeoutMs = DEFAULT_TIMEOUT_MS, signal }) {
  const parsed = await callAiJson({
    config,
    prompt: partsPrompt(),
    image,
    schema: partsSchema,
    schemaName: 'drawing_parts',
    maxOutputTokens: 1_800,
    timeoutMs,
    signal,
    refusedMessage: 'AI không thể nhận diện bộ phận từ ảnh này. Hãy thử ảnh khác.',
    timeoutMessage: 'AI mất quá nhiều thời gian để nhận diện ảnh. Vui lòng thử lại.',
  })
  const parts = validateParts(parsed)
  if (!parts) throw invalidResponse()
  return parts
}
