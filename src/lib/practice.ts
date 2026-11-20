import type { ImagePoint } from './imageProcessing'

export type WorstSegment = 'đầu' | 'giữa' | 'cuối'
export interface PracticeScore {
  /** 0–100, higher is closer to the demonstrated stroke. */
  score: number
  meanDistance: number
  worstSegment: WorstSegment
  feedback: string
}

const distance = (a: ImagePoint, b: ImagePoint) => Math.hypot(a.x - b.x, a.y - b.y)

function distanceToSegment(p: ImagePoint, a: ImagePoint, b: ImagePoint): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const square = dx * dx + dy * dy
  const t = square ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / square)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

function polylineLength(points: ImagePoint[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0)
}

/** Resample a polyline to `count` points spaced evenly along its length. */
export function resample(points: ImagePoint[], count = 36): ImagePoint[] {
  if (points.length < 2 || count < 2) return points.slice(0, count)
  const total = polylineLength(points)
  if (!total) return Array.from({ length: count }, () => points[0])
  const out: ImagePoint[] = [points[0]]
  let walked = 0, target = total / (count - 1), nextAt = target
  for (let i = 1; i < points.length && out.length < count - 1; i++) {
    let segment = distance(points[i - 1], points[i])
    let from = points[i - 1]
    while (segment > 0 && walked + segment >= nextAt && out.length < count - 1) {
      const t = (nextAt - walked) / segment
      const hit = { x: from.x + (points[i].x - from.x) * t, y: from.y + (points[i].y - from.y) * t }
      out.push(hit)
      from = hit
      segment = distance(from, points[i])
      walked = nextAt
      nextAt += target
    }
    walked += segment
  }
  while (out.length < count) out.push(points[points.length - 1])
  return out
}

/**
 * Score a learner's stroke against the demonstrated one. Every sample of the
 * target is matched to its nearest point on the drawn polyline, so drawing
 * direction does not matter, but missing a third of the stroke or wandering
 * far from the line costs points. Distances are board units (800 × 640).
 */
export function scoreStroke(targetPoints: ImagePoint[], drawnPoints: ImagePoint[]): PracticeScore {
  const target = resample(targetPoints, 36)
  if (target.length < 2 || drawnPoints.length < 2) {
    return { score: 0, meanDistance: Infinity, worstSegment: 'đầu', feedback: 'Chưa có nét vẽ nào để chấm. Hãy vẽ đè lên nét đứt mờ trên bảng.' }
  }
  const distances = target.map(p => {
    let best = Infinity
    for (let i = 1; i < drawnPoints.length; i++) best = Math.min(best, distanceToSegment(p, drawnPoints[i - 1], drawnPoints[i]))
    return best
  })
  const mean = distances.reduce((a, b) => a + b, 0) / distances.length
  const thirds: [WorstSegment, number][] = (['đầu', 'giữa', 'cuối'] as WorstSegment[]).map((name, i) => {
    const slice = distances.slice(Math.floor(i * distances.length / 3), Math.floor((i + 1) * distances.length / 3))
    return [name, slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length)]
  })
  const worstSegment = thirds.sort((a, b) => b[1] - a[1])[0][0]
  const coverage = polylineLength(drawnPoints) / Math.max(1, polylineLength(targetPoints))
  const coveragePenalty = coverage < .6 ? (0.6 - coverage) * 55 : coverage > 1.7 ? (coverage - 1.7) * 18 : 0
  const score = Math.max(0, Math.min(100, Math.round(100 - mean * 2.4 - coveragePenalty)))
  const feedback = score >= 85
    ? `Rất sát nét mẫu. Đoạn ${worstSegment} là chỗ lệch nhất nhưng vẫn trong mức tốt — giữ nhịp tay này và sang nét tiếp theo.`
    : score >= 65
      ? `Khá ổn. Đoạn ${worstSegment} lệch nhất — ở lần tới hãy chậm lại đúng đoạn đó và bám theo nét mờ trước khi tăng tốc.`
      : score >= 40
        ? `Còn lệch khá nhiều, nhất là đoạn ${worstSegment}. Đừng cố vẽ nhanh: đặt bút đúng điểm đầu đã đánh dấu, đi từng đoạn ngắn theo nét mờ.`
        : `Lệch nhiều so với nét mẫu, nhất là đoạn ${worstSegment}. Xem lại phần Mô phỏng một lần, rồi vẽ lại chậm hơn, bám sát nét đứt mờ.`
  return { score, meanDistance: Math.round(mean * 10) / 10, worstSegment, feedback }
}
