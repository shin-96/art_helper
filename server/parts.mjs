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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const asNumber = (value) => (typeof value === 'number' ? value
  : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN)
const truncate = (value, max) => (value.length > max ? value.slice(0, max).trimEnd() : value)

/**
 * Normalize the AI part list. Boxes are asked for as 0..1000 coordinates and
 * leave as fractions (0..1) the client can map onto the drawing board.
 * Real models — above all in the json_object fallback mode, where no schema
 * constrains them — answer with floats, 0..1 fractions, overlong notes or a
 * string order; each part is repaired where that is safe and dropped where
 * it is not, instead of one imperfect part discarding the whole answer.
 * Returns null only when nothing usable remains, so the caller can fall
 * back to the local analysis instead of teaching wrong names.
 */
export function validateParts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.subject !== 'string' || !value.subject.trim()) return null
  if (!Array.isArray(value.parts) || value.parts.length < 1) return null
  const parts = []
  for (const part of value.parts.slice(0, 8)) {
    if (!part || typeof part !== 'object') continue
    const name = truncate(typeof part.name === 'string' ? part.name.trim() : '', 48)
    const note = truncate(typeof part.note === 'string' ? part.note.trim() : '', 280)
    if (!name || !note) continue
    const box = part.box
    if (!box || typeof box !== 'object') continue
    let x = asNumber(box.x)
    let y = asNumber(box.y)
    let width = asNumber(box.width)
    let height = asNumber(box.height)
    if (![x, y, width, height].every(Number.isFinite)) continue
    if (Math.max(x, y, width, height) <= 1) {
      x *= 1000; y *= 1000; width *= 1000; height *= 1000
    }
    x = Math.round(x); y = Math.round(y); width = Math.round(width); height = Math.round(height)
    if (x >= 1000 || y >= 1000 || width <= 0 || height <= 0) continue
    x = clamp(x, 0, 999); y = clamp(y, 0, 999)
    width = clamp(width, 10, 1000 - x); height = clamp(height, 10, 1000 - y)
    const order = asNumber(part.order)
    parts.push({
      name,
      note,
      order: Number.isFinite(order) ? order : parts.length + 1,
      box: { x: x / 1000, y: y / 1000, width: width / 1000, height: height / 1000 },
    })
  }
  if (!parts.length) return null
  parts.sort((a, b) => a.order - b.order || (b.box.width * b.box.height) - (a.box.width * a.box.height))
  return { subject: truncate(value.subject.trim(), 160), parts: parts.map((part, i) => ({ ...part, order: i + 1 })) }
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
