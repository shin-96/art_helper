/**
 * Shared AI transport for the lesson and parts generators.
 *
 * Every supported provider is reached through the OpenAI-compatible Chat
 * Completions API, which is what the free tiers speak (Google Gemini,
 * OpenRouter, Groq) as well as OpenAI itself. Which provider is used is
 * decided purely by which key is present in .env — see .env.example.
 * Structured output is requested as a strict JSON schema first; providers
 * that reject schemas get one retry as a plain JSON object, and the
 * caller's own validator remains the final gate either way.
 */

export class LessonError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'LessonError'
    this.status = status
    this.code = code
  }
}

export const DEFAULT_TIMEOUT_MS = 90_000
export const DEFAULT_MODEL = 'gpt-4.1-mini'

const PROVIDERS = [
  { env: 'GEMINI_API_KEY', provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'] },
  { env: 'OPENROUTER_API_KEY', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free' },
  { env: 'GROQ_API_KEY', provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { env: 'OPENAI_API_KEY', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: DEFAULT_MODEL },
]

const pick = (env, name) => {
  const value = env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Resolve the active AI configuration from environment variables.
 * Free providers win over OpenAI so that adding a free key is all it takes
 * to test them; AI_API_KEY / AI_BASE_URL / AI_MODEL override everything.
 * Returns null when nothing is configured.
 */
export function resolveAiConfig(env = process.env) {
  const genericKey = pick(env, 'AI_API_KEY')
  const baseUrl = pick(env, 'AI_BASE_URL')
  const model = pick(env, 'AI_MODEL')
  if (genericKey || baseUrl) {
    return { provider: 'custom', token: genericKey ?? '', baseUrl: baseUrl ?? 'https://api.openai.com/v1', model: model ?? DEFAULT_MODEL }
  }
  for (const candidate of PROVIDERS) {
    const key = pick(env, candidate.env)
    if (key) return { provider: candidate.provider, token: key, baseUrl: candidate.baseUrl, model: model ?? candidate.model, ...(candidate.models && !model ? { models: candidate.models } : {}) }
  }
  return null
}

function invalidResponse() {
  return new LessonError(502, 'INVALID_AI_RESPONSE', 'AI trả về dữ liệu không hợp lệ. Vui lòng thử lại.')
}

/**
 * Ask the configured vision model for one JSON document and return it
 * parsed. Throws LessonError with the same codes the routes already map:
 * 503 AI_UNAVAILABLE, 502 AI_UPSTREAM_ERROR / INVALID_AI_RESPONSE,
 * 504 AI_TIMEOUT, 422 AI_REFUSED.
 */
// A 404 from a free provider usually means "this key cannot see that model
// name" rather than a dead key (a bad key fails earlier, with 400/401).
// Providers may therefore carry a fallback chain; the first model that
// answers is remembered for the rest of the process.
const workingModels = new Map()

// Newer Gemini keys can be locked to a newer model generation, so even a
// sensible static chain can miss every name. When the whole chain 404s,
// ask the provider which models this key can actually reach and try the
// chat/vision ones, in both bare and models/-prefixed spellings.
const NOT_CHAT_MODEL = ['tts', 'image', 'audio', 'embedding', 'lyria', 'video', 'robotics', 'computer-use', 'deep-research']
const discoveredModels = new Map()

export function pickDiscoveredModels(ids) {
  const scored = []
  for (const raw of ids) {
    if (typeof raw !== 'string') continue
    const bare = raw.replace(/^models\//, '')
    if (!bare.startsWith('gemini') || NOT_CHAT_MODEL.some(word => bare.includes(word))) continue
    const version = Number(bare.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0)
    const score = (bare.includes('flash') ? 0 : bare.includes('pro') ? 1 : 2)
      + (bare.includes('lite') ? 0.5 : 0) - version
    scored.push({ bare, raw, score })
  }
  scored.sort((a, b) => a.score - b.score)
  const names = []
  for (const entry of scored.slice(0, 3)) {
    names.push(entry.bare)
    if (entry.raw !== entry.bare) names.push(entry.raw)
  }
  return names
}

async function discoverModels(config, cacheKey) {
  if (discoveredModels.has(cacheKey)) return discoveredModels.get(cacheKey)
  let names = []
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.token}` },
      redirect: 'error',
    })
    if (response.ok) {
      const payload = await response.json()
      names = pickDiscoveredModels((payload.data ?? []).map(entry => entry?.id))
      if (names.length) console.error(`[ai] provider=${config.provider} discovered models for this key: ${names.join(', ')}`)
    }
  } catch { /* Discovery is best-effort; the static chain's error stands. */ }
  discoveredModels.set(cacheKey, names)
  return names
}

export async function callAiJson({ config, ...rest }) {
  const cacheKey = `${config.provider}|${config.baseUrl}`
  const remembered = workingModels.get(cacheKey)
  const candidates = [...new Set([remembered, ...(config.models ?? [config.model])].filter(Boolean))]
  let lastError
  let discovered = false
  for (let index = 0; index < candidates.length; index++) {
    const model = candidates[index]
    try {
      const parsed = await callOnce({ config, model, ...rest })
      if (remembered !== model) workingModels.set(cacheKey, model)
      return parsed
    } catch (error) {
      lastError = error
      if (error?.upstreamStatus !== 404) throw error
      console.error(`[ai] provider=${config.provider} model=${model} returned 404; trying the next model`)
      if (index === candidates.length - 1 && config.provider === 'gemini' && !discovered) {
        discovered = true
        const found = await discoverModels(config, cacheKey)
        for (const name of found) if (!candidates.includes(name)) candidates.push(name)
      }
    }
  }
  throw lastError
}

async function callOnce({ config, model, prompt, image, schema, schemaName, maxOutputTokens = 1_800, timeoutMs = DEFAULT_TIMEOUT_MS, signal, refusedMessage, timeoutMessage }) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout
  const attempt = async (responseFormat) => {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: requestSignal,
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: image } },
          ],
        }],
        response_format: responseFormat,
      }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return { status: response.status, payload: null }
    }
    return { status: response.status, payload: await response.json() }
  }

  let result
  try {
    result = await attempt({ type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } })
    if (result.status === 400) {
      result = await attempt({ type: 'json_object' })
    }
  } catch (error) {
    // Never log the key; provider + model + failure kind is enough to
    // diagnose a dead key or a wrong endpoint from the server console.
    console.error(`[ai] provider=${config.provider} model=${model} request failed: ${error?.name ?? 'Error'}`)
    
    if (timeout.aborted) {
      throw new LessonError(504, 'AI_TIMEOUT', timeoutMessage)
    }
    if (signal?.aborted || error instanceof LessonError) throw error
    if (error instanceof SyntaxError) throw invalidResponse()
    throw new LessonError(502, 'AI_UPSTREAM_ERROR', 'Không kết nối được với dịch vụ AI. Vui lòng thử lại.')
  }

  if (result.status !== 200 || !result.payload) {
    console.error(`[ai] provider=${config.provider} model=${model} upstream status=${result.status}`)
  }
  if (result.status === 429) {
    throw new LessonError(503, 'AI_UNAVAILABLE', 'AI đang bận hoặc đã hết lượt miễn phí. Vui lòng thử lại sau.')
  }
  if (result.status !== 200 || !result.payload) {
    const error = new LessonError(502, 'AI_UPSTREAM_ERROR', 'Dịch vụ AI gặp lỗi. Vui lòng thử lại.')
    error.upstreamStatus = result.status
    throw error
  }
  const message = result.payload.choices?.[0]?.message
  if (message?.refusal) {
    throw new LessonError(422, 'AI_REFUSED', refusedMessage)
  }
  let content = message?.content
  if (Array.isArray(content)) {
    content = content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('')
  }
  if (typeof content !== 'string' || !content.trim()) throw invalidResponse()
  // Free models like to wrap JSON in markdown fences despite instructions.
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    throw invalidResponse()
  }
}
