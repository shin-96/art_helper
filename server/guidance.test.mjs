import test from 'node:test'
import assert from 'node:assert/strict'
import { STAGES } from '../src/data/stages.ts'
import { uploadedParts } from '../src/lib/uploadedPlan.ts'

const trace = (path, shape = 0, color = '#7b6954') => ({ path, bounds: { x: 180, y: 160, width: 210, height: 260 }, center: { x: 285, y: 290 }, length: 120, shape, color, width: 2, opacity: .7 })
const result = {
  bounds: { x: 180, y: 160, width: 210, height: 260 },
  imageBounds: { x: 150, y: 100, width: 270, height: 360 },
  center: { x: 285, y: 290 }, angle: 0,
  blockInPath: 'M180 160L390 160L390 420L180 420Z', coarseEdges: 'M180 160L390 160', contourEdges: 'M180 160L390 160L390 420L180 420Z', fineEdges: 'M220 220L350 220', lightHatching: 'M230 250l40 -20M250 270l40 -20', darkHatching: 'M330 300l40 -20M340 330l40 -20', crossHatching: 'M300 300l20 20', grayscaleUrl: '', sourceWidth: 300, sourceHeight: 300,
  study: {
    confidence: 'clear',
    shapes: [{ bounds: { x: 180, y: 160, width: 210, height: 260 }, center: { x: 285, y: 290 }, axis: [{ x: 285, y: 160 }, { x: 285, y: 420 }], section: [{ x: 180, y: 290 }, { x: 390, y: 290 }], path: 'M180 290A105 130 0 1 0 390 290A105 130 0 1 0 180 290Z', family: 'ellipse', area: 50000 }],
    contours: [trace('M180 160L390 160L390 420L180 420Z')], details: [trace('M220 220L350 220')], tones: [trace('M230 250l40 -20')], shadows: [trace('M330 300l40 -20')], colors: [trace('M220 300l80 -20', 0, '#bc6f52')],
  },
}

test('kế hoạch ảnh có đúng thứ tự 13 giai đoạn và mỗi lớp có nét', () => {
  assert.deepEqual(STAGES.map(stage => stage.label), ['Quan sát','Khung bao','Dựng khối','Tỉ lệ','Khối 3D','Kiểm tra','Tẩy đường dựng','Nét chính','Sắc độ','Đổ bóng','Chi tiết','Lên màu','Hoàn thiện'])
  for (let step = 0; step < STAGES.length; step++) {
    const parts = uploadedParts(result, step)
    assert.ok(parts.length > 0, `stage ${step + 1} needs a part`)
    assert.ok(parts.every(part => part.strokes.length > 0))
    assert.ok(parts.every(part => part.bounds.width > 0 && part.bounds.height > 0))
  }
})

test('giai đoạn tẩy mô phỏng đúng các đường dựng và lớp màu có màu ảnh', () => {
  const erase = uploadedParts(result, 6).flatMap(part => part.strokes)
  assert.ok(erase.length > 0 && erase.every(stroke => stroke.kind === 'erase'))
  const color = uploadedParts(result, 11).flatMap(part => part.strokes)
  assert.ok(color.length > 0 && color.some(stroke => stroke.kind === 'color' && stroke.color === '#bc6f52'))
})
