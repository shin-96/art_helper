import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import { DEFAULT_TIMEOUT_MS, generateLesson, LessonError, LESSON_MODEL, focuses, levels } from './lesson.mjs'
import { generateParts } from './parts.mjs'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_JSON_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4096
const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff])

export const app = express()
app.disable('x-powered-by')

function sendError(res, status, code, message) {
  return res.status(status).json({ error: message, code })
}

function apiKey() {
  return process.env.OPENAI_API_KEY?.trim()
}

function hasImageSignature(bytes, mime) {
  switch (mime) {
    case 'image/png':
      return bytes.subarray(0, PNG_HEADER.length).equals(PNG_HEADER)
    case 'image/jpeg':
      return bytes.subarray(0, JPEG_HEADER.length).equals(JPEG_HEADER)
    case 'image/webp':
      return bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP'
    case 'image/gif':
      return ['GIF87a', 'GIF89a'].includes(bytes.toString('latin1', 0, 6))
    default:
      return false
  }
}

function imageTooLarge() {
  return new LessonError(413, 'IMAGE_TOO_LARGE', 'Ảnh không được vượt quá 6 MB.')
}

function invalidImage() {
  return new LessonError(400, 'INVALID_IMAGE', 'Dữ liệu ảnh không hợp lệ. Hãy chọn lại ảnh.')
}

function validateImage(image) {
  if (typeof image !== 'string') throw invalidImage()

  const separator = image.indexOf(',')
  const prefix = separator === -1 || separator > 64 ? '' : image.slice(0, separator)
  const match = /^data:([^;,]+);base64$/i.exec(prefix)
  if (!match) throw invalidImage()

  const mime = match[1].toLowerCase()
  if (!SUPPORTED_MIME_TYPES.has(mime)) {
    throw new LessonError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Hãy chọn ảnh PNG, JPEG, WebP hoặc GIF tĩnh.')
  }

  const encoded = image.slice(separator + 1)
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw imageTooLarge()
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw invalidImage()

  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > MAX_IMAGE_BYTES) throw imageTooLarge()
  if (bytes.toString('base64') !== encoded || !hasImageSignature(bytes, mime)) throw invalidImage()
  return prefix === `data:${mime};base64` ? image : `data:${mime};base64,${encoded}`
}

app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

app.get('/api/health', (_req, res) => {
  const aiConfigured = Boolean(apiKey())
  res.json({ aiConfigured, model: aiConfigured ? LESSON_MODEL : null })
})

function requireAnalyzeRequest(req, res, next) {
  const key = apiKey()
  if (!key) {
    return sendError(res, 503, 'AI_NOT_CONFIGURED', 'Chưa cấu hình khóa OpenAI. Bạn có thể dùng bài mẫu.')
  }
  if (!req.is('application/json')) {
    return sendError(res, 415, 'UNSUPPORTED_CONTENT_TYPE', 'Hãy gửi yêu cầu dưới dạng application/json.')
  }
  res.locals.apiKey = key
  next()
}

app.post('/api/analyze', requireAnalyzeRequest, express.json({ limit: MAX_JSON_BYTES, inflate: false }), async (req, res, next) => {
  const { image, level, focus } = req.body ?? {}
  if (typeof level !== 'string' || !Object.hasOwn(levels, level)) {
    return sendError(res, 400, 'INVALID_LEVEL', 'Trình độ đã chọn không hợp lệ.')
  }
  if (typeof focus !== 'string' || !Object.hasOwn(focuses, focus)) {
    return sendError(res, 400, 'INVALID_FOCUS', 'Trọng tâm kỹ thuật đã chọn không hợp lệ.')
  }

  const controller = new AbortController()
  const abortOnClose = () => {
    if (!res.writableEnded) controller.abort()
  }
  res.once('close', abortOnClose)

  try {
    const imageDataUrl = validateImage(image)
    const configuredTimeout = Number(process.env.OPENAI_TIMEOUT_MS)
    const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout > 0 && configuredTimeout <= 2_147_483_647
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS
    const lesson = await generateLesson({
      apiKey: res.locals.apiKey,
      image: imageDataUrl,
      level,
      focus,
      timeoutMs,
      signal: controller.signal,
    })
    if (!controller.signal.aborted) res.json({ lesson, source: 'ai' })
  } catch (error) {
    if (!controller.signal.aborted) next(error)
  } finally {
    res.off('close', abortOnClose)
  }
})

app.post('/api/parts', requireAnalyzeRequest, express.json({ limit: MAX_JSON_BYTES, inflate: false }), async (req, res, next) => {
  const { image } = req.body ?? {}
  const controller = new AbortController()
  const abortOnClose = () => {
    if (!res.writableEnded) controller.abort()
  }
  res.once('close', abortOnClose)

  try {
    const imageDataUrl = validateImage(image)
    const configuredTimeout = Number(process.env.OPENAI_TIMEOUT_MS)
    const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout > 0 && configuredTimeout <= 2_147_483_647
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS
    const result = await generateParts({
      apiKey: res.locals.apiKey,
      image: imageDataUrl,
      timeoutMs,
      signal: controller.signal,
    })
    if (!controller.signal.aborted) res.json({ subject: result.subject, parts: result.parts, source: 'ai' })
  } catch (error) {
    if (!controller.signal.aborted) next(error)
  } finally {
    res.off('close', abortOnClose)
  }
})

app.use('/api', (_req, res) => sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy đường dẫn API.'))

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const distIndex = join(dist, 'index.html')
if (process.env.NODE_ENV === 'production' || existsSync(distIndex)) {
  app.use(express.static(dist))
  app.get('*', (req, res, next) => {
    if (extname(req.path) || !req.accepts('html') || !existsSync(distIndex)) return next()
    res.sendFile(distIndex)
  })
}

app.use((_req, res) => sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy nội dung được yêu cầu.'))

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error)
  if (error instanceof LessonError) return sendError(res, error.status, error.code, error.message)
  if (error.type === 'entity.too.large') {
    const { status, code, message } = imageTooLarge()
    return sendError(res, status, code, message)
  }
  if (error.status === 415) {
    return sendError(res, 415, 'UNSUPPORTED_CONTENT_TYPE', 'Yêu cầu dùng bảng mã hoặc cách nén không được hỗ trợ.')
  }
  if (error.status === 400) {
    return sendError(res, 400, 'INVALID_JSON', 'Nội dung JSON không hợp lệ.')
  }
  return sendError(res, 500, 'INTERNAL_ERROR', 'Máy chủ gặp lỗi. Vui lòng thử lại.')
})

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? '3001')
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  app.listen(port, () => console.log(`Drawing lesson server listening on port ${port}`))
}
