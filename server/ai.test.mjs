import test from 'node:test'
import assert from 'node:assert/strict'
import { callAiJson, LessonError, pickDiscoveredModels, resolveAiConfig } from './ai.mjs'

test('resolveAiConfig: không có key nào thì null để app dùng fallback local', () => {
  assert.equal(resolveAiConfig({}), null)
  assert.equal(resolveAiConfig({ OPENAI_API_KEY: '   ' }), null)
})

test('resolveAiConfig: key miễn phí thắng OpenAI, AI_MODEL ghi đè model mặc định', () => {
  const gemini = resolveAiConfig({ OPENAI_API_KEY: 'sk-paid', GEMINI_API_KEY: 'gem-key' })
  assert.equal(gemini.provider, 'gemini')
  assert.equal(gemini.model, 'gemini-2.5-flash')
  assert.match(gemini.baseUrl, /generativelanguage\.googleapis\.com/)

  const openrouter = resolveAiConfig({ OPENROUTER_API_KEY: 'or-key', AI_MODEL: 'some/model:free' })
  assert.equal(openrouter.provider, 'openrouter')
  assert.equal(openrouter.model, 'some/model:free')

  const groq = resolveAiConfig({ GROQ_API_KEY: 'groq-key' })
  assert.equal(groq.provider, 'groq')

  const openai = resolveAiConfig({ OPENAI_API_KEY: 'sk-paid' })
  assert.equal(openai.provider, 'openai')
  assert.equal(openai.model, 'gpt-4.1-mini')
})

test('resolveAiConfig: AI_BASE_URL tùy chỉnh thắng mọi preset', () => {
  const custom = resolveAiConfig({ AI_BASE_URL: 'https://example.invalid/v1', AI_API_KEY: 'k' })
  assert.equal(custom.provider, 'custom')
  assert.equal(custom.baseUrl, 'https://example.invalid/v1')
})

const config = { provider: 'test', token: 'k', baseUrl: 'https://ai.example.invalid/v1', model: 'm' }
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }
const ask = (overrides = {}) => callAiJson({
  config,
  prompt: 'trả JSON',
  image: 'data:image/png;base64,AAAA',
  schema,
  schemaName: 'test_schema',
  refusedMessage: 'bị từ chối',
  timeoutMessage: 'quá giờ',
  ...overrides,
})

test('callAiJson gửi schema strict trước và parse content trả về', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: '{"ok":true}' } }],
  }))
  assert.deepEqual(await ask(), { ok: true })
  assert.equal(fetchMock.mock.callCount(), 1)
  const [url, init] = fetchMock.mock.calls[0].arguments
  assert.equal(url, 'https://ai.example.invalid/v1/chat/completions')
  const body = JSON.parse(init.body)
  assert.equal(body.response_format.type, 'json_schema')
  assert.equal(body.response_format.json_schema.strict, true)
  assert.equal(body.messages[0].content[1].type, 'image_url')
})

test('callAiJson lùi về json_object khi nhà cung cấp từ chối schema (400)', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (calls === 1) return new Response('bad schema', { status: 400 })
    return Response.json({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] })
  })
  assert.deepEqual(await ask(), { ok: true })
  assert.equal(calls, 2)
})

test('callAiJson ánh xạ 429 thành AI_UNAVAILABLE và refusal thành AI_REFUSED', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('busy', { status: 429 }))
  await assert.rejects(() => ask(), error => error instanceof LessonError && error.code === 'AI_UNAVAILABLE')
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { refusal: 'no' } }] }))
  await assert.rejects(() => ask(), error => error instanceof LessonError && error.code === 'AI_REFUSED')
})

test('callAiJson lùi sang model kế khi model đầu trả 404 và nhớ model chạy được', async (t) => {
  const seen = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const model = JSON.parse(init.body).model
    seen.push(model)
    if (model === 'm-a') return new Response('not found', { status: 404 })
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
  })
  const chainConfig = { provider: 'gemini', token: 'k', baseUrl: 'https://ai.example.invalid/v1', model: 'm-a', models: ['m-a', 'm-b'] }
  const askChain = () => callAiJson({ config: chainConfig, prompt: 'p', image: 'data:image/png;base64,x', schema: { type: 'object' }, schemaName: 't', refusedMessage: 'r', timeoutMessage: 't' })
  assert.deepEqual(await askChain(), { ok: true })
  assert.deepEqual(seen, ['m-a', 'm-b'])
  assert.deepEqual(await askChain(), { ok: true })
  assert.deepEqual(seen, ['m-a', 'm-b', 'm-b'])
})

test('pickDiscoveredModels lọc model chat/vision, ưu tiên flash bản mới, giữ cả hai cách viết tên', () => {
  const names = pickDiscoveredModels([
    'models/gemini-3.1-flash-tts-preview',
    'models/lyria-3.5',
    'models/gemini-2.0-flash',
    'models/gemini-3.5-flash',
    'models/gemini-3.5-flash-lite',
    'models/gemini-3-pro',
    'models/text-embedding-004',
  ])
  assert.deepEqual(names, [
    'gemini-3.5-flash', 'models/gemini-3.5-flash',
    'gemini-3.5-flash-lite', 'models/gemini-3.5-flash-lite',
    'gemini-2.0-flash', 'models/gemini-2.0-flash',
  ])
})

test('callAiJson tự phát hiện model qua /models khi cả chuỗi tĩnh đều 404', async (t) => {
  const seen = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).endsWith('/models')) {
      return Response.json({ data: [{ id: 'models/lyria-3.5' }, { id: 'models/gemini-9-flash' }] })
    }
    const model = JSON.parse(init.body).model
    seen.push(model)
    if (model !== 'gemini-9-flash') return new Response('not found', { status: 404 })
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
  })
  const config = { provider: 'gemini', token: 'k', baseUrl: 'https://discovery.example.invalid/v1', model: 'gone', models: ['gone'] }
  const ask = () => callAiJson({ config, prompt: 'p', image: 'data:image/png;base64,x', schema: { type: 'object' }, schemaName: 't', refusedMessage: 'r', timeoutMessage: 't' })
  assert.deepEqual(await ask(), { ok: true })
  assert.deepEqual(seen, ['gone', 'gemini-9-flash'])
})

test('callAiJson lùi model khi model đầu quá tải (503) và báo AI_UNAVAILABLE khi mọi model đều bận', async (t) => {
  const seen = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const model = JSON.parse(init.body).model
    seen.push(model)
    if (model === 'busy') return new Response('overloaded', { status: 503 })
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
  })
  const config = { provider: 'gemini', token: 'k', baseUrl: 'https://load.example.invalid/v1', model: 'busy', models: ['busy', 'free'] }
  const ask = () => callAiJson({ config, prompt: 'p', image: 'data:image/png;base64,x', schema: { type: 'object' }, schemaName: 't', refusedMessage: 'r', timeoutMessage: 't' })
  assert.deepEqual(await ask(), { ok: true })
  assert.deepEqual(seen, ['busy', 'free'])

  t.mock.method(globalThis, 'fetch', async () => new Response('overloaded', { status: 503 }))
  const single = { provider: 'gemini', token: 'k', baseUrl: 'https://load2.example.invalid/v1', model: 'busy' }
  await assert.rejects(
    () => callAiJson({ config: single, prompt: 'p', image: 'data:image/png;base64,x', schema: { type: 'object' }, schemaName: 't', refusedMessage: 'r', timeoutMessage: 't' }),
    error => error instanceof LessonError && error.code === 'AI_UNAVAILABLE',
  )
})
