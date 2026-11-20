import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { generateParts, validateParts } from './parts.mjs'
import { LessonError } from './lesson.mjs'
import { app } from './index.mjs'
import { analyzeImagePixels } from '../src/lib/imageProcessing.ts'
import { uploadedParts } from '../src/lib/uploadedPlan.ts'

const testConfig = { provider: 'test', token: 'test-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' }

const validPayload = {
  subject: 'Chó trắng ôm quả táo',
  parts: [
    { name: 'Thân', note: 'Thân là khối bầu dục lớn nhất, dựng trước để neo toàn bài.', order: 1, box: { x: 200, y: 300, width: 600, height: 550 } },
    { name: 'Đầu', note: 'Đầu gần tròn, rộng khoảng một phần ba thân.', order: 2, box: { x: 550, y: 80, width: 330, height: 300 } },
  ],
}

test('validateParts chuẩn hóa hộp về tỉ lệ 0..1 và sắp theo thứ tự vẽ', () => {
  const result = validateParts(validPayload)
  assert.ok(result)
  assert.equal(result.subject, 'Chó trắng ôm quả táo')
  assert.deepEqual(result.parts.map(p => p.name), ['Thân', 'Đầu'])
  assert.deepEqual(result.parts[0].box, { x: 0.2, y: 0.3, width: 0.6, height: 0.55 })
  assert.deepEqual(result.parts.map(p => p.order), [1, 2])
})

test('validateParts loại payload hỏng thay vì dạy sai tên bộ phận', () => {
  assert.equal(validateParts(null), null)
  assert.equal(validateParts({ subject: 'X', parts: [] }), null)
  assert.equal(validateParts({ subject: 'X', parts: [{ name: '', note: 'n', order: 1, box: { x: 0, y: 0, width: 100, height: 100 } }] }), null)
  assert.equal(validateParts({ subject: 'X', parts: [{ name: 'A', note: 'n', order: 1, box: { x: 1200, y: 0, width: 100, height: 100 } }] }), null)
  assert.equal(validateParts({ subject: 'X', parts: [{ name: 'A', note: 'n', order: 1, box: { x: 0, y: 0, width: 0, height: 100 } }] }), null)
})

test('validateParts sửa output kiểu model free: số thực, tỉ lệ 0..1, ghi chú dài, order dạng chữ', () => {
  const result = validateParts({
    subject: 'Cáo trắng',
    parts: [
      { name: 'Thân', note: 'x'.repeat(400), order: '1', box: { x: 0.15, y: 0.25, width: 0.45, height: 0.5 } },
      { name: 'Đầu', note: 'Đầu gần tròn.', order: 2, box: { x: 550.4, y: 80.6, width: 330.2, height: 300 } },
      { name: 'Bịa', note: 'Phần này nằm ngoài ảnh.', order: 3, box: { x: 1400, y: 0, width: 100, height: 100 } },
    ],
  })
  assert.ok(result)
  assert.deepEqual(result.parts.map(p => p.name), ['Thân', 'Đầu'])
  assert.deepEqual(result.parts[0].box, { x: 0.15, y: 0.25, width: 0.45, height: 0.5 })
  assert.equal(result.parts[0].note.length, 280)
  assert.deepEqual(result.parts[1].box, { x: 0.55, y: 0.081, width: 0.33, height: 0.3 })
  const sliver = validateParts({ subject: 'X', parts: [{ name: 'A', note: 'n', order: 1, box: { x: 0, y: 0, width: 3, height: 100 } }] })
  assert.equal(sliver.parts[0].box.width, 0.01)
})

test('generateParts đọc content, gửi đúng schema và trả phần đã chuẩn hóa', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: JSON.stringify(validPayload) } }],
  }))
  const result = await generateParts({ config: testConfig, image: 'data:image/png;base64,AAAA' })
  assert.equal(fetchMock.mock.callCount(), 1)
  const [, init] = fetchMock.mock.calls[0].arguments
  const body = JSON.parse(init.body)
  assert.equal(body.response_format.json_schema.name, 'drawing_parts')
  assert.equal(body.response_format.json_schema.strict, true)
  assert.equal(result.parts.length, 2)
  assert.equal(result.parts[1].name, 'Đầu')
})

test('generateParts ánh xạ 429 thành AI_UNAVAILABLE như bài học', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('busy', { status: 429 }))
  await assert.rejects(
    () => generateParts({ config: testConfig, image: 'data:image/png;base64,AAAA' }),
    (error) => error instanceof LessonError && error.code === 'AI_UNAVAILABLE',
  )
})

test('POST /api/parts: chưa có key thì 503, có key thì trả bộ phận đã chuẩn hóa', { timeout: 15_000 }, async (t) => {
  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const realFetch = globalThis.fetch
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHgQAAAAASUVORK5CYII=', 'base64')
  const body = JSON.stringify({ image: `data:image/png;base64,${PNG.toString('base64')}` })
  const post = () => realFetch(`${origin}/api/parts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

  const envNames = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL']
  const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
  t.after(() => { for (const name of envNames) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name] } })

  for (const name of envNames) delete process.env[name]
  const noKey = await post()
  assert.equal(noKey.status, 503)
  assert.equal((await noKey.json()).code, 'AI_NOT_CONFIGURED')

  process.env.OPENAI_API_KEY = 'test-key'
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('api.openai.com')) {
      return Response.json({ choices: [{ message: { content: JSON.stringify(validPayload) } }] })
    }
    return realFetch(url, init)
  })
  const ok = await post()
  assert.equal(ok.status, 200)
  const payload = await ok.json()
  assert.equal(payload.source, 'ai')
  assert.deepEqual(payload.parts.map(p => p.name), ['Thân', 'Đầu'])
  assert.deepEqual(payload.parts[0].box, { x: 0.2, y: 0.3, width: 0.6, height: 0.55 })
})

test('kế hoạch gắn tên AI vào khối và nét; không có AI thì giữ nhãn local', () => {
  const w = 220, h = 220
  const pixels = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - 110) / 62, dy = (y - 110) / 48
    if (dx * dx + dy * dy <= 1) {
      const i = (y * w + x) * 4
      pixels[i] = 70; pixels[i + 1] = 60; pixels[i + 2] = 50
    }
  }
  const result = analyzeImagePixels(pixels, w, h)
  const aiParts = [{ name: 'Thân chính', note: 'Thân gần như một khối bầu dục nằm ngang.', order: 1, box: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } }]

  const blocks = uploadedParts(result, 2, aiParts)
  assert.ok(blocks.some(part => part.label === 'Thân chính'), `nhãn khối phải là tên AI, nhận: ${blocks.map(p => p.label).join(' | ')}`)
  assert.ok(blocks[0].shape.includes('khối bầu dục'), 'ghi chú của AI phải đi vào phần hướng dẫn khối')

  const contours = uploadedParts(result, 7, aiParts)
  assert.ok(contours.some(part => part.label.includes('Thân chính')), `nét biên phải gắn tên bộ phận, nhận: ${contours.map(p => p.label).join(' | ')}`)

  const localBlocks = uploadedParts(result, 2)
  assert.ok(!localBlocks.some(part => part.label === 'Thân chính'), 'không có AI thì không được bịa tên bộ phận')
})
