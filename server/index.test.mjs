import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { app } from './index.mjs'
import { createLesson } from '../src/data/stages.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHgQAAAAASUVORK5CYII=', 'base64')
const imageUrl = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`
const input = { image: imageUrl(PNG), level: 'beginner', focus: 'pencil' }
const httpFetch = globalThis.fetch
const maxImageBytes = 6 * 1024 * 1024

function setEnv(t, name, value) {
  const previous = process.env[name]
  process.env[name] = value
  t.after(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })
}

async function assertError(response, status, code) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const result = await response.json()
  assert.deepEqual(Object.keys(result).sort(), ['code', 'error'])
  assert.equal(result.code, code)
  assert.equal(typeof result.error, 'string')
  assert.ok(result.error.length > 0)
}

test('Express API over HTTP', { timeout: 15_000 }, async (t) => {
  const server = app.listen(0, '127.0.0.1')
  t.after(() => {
    if (!server.listening) return
    return new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  })
  await once(server, 'listening')

  const origin = `http://127.0.0.1:${server.address().port}`
  const get = (path, options) => httpFetch(`${origin}${path}`, options)
  const analyze = (body) => get('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

  await t.test('reports unconfigured AI and supports the demo fallback', async (t) => {
    setEnv(t, 'OPENAI_API_KEY', '  ')
    const upstream = t.mock.method(globalThis, 'fetch', async () => {
      assert.fail('No upstream request is expected without a key')
    })
    const health = await get('/api/health')
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await health.json(), { aiConfigured: false, model: null })
    await assertError(await analyze(input), 503, 'AI_NOT_CONFIGURED')
    assert.equal(upstream.mock.callCount(), 0)
  })

  await t.test('rejects invalid request bodies without calling OpenAI', async (t) => {
    setEnv(t, 'OPENAI_API_KEY', 'integration-test-key')
    const upstream = t.mock.method(globalThis, 'fetch', async () => {
      assert.fail('No upstream request is expected for invalid input')
    })
    const unsupported = await get('/api/analyze', { method: 'POST', body: 'plain text' })
    await assertError(unsupported, 415, 'UNSUPPORTED_CONTENT_TYPE')
    await assertError(await analyze('{"image":'), 400, 'INVALID_JSON')
    await assertError(await analyze({ ...input, level: 'constructor' }), 400, 'INVALID_LEVEL')
    await assertError(await analyze({ ...input, focus: 'paint' }), 400, 'INVALID_FOCUS')
    await assertError(await analyze({ ...input, image: 'https://example.invalid/image.png' }), 400, 'INVALID_IMAGE')
    await assertError(await analyze({ ...input, image: 'data:image/png;base64,%%%?' }), 400, 'INVALID_IMAGE')
    await assertError(await analyze({ ...input, image: input.image.replace('image/png', 'image/jpeg') }), 400, 'INVALID_IMAGE')
    await assertError(await analyze({ ...input, image: input.image.replace('image/png', 'image/svg+xml') }), 415, 'UNSUPPORTED_IMAGE_TYPE')
    const oversized = imageUrl(Buffer.alloc(maxImageBytes + 1))
    await assertError(await analyze({ ...input, image: oversized }), 413, 'IMAGE_TOO_LARGE')
    await assertError(await analyze({ ...input, extra: 'x'.repeat(oversized.length + 8192) }), 413, 'IMAGE_TOO_LARGE')
    assert.equal(upstream.mock.callCount(), 0)
  })

  await t.test('passes valid images to the Responses API and returns the lesson', async (t) => {
    setEnv(t, 'OPENAI_API_KEY', 'integration-test-key')
    setEnv(t, 'OPENAI_TIMEOUT_MS', '5000')
    const lesson = createLesson('Tĩnh vật', 'Nâng cao')
    const upstream = t.mock.method(globalThis, 'fetch', async () => Response.json({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(lesson) }] }],
    }))

    const health = await get('/api/health')
    assert.deepEqual(await health.json(), { aiConfigured: true, model: 'gpt-4.1-mini' })
    const result = await analyze({ ...input, level: 'advanced', focus: 'charcoal' })
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), { lesson, source: 'ai' })
    assert.equal(upstream.mock.callCount(), 1)

    const [url, options] = upstream.mock.calls[0].arguments
    assert.equal(url, 'https://api.openai.com/v1/responses')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer integration-test-key')
    const request = JSON.parse(options.body)
    assert.equal(request.model, 'gpt-4.1-mini')
    assert.equal(request.input[0].role, 'user')
    const [prompt, image] = request.input[0].content
    assert.equal(prompt.type, 'input_text')
    assert.match(prompt.text, /Nâng cao.*than vẽ/)
    assert.deepEqual(image, { type: 'input_image', image_url: input.image, detail: 'high' })
    assert.equal(request.text.format.type, 'json_schema')
    assert.equal(request.text.format.strict, true)
    assert.equal(request.text.format.schema.properties.steps.minItems, 13)
    assert.equal(request.text.format.schema.properties.steps.maxItems, 13)

    const atLimit = Buffer.alloc(maxImageBytes)
    PNG.copy(atLimit)
    const limitResult = await analyze({ ...input, image: imageUrl(atLimit) })
    assert.equal(limitResult.status, 200)
    await limitResult.json()
    assert.equal(upstream.mock.callCount(), 2)
  })

  await t.test('returns safe JSON errors for failed upstream responses', async (t) => {
    setEnv(t, 'OPENAI_API_KEY', 'integration-test-key')
    setEnv(t, 'OPENAI_TIMEOUT_MS', '5000')
    const upstream = t.mock.method(globalThis, 'fetch', async () => Response.json({
      output_text: JSON.stringify({ ...createLesson('Tĩnh vật'), steps: createLesson('Tĩnh vật').steps.slice(1) }),
    }))
    await assertError(await analyze(input), 502, 'INVALID_AI_RESPONSE')
    upstream.mock.mockImplementation(async () => Response.json({ error: 'OpenAI error details' }, { status: 429 }))
    const limited = await analyze(input)
    const limitedBody = await limited.clone().text()
    await assertError(limited, 503, 'AI_UNAVAILABLE')
    assert.doesNotMatch(limitedBody, /OpenAI error details/)
    upstream.mock.mockImplementation(async () => Response.json({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Provider refusal' }] }],
    }))
    await assertError(await analyze(input), 422, 'AI_REFUSED')
  })

  await t.test('times out an unfinished upstream request', async (t) => {
    setEnv(t, 'OPENAI_API_KEY', 'integration-test-key')
    setEnv(t, 'OPENAI_TIMEOUT_MS', '20')
    t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    await assertError(await analyze(input), 504, 'AI_TIMEOUT')
  })

  await t.test('cancels the upstream request when the client disconnects', async (t) => {
    setEnv(t, 'OPENAI_API_KEY', 'integration-test-key')
    setEnv(t, 'OPENAI_TIMEOUT_MS', '10000')
    const client = new AbortController()
    const upstreamStarted = Promise.withResolvers()
    const upstreamAborted = Promise.withResolvers()
    t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        upstreamAborted.resolve(signal.reason)
        reject(signal.reason)
      }, { once: true })
      upstreamStarted.resolve()
    }))

    const request = assert.rejects(get('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: client.signal,
    }), { name: 'AbortError' })
    await upstreamStarted.promise
    client.abort()
    await request
    assert.equal((await upstreamAborted.promise).name, 'AbortError')
  })

  await t.test('keeps unknown API paths JSON when serving the app', async () => {
    await assertError(await get('/api/no-such-route', { headers: { Accept: 'text/html' } }), 404, 'NOT_FOUND')
  })

  await t.test('serves the build and client routes', {
    skip: !existsSync(new URL('../dist/index.html', import.meta.url)),
  }, async () => {
    const index = await get('/')
    assert.equal(index.status, 200)
    assert.match(index.headers.get('content-type'), /text\/html/)
    const html = await index.text()
    const clientRoute = await get('/my-lesson', { headers: { Accept: 'text/html' } })
    assert.equal(clientRoute.status, 200)
    assert.equal(await clientRoute.text(), html)
    const missingAsset = await get('/missing-script.js')
    assert.equal(missingAsset.status, 404)
    await missingAsset.json()
  })
})
