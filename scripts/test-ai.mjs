// One-command AI self-test: runs the exact production path — .env config,
// provider call, response validation — against the bundled fox photo and
// prints a plain verdict for each half (part split, written lesson).
// Run from the project root:  node scripts/test-ai.mjs
// The key itself is never printed.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { resolveAiConfig } from '../server/ai.mjs'
import { generateParts } from '../server/parts.mjs'
import { generateLesson } from '../server/lesson.mjs'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const config = resolveAiConfig(process.env)
if (!config) {
  console.log('KẾT LUẬN: .env chưa có key nào dùng được (GEMINI_API_KEY / OPENROUTER_API_KEY / GROQ_API_KEY / OPENAI_API_KEY đều trống).')
  process.exit(1)
}
console.log(`Nhà cung cấp: ${config.provider} · model: ${config.model}`)

const bytes = await readFile(new URL('../img/HWXR981asAA6fu5.jfif', import.meta.url))
const image = `data:image/jpeg;base64,${bytes.toString('base64')}`

async function probeModels() {
  try {
    const response = await fetch(`${config.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.token}` } })
    if (!response.ok) {
      console.log(`  → Hỏi danh sách model cũng lỗi: HTTP ${response.status} — endpoint này có thể không thuộc về key này.`)
      return
    }
    const payload = await response.json()
    const ids = (payload.data ?? []).map((entry) => entry.id).filter(Boolean)
    console.log(`  → Key này truy cập được ${ids.length} model: ${ids.slice(0, 40).join(', ') || '(danh sách trống)'}`)
  } catch {
    console.log('  → Không hỏi được danh sách model (lỗi mạng).')
  }
}

function report(label, error) {
  console.log(`${label}: LỖI ${error?.code ?? 'UNKNOWN'} (HTTP ${error?.status ?? '?'}) — ${error?.message ?? error}`)
  if (error?.code === 'AI_UPSTREAM_ERROR') {
    console.log('  → Nhà cung cấp từ chối cuộc gọi. Xem dòng [ai] ở trên để biết mã trạng thái gốc:')
    console.log('    400/401/403 thường là key sai loại hoặc sai key; key Gemini đúng lấy tại aistudio.google.com/apikey.')
  }
  if (error?.code === 'INVALID_AI_RESPONSE') {
    console.log('  → Key chạy được nhưng model trả nội dung không đạt chuẩn. Chụp lại toàn bộ kết quả này gửi cho người sửa.')
  }
}

try {
  const parts = await generateParts({ config, image })
  console.log(`CHIA PHẦN: OK — chủ thể "${parts.subject}", ${parts.parts.length} phần: ${parts.parts.map((p) => p.name).join(', ')}`)
} catch (error) {
  report('CHIA PHẦN', error)
  if (error?.code === 'AI_UPSTREAM_ERROR') await probeModels()
}

try {
  const lesson = await generateLesson({ config, image, level: 'beginner', focus: 'pencil' })
  console.log(`BÀI HỌC: OK — "${lesson.title}" (${lesson.steps.length} bước)`)
} catch (error) {
  report('BÀI HỌC', error)
}
