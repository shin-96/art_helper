import test from 'node:test'
import assert from 'node:assert/strict'
import { createLesson, STAGES } from '../src/data/stages.ts'
import { generateLesson, lessonSchema, validateLesson } from './lesson.mjs'

const lesson = createLesson('Tĩnh vật', 'Cơ bản')
const step = lesson.steps[0]
const testConfig = { provider: 'test', token: 'mock-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' }

test('chấp nhận đúng 13 giai đoạn, nhãn và pha theo hợp đồng', () => {
  assert.equal(validateLesson(lesson), true)
  assert.equal(lesson.steps.length, 13)
  assert.deepEqual(lesson.steps.map(item => item.shortTitle), STAGES.map(stage => stage.label))
  assert.deepEqual(lesson.steps.map(item => item.phase), STAGES.map(stage => stage.phase))
  assert.equal(lesson.duration, lesson.steps.reduce((total, item) => total + item.duration, 0))
})

test('từ chối thiếu bước, sai thứ tự, sai pha, tổng phút lệch và dữ liệu ngoài schema', () => {
  assert.equal(validateLesson(null), false)
  assert.equal(validateLesson({ ...lesson, steps: lesson.steps.slice(1) }), false)
  const swapped = [...lesson.steps]
  ;[swapped[1], swapped[2]] = [swapped[2], swapped[1]]
  assert.equal(validateLesson({ ...lesson, steps: swapped }), false)
  const wrongPhase = [...lesson.steps]
  wrongPhase[4] = { ...wrongPhase[4], phase: 'shade' }
  assert.equal(validateLesson({ ...lesson, steps: wrongPhase }), false)
  assert.equal(validateLesson({ ...lesson, duration: lesson.duration + 1 }), false)
  assert.equal(validateLesson({ ...lesson, palette: ['rgb(1,2,3)'] }), false)
  const extra = [...lesson.steps]
  extra[0] = { ...step, unexpected: true }
  assert.equal(validateLesson({ ...lesson, steps: extra }), false)
  const invalid = [...lesson.steps]
  invalid[0] = { ...step, duration: Infinity }
  assert.equal(validateLesson({ ...lesson, steps: invalid }), false)
})

test('bài học mặc định trình diễn từng nét, không đòi người xem tự xác nhận', () => {
  const demo = createLesson('Ảnh thử')
  assert.equal(demo.steps.length, 13)
  assert.ok(demo.steps.every(item => item.actions.length >= 1 && item.checkpoint && item.tool))
  assert.match(demo.steps[2].actions.join(' '), /ứng dụng.*tự phác/iu)
})

test('gửi đúng thứ tự 13 giai đoạn và hướng dẫn bài trình diễn tự vẽ', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: JSON.stringify(lesson) } }],
  }))
  const image = 'data:image/png;base64,AA=='

  const result = await generateLesson({ config: testConfig, image, level: 'intermediate', focus: 'charcoal' })

  assert.deepEqual(result, lesson)
  assert.equal(fetchMock.mock.callCount(), 1)
  const [, { body }] = fetchMock.mock.calls[0].arguments
  const request = JSON.parse(body)
  const [instructions, reference] = request.messages[0].content
  assert.equal(instructions.type, 'text')
  assert.deepEqual(reference, { type: 'image_url', image_url: { url: image } })
  assert.deepEqual(request.response_format, {
    type: 'json_schema', json_schema: { name: 'drawing_lesson', strict: true, schema: lessonSchema },
  })

  const prompt = instructions.text
  assert.match(prompt, /Độ khó: Trung cấp\..*Trọng tâm kỹ thuật: than vẽ/u)
  assert.match(prompt, /Viết đúng 13 bước theo thứ tự/u)
  let previousIndex = -1
  for (const stage of STAGES) {
    const index = prompt.indexOf(`${stage.label} (${stage.phase})`)
    assert.ok(index > previousIndex, `${stage.label} appears in the required order`)
    previousIndex = index
  }
  assert.match(prompt, /Không yêu cầu người dùng tự vẽ, đánh dấu hoàn thành hoặc tự xác nhận/u)
  assert.match(prompt, /mô phỏng và tự vẽ nét/u)
  assert.match(prompt, /không gộp, đảo, bỏ hoặc thêm bước/iu)
})
