import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeImagePixels } from '../src/lib/imageProcessing.ts'
import { uploadedParts } from '../src/lib/uploadedPlan.ts'
import { colorName, strokeInstruction } from '../src/lib/uploadedPlan.ts'

test('ảnh tổng hợp: viền được truy ở độ phân giải mới, nét có điểm đầu/cuối và bị chia ở góc cua chứ không dài vô hạn', () => {
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
  assert.ok(result.study.shapes.length >= 1, 'phải tìm được ít nhất một khối')
  assert.ok(result.study.contours.length >= 3, 'đường bao phải được chia thành nhiều nét dạy được')
  for (const contour of result.study.contours) {
    assert.ok(contour.start && contour.end, 'mỗi nét phải ghi điểm đầu và điểm cuối')
    assert.ok(contour.length < 220, `nét quá dài để dạy từng nét: ${contour.length}`)
  }
})

const bounds = { x: 180, y: 160, width: 210, height: 260 }
const topEdge = { path: 'M180 160L390 160', bounds, center: { x: 285, y: 160 }, length: 210, shape: 0, start: { x: 180, y: 160 }, end: { x: 390, y: 160 } }
const rightEdge = { path: 'M390 160L390 420', bounds, center: { x: 390, y: 290 }, length: 260, shape: 0, start: { x: 390, y: 160 }, end: { x: 390, y: 420 } }

test('lời dạy được sinh từ hình học của chính nét đó: nét ngang khác nét dọc', () => {
  const a = strokeInstruction('contour', topEdge, bounds)
  const b = strokeInstruction('contour', rightEdge, bounds)
  assert.ok(a && b && a !== b, 'hai nét khác nhau không được dùng chung một câu hướng dẫn')
  assert.match(a, /sang phải/)
  assert.match(b, /xuống dưới/)
})

test('lời dạy lớp màu gọi được tên màu từ mã màu đã lấy mẫu', () => {
  assert.equal(colorName('#d43a2a'), 'đỏ')
  const red = { ...topEdge, color: '#d43a2a' }
  const instruction = strokeInstruction('color', red, bounds)
  assert.match(instruction, /đỏ/)
  assert.match(instruction, /#d43a2a/)
})

test('bước Nét chính: các nét trong cùng một phần có lời dạy riêng, không sao chép một câu cho cả lớp', () => {
  const result = {
    bounds, imageBounds: { x: 150, y: 100, width: 270, height: 360 },
    center: { x: 285, y: 290 }, angle: 0,
    blockInPath: 'M180 160L390 160L390 420L180 420Z', coarseEdges: '', contourEdges: '', fineEdges: '', lightHatching: '', darkHatching: '', crossHatching: '',
    grayscaleUrl: '', sourceWidth: 300, sourceHeight: 300,
    study: {
      confidence: 'clear',
      shapes: [{ bounds, center: { x: 285, y: 290 }, axis: [{ x: 285, y: 160 }, { x: 285, y: 420 }], section: [{ x: 180, y: 290 }, { x: 390, y: 290 }], path: 'M180 160L390 160L390 420L180 420Z', family: 'box', area: 50000 }],
      contours: [topEdge, rightEdge], details: [], tones: [], shadows: [], colors: [],
    },
  }
  const parts = uploadedParts(result, 7)
  const instructions = parts.flatMap(part => part.strokes.map(stroke => stroke.instruction))
  assert.ok(instructions.length >= 2)
  assert.equal(new Set(instructions).size, instructions.length, 'mỗi nét một lời dạy riêng')
})
