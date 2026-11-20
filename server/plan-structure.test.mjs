import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeImagePixels } from '../src/lib/imageProcessing.ts'
import { uploadedParts } from '../src/lib/uploadedPlan.ts'

const makeShape = (x, y, width, height) => ({
  bounds: { x, y, width, height },
  center: { x: x + width / 2, y: y + height / 2 },
  axis: [{ x, y: y + height / 2 }, { x: x + width, y: y + height / 2 }],
  section: [{ x: x + width / 2, y }, { x: x + width / 2, y: y + height }],
  path: 'M0 0', family: 'mass', area: width * height,
})
const makeTrace = (cx, cy, shape) => ({
  path: `M${cx - 10} ${cy}L${cx + 10} ${cy}`,
  bounds: { x: cx - 10, y: cy - 2, width: 20, height: 4 },
  center: { x: cx, y: cy }, start: { x: cx - 10, y: cy }, end: { x: cx + 10, y: cy },
  length: 20, shape,
})

function fakeResult() {
  const tones = []
  for (let i = 0; i < 30; i++) tones.push(makeTrace(150 + (i % 5) * 30, 180 + Math.floor(i / 5) * 25, 0))
  for (let i = 0; i < 5; i++) tones.push(makeTrace(450 + i * 20, 200 + i * 30, 1))
  tones.push(makeTrace(680, 480, 0), makeTrace(660, 470, 1), makeTrace(690, 490, 0)) // rác ngoài mọi khối
  return {
    bounds: { x: 100, y: 100, width: 600, height: 400 },
    imageBounds: { x: 100, y: 88, width: 600, height: 455 },
    study: {
      shapes: [makeShape(120, 150, 200, 200), makeShape(400, 150, 180, 260)],
      contours: [], details: [], tones, shadows: [], colors: [], confidence: 'clear',
    },
  }
}

test('lớp sắc độ dạy theo từng khối: bỏ nét ngoài chủ thể, mỗi khối tối đa 12 lượt đều nhau', () => {
  const parts = uploadedParts(fakeResult(), 8)
  assert.equal(parts.length, 2, `phải có đúng 2 phần theo 2 khối, nhận ${parts.length}: ${parts.map(p => p.label).join(' | ')}`)
  const total = parts.reduce((sum, part) => sum + part.strokes.length, 0)
  assert.equal(total, 17, `30 nét khối A phải rút còn 12, khối B giữ 5, 3 nét rác bị loại; nhận tổng ${total}`)
  assert.ok(parts.every(part => part.label.startsWith('Mảng sáng tối · ')), `nhãn phải gọi tên khối: ${parts.map(p => p.label).join(' | ')}`)
})

test('có AI thì các khối gộp thành một bộ phận duy nhất và đi theo thứ tự của AI', () => {
  const aiParts = [{ name: 'Toàn thân', note: 'Một khối liền.', order: 1, box: { x: 0.02, y: 0.05, width: 0.95, height: 0.9 } }]
  const parts = uploadedParts(fakeResult(), 8, aiParts)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].label, 'Mảng sáng tối · Toàn thân')
  assert.equal(parts[0].strokes.length, 12)
})

test('bước hoàn thiện nhấn lại toàn bộ đường bao ngoài của khối, không chỉ một mép dài nhất', () => {
  const result = fakeResult()
  const exterior = [makeTrace(200, 160, 0), makeTrace(300, 250, 0), makeTrace(200, 330, 0)]
  exterior.forEach(trace => { trace.exterior = true })
  const interiorLong = makeTrace(220, 250, 0)
  interiorLong.length = 999
  result.study.contours = [...exterior, interiorLong]
  const parts = uploadedParts(result, 12)
  const first = parts.find(part => part.id === 'finish-0')
  assert.ok(first)
  assert.equal(first.strokes.length, 3, `phải nhấn đủ 3 đoạn bao ngoài, nhận ${first.strokes.length}`)
  assert.ok(first.strokes.every((strokeItem, i) => strokeItem.path === exterior[i].path), 'chỉ nhấn nét bao ngoài, không lấy nét trong dài nhất')
})

test('đường bao khối giữ được phần mảnh như chân thay vì bị đơn giản hóa nuốt mất', () => {
  const w = 200, h = 200
  const pixels = new Uint8ClampedArray(w * h * 4).fill(255)
  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      pixels[i] = 50; pixels[i + 1] = 48; pixels[i + 2] = 45
    }
  }
  fill(60, 40, 150, 120)   // thân
  fill(70, 120, 78, 180)   // chân mảnh rộng 8px
  const result = analyzeImagePixels(pixels, w, h)
  const legTipBoardY = result.imageBounds.y + (180 / h) * result.imageBounds.height
  const deepest = Math.max(...result.study.shapes.map(shape => shape.bounds.y + shape.bounds.height))
  assert.ok(deepest >= legTipBoardY - 14, `bao khối phải chạm gần đầu chân (sâu nhất ${deepest.toFixed(1)}, đầu chân ${legTipBoardY.toFixed(1)})`)
})

test('nét sắc độ chạy theo trục dài của khối thay vì quét ngang toàn ảnh', () => {
  const w = 220, h = 220
  const pixels = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - 110) / 34, dy = (y - 110) / 85
    if (dx * dx + dy * dy <= 1) {
      const i = (y * w + x) * 4
      const v = Math.round(60 + (y / h) * 140)
      pixels[i] = v; pixels[i + 1] = v - 6; pixels[i + 2] = v - 12
    }
  }
  const result = analyzeImagePixels(pixels, w, h)
  assert.ok(result.study.tones.length >= 4, `cần có nét sắc độ để kiểm tra, nhận ${result.study.tones.length}`)
  const tilted = result.study.tones.filter(t => t.start && t.end && Math.abs(t.end.y - t.start.y) > Math.abs(t.end.x - t.start.x))
  assert.ok(tilted.length >= 2, `khối cao dọc phải có nét sắc độ chạy dọc theo thân, nhận ${tilted.length}/${result.study.tones.length} nét dọc`)
})
