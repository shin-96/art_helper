import { DEFAULT_TIMEOUT_MS, LessonError, LESSON_MODEL } from './lesson.mjs'

const RESPONSES_URL = 'https://api.openai.com/v1/responses'

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

function getOutputText(payload) {
  if (!payload || (payload.status && payload.status !== 'completed')) {
    throw invalidResponse()
  }
  const content = Array.isArray(payload.output)
    ? payload.output.flatMap((item) => item?.type === 'message' && Array.isArray(item.content) ? item.content : [])
    : []
  if (content.some((part) => part?.type === 'refusal')) {
    throw new LessonError(422, 'AI_REFUSED', 'AI không thể nhận diện bộ phận từ ảnh này. Hãy thử ảnh khác.')
  }
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text
  }
  return content
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

export async function generateParts({ apiKey, image, timeoutMs = DEFAULT_TIMEOUT_MS, signal }) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout
  let payload
  try {
    const response = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: requestSignal,
      body: JSON.stringify({
        model: LESSON_MODEL,
        store: false,
        max_output_tokens: 1_800,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: partsPrompt() },
            { type: 'input_image', image_url: image, detail: 'high' },
          ],
        }],
        text: { format: { type: 'json_schema', name: 'drawing_parts', strict: true, schema: partsSchema } },
      }),
    })

    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 429) {
        throw new LessonError(503, 'AI_UNAVAILABLE', 'AI đang bận. Vui lòng thử lại sau.')
      }
      throw new LessonError(502, 'AI_UPSTREAM_ERROR', 'Dịch vụ AI gặp lỗi. Vui lòng thử lại.')
    }
    payload = await response.json()
  } catch (error) {
    if (timeout.aborted) {
      throw new LessonError(504, 'AI_TIMEOUT', 'AI mất quá nhiều thời gian để nhận diện ảnh. Vui lòng thử lại.')
    }
    if (signal?.aborted || error instanceof LessonError) throw error
    if (error instanceof SyntaxError) throw invalidResponse()
    throw new LessonError(502, 'AI_UPSTREAM_ERROR', 'Không kết nối được với dịch vụ AI. Vui lòng thử lại.')
  }

  const outputText = getOutputText(payload)
  let parsed
  try {
    parsed = JSON.parse(outputText)
  } catch {
    throw invalidResponse()
  }
  const parts = validateParts(parsed)
  if (!parts) throw invalidResponse()
  return parts
}
