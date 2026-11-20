import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreStroke } from '../src/lib/practice.ts'

const target = Array.from({ length: 41 }, (_, i) => ({ x: 100 + i * 5, y: 200 + Math.sin(i / 6) * 18 }))

test('vẽ trùng nét mẫu thì điểm gần tuyệt đối', () => {
  const result = scoreStroke(target, target.map(p => ({ ...p })))
  assert.ok(result.score >= 95, `expected >= 95, got ${result.score}`)
})

test('vẽ lệch đều 30 đơn vị thì điểm rơi mạnh và vẫn chỉ được đoạn lệch nhất', () => {
  const shifted = target.map(p => ({ x: p.x, y: p.y + 30 }))
  const result = scoreStroke(target, shifted)
  assert.ok(result.score < 45, `expected < 45, got ${result.score}`)
  assert.ok(['đầu', 'giữa', 'cuối'].includes(result.worstSegment))
  assert.ok(result.feedback.length > 20)
})

test('chỉ vẽ nửa nét thì bị trừ điểm bao phủ dù phần đã vẽ rất sát', () => {
  const half = target.slice(0, 20)
  const result = scoreStroke(target, half)
  assert.ok(result.score < 80, `expected < 80, got ${result.score}`)
})

test('chưa vẽ gì thì 0 điểm kèm hướng dẫn, không crash', () => {
  const result = scoreStroke(target, [])
  assert.equal(result.score, 0)
  assert.match(result.feedback, /Chưa có nét/)
})
