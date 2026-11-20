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
  { env: 'GEMINI_API_KEY', provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
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
    if (key) return { provider: candidate.provider, token: key, baseUrl: candidate.baseUrl, model: model ?? candidate.model }
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
export async function callAiJson({ config, prompt, image, schema, schemaName, maxOutputTokens = 1_800, timeoutMs = DEFAULT_TIMEOUT_MS, signal, refusedMessage, timeoutMessage }) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout
  const attempt = async (responseFormat) => {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: requestSignal,
      body: JSON.stringify({
        model: config.model,
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
    console.error(`[ai] provider=${config.provider} model=${config.model} request failed: ${error?.name ?? 'Error'}`)
    
    if (timeout.aborted) {
      throw new LessonError(504, 'AI_TIMEOUT', timeoutMessage)
    }
    if (signal?.aborted || error instanceof LessonError) throw error
    if (error instanceof SyntaxError) throw invalidResponse()
    throw new LessonError(502, 'AI_UPSTREAM_ERROR', 'Không kết nối được với dịch vụ AI. Vui lòng thử lại.')
  }

  if (result.status !== 200 || !result.payload) {
    console.error(`[ai] provider=${config.provider} model=${config.model} upstream status=${result.status}`)
  }
  if (result.status === 429) {
    throw new LessonError(503, 'AI_UNAVAILABLE', 'AI đang bận hoặc đã hết lượt miễn phí. Vui lòng thử lại sau.')
  }
  if (result.status !== 200 || !result.payload) {
    throw new LessonError(502, 'AI_UPSTREAM_ERROR', 'Dịch vụ AI gặp lỗi. Vui lòng thử lại.')
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
