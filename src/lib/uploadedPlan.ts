import type { GuidedPart, GuidedStroke } from './guidedDrawing'
import type { ImageBounds, ImagePoint, ImageShape, ImageTrace, ProcessedImage } from './imageProcessing'

const round = (n: number) => Math.round(n * 10) / 10
const xy = ({ x, y }: ImagePoint) => `${round(x)} ${round(y)}`
const line = (from: ImagePoint, to: ImagePoint) => `M${xy(from)}L${xy(to)}`
const point = (x: number, y: number): ImagePoint => ({ x, y })
const centerOf = (b: ImageBounds) => point(b.x + b.width / 2, b.y + b.height / 2)
const boundsOf = (traces: ImageTrace[]) => {
  const x = Math.min(...traces.map(t => t.bounds.x))
  const y = Math.min(...traces.map(t => t.bounds.y))
  return {
    x, y,
    width: Math.max(8, Math.max(...traces.map(t => t.bounds.x + t.bounds.width)) - x),
    height: Math.max(8, Math.max(...traces.map(t => t.bounds.y + t.bounds.height)) - y),
  }
}
const direction = (p: ImagePoint, b: ImageBounds) => {
  const x = (p.x - b.x) / Math.max(1, b.width), y = (p.y - b.y) / Math.max(1, b.height)
  const horizontal = x < .38 ? 'bên trái' : x > .62 ? 'bên phải' : ''
  const vertical = y < .38 ? 'phía trên' : y > .62 ? 'phía dưới' : ''
  return [vertical, horizontal].filter(Boolean).join(' ') || 'ở giữa'
}
/** Start/end of a trace: prefer the geometry recorded during analysis and
 *  fall back to parsing the path so older plans still get real instructions. */
function traceEnds(trace: ImageTrace): { start: ImagePoint; end: ImagePoint } | null {
  if (trace.start && trace.end) return { start: trace.start, end: trace.end }
  const values = trace.path.match(/-?\d+\.?\d*/g)?.map(Number) ?? []
  if (values.length < 4) return null
  return { start: point(values[0], values[1]), end: point(values[values.length - 2], values[values.length - 1]) }
}

function compassWord(from: ImagePoint, to: ImagePoint): string {
  const dx = to.x - from.x, dy = to.y - from.y
  if (Math.hypot(dx, dy) < 6) return 'một vòng gần như khép kín'
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  if (angle <= -157.5 || angle > 157.5) return 'sang trái'
  if (angle > 112.5) return 'chéo xuống trái'
  if (angle > 67.5) return 'xuống dưới'
  if (angle > 22.5) return 'chéo xuống phải'
  if (angle > -22.5) return 'sang phải'
  if (angle > -67.5) return 'chéo lên phải'
  if (angle > -112.5) return 'lên trên'
  return 'chéo lên trái'
}

function curvatureWord(trace: ImageTrace, start: ImagePoint, end: ImagePoint): string {
  const straight = Math.hypot(end.x - start.x, end.y - start.y)
  if (straight < 5 && trace.length > 20) return 'cong vòng, gần như khép kín'
  const ratio = trace.length / Math.max(1, straight)
  if (ratio < 1.06) return 'gần như thẳng'
  if (ratio < 1.3) return 'cong nhẹ'
  if (ratio < 1.7) return 'cong rõ'
  return 'gấp khúc nhiều lần'
}

function lengthWord(length: number): string {
  if (length < 30) return 'Đây là nét ngắn'
  if (length < 85) return 'Đây là nét vừa'
  return 'Đây là nét dài — có thể thở ra chậm trong lúc kéo'
}

/** A rough Vietnamese colour name for a sampled hex, so colour instructions
 *  can say the colour instead of only showing a code. */
export function colorName(hexValue?: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hexValue ?? '')
  if (!match) return 'màu mẫu'
  const n = parseInt(match[1], 16)
  const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), lum = (r + g + b) / 3
  if (max - min < 18 || (max - min) / Math.max(1, max) < .13) return lum > 205 ? 'trắng ngà' : lum > 145 ? 'xám nhạt' : lum > 75 ? 'xám' : lum > 32 ? 'xám đậm' : 'đen'
  let hue = Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180 / Math.PI
  if (hue < 0) hue += 360
  if (hue >= 15 && hue < 45 && lum < 115) return 'nâu'
  if (hue < 15 || hue >= 345) return 'đỏ'
  if (hue < 45) return 'cam'
  if (hue < 70) return 'vàng'
  if (hue < 160) return 'xanh lá'
  if (hue < 200) return 'xanh lơ'
  if (hue < 255) return 'xanh dương'
  if (hue < 290) return 'tím'
  return 'hồng'
}

/** One instruction per stroke, built from that stroke's own geometry:
 *  where it starts, which way it travels, how it curves and where it ends. */
export function strokeInstruction(layer: string, trace: ImageTrace, partBounds: ImageBounds): string | null {
  const ends = traceEnds(trace)
  if (!ends) return null
  const { start, end } = ends
  const from = direction(start, partBounds), to = direction(end, partBounds)
  if (trace.length < 8) {
    // A dab, not a travelling stroke: say where it lands and, for colour, what it is.
    if (layer === 'color') return `Chấm một dải ${colorName(trace.color)}${trace.color ? ` (${trace.color})` : ''} ngắn ở ${from} của phần này, giữ nguyên mảng sáng bên cạnh.`
    if (layer === 'tone' || layer === 'shadow') return `Chấm một vệt chì ngắn ở ${from} của phần này, lực nhẹ và đều.`
    return null
  }
  const way = compassWord(start, end), curve = curvatureWord(trace, start, end)
  if (from === to) {
    const place = `ở vùng ${from} của phần này`
    switch (layer) {
      case 'tone': return `Phủ một lớp chì nhẹ ${place}: kéo ${way} theo đường ${curve}, giữ lực đều và nhạt rồi nhấc bút.`
      case 'shadow': return `Tăng đậm ${place}: kéo ${way} theo đường ${curve}, dừng trước rìa chuyển sáng.`
      case 'color': return `Tô ${colorName(trace.color)}${trace.color ? ` (${trace.color})` : ''} ${place}: kéo ${way} theo đường ${curve} rồi nhấc cọ.`
      case 'detail': return `Đặt đầu bút thật nhẹ ${place}, đi ${way} theo đường ${curve}. ${lengthWord(trace.length)} — giảm lực ở cuối nét.`
      default: return `Đặt bút ${place}, kéo ${way} theo đường ${curve}. ${lengthWord(trace.length)} — đi liền một hơi và chỉ nhấc bút ở điểm cuối.`
    }
  }
  switch (layer) {
    case 'tone':
      return `Phủ một lớp chì nhẹ: đặt bút ở ${from} của phần này, kéo ${way} theo đường ${curve} tới ${to}. Giữ lực đều và nhạt, nhấc bút ngay khi tới điểm cuối.`
    case 'shadow':
      return `Tăng đậm trong vùng tối: từ ${from} kéo ${way} theo đường ${curve} tới ${to}. Dừng trước rìa chuyển sáng, đừng vạch viền cứng quanh bóng.`
    case 'color':
      return `Tô ${colorName(trace.color)}${trace.color ? ` (${trace.color})` : ''}: kéo một dải liền từ ${from} ${way} tới ${to}, rồi nhấc cọ. Chừa lại mảng sáng đã dựng ở các bước trước.`
    case 'detail':
      return `Đặt đầu bút thật nhẹ ở ${from} của phần này, đi ${way} theo đường ${curve} tới ${to}. ${lengthWord(trace.length)} — giảm lực ở cuối nét rồi nhấc bút.`
    default:
      return `Đặt bút ở ${from} của phần này, kéo ${way} theo đường ${curve} tới ${to}. ${lengthWord(trace.length)} — đi liền một hơi và chỉ nhấc bút ở điểm cuối.`
  }
}

const construction = { kind: 'construction', color: '#ad6f53', width: 1.65, opacity: .67 } as const
const checkpointStyle = { kind: 'check', color: '#3e7466', width: 2.4, opacity: .94 } as const
const stroke = (path: string, label: string, instruction: string, style: Partial<GuidedStroke> = construction): GuidedStroke => ({ ...style, path, label, instruction })
const part = (id: string, label: string, shape: string, bounds: ImageBounds, strokes: GuidedStroke[], checkpoint: string, correction: string): GuidedPart => ({
  id, label, shape, bounds, strokes, checkpoint, correction,
})

const families: Record<ImageShape['family'], string> = { ellipse: 'Ôvan', box: 'Hộp', wedge: 'Khối nêm', mass: 'Khối đa giác' }
const shapeName = (shape: ImageShape, bounds: ImageBounds) => `${families[shape.family]} ${direction(shape.center, bounds)}`

function dimensions(result: ProcessedImage): ImageShape[] {
  if (result.study?.shapes.length) return result.study.shapes
  const b = result.bounds, center = centerOf(b)
  return [{
    bounds: b, center, path: result.blockInPath || `M${xy(point(b.x, b.y))}h${round(b.width)}v${round(b.height)}h${round(-b.width)}Z`,
    axis: [point(center.x, b.y), point(center.x, b.y + b.height)],
    section: [point(b.x, center.y), point(b.x + b.width, center.y)],
    family: 'mass', area: b.width * b.height,
  }]
}

function frameParts(b: ImageBounds) {
  const topLeft = point(b.x, b.y), topRight = point(b.x + b.width, b.y)
  const bottomRight = point(b.x + b.width, b.y + b.height), bottomLeft = point(b.x, b.y + b.height)
  return [part('frame', 'Đặt khung bao', 'Khung đi qua bốn mốc ngoài cùng, giữ nguyên tỷ lệ ảnh trong bảng vẽ.', b, [
    stroke(line(topLeft, topRight), 'Cạnh trên', 'Từ mốc trên trái kéo ngang đến mốc phải bằng lực nhẹ.'),
    stroke(line(topRight, bottomRight), 'Cạnh phải', 'Đặt bút ở góc trên phải, kéo xuống tới đáy.'),
    stroke(line(bottomRight, bottomLeft), 'Cạnh dưới', 'Từ góc dưới phải, kéo một nét ngang về trái.'),
    stroke(line(bottomLeft, topLeft), 'Cạnh trái', 'Khép khung bằng một nét nhẹ hướng lên.'),
  ], 'Chiều cao và chiều ngang có cùng tương quan như ảnh.', 'So lại bốn mép trước khi dựng khối; chưa kẻ theo chi tiết.')]
}

function blockParts(shapes: ImageShape[], bounds: ImageBounds, approximate = false) {
  return shapes.map((shape, index) => part(`block-${index}`, shapeName(shape, bounds),
    (index === 0 ? 'Khối có diện tích lớn nhất được dựng trước. Hình này đơn giản hóa bề mặt, không xác định tên bộ phận.' : 'Khối nhỏ hơn được đặt theo chỗ nối và khoảng trống quan sát được.')
      + (approximate ? ' Lưu ý: nền và chủ thể gần màu nhau nên khối này là mốc ước lượng — hãy đối chiếu với ảnh gốc mờ ở bước Quan sát trước khi theo nét.' : ''),
    shape.bounds, [stroke(shape.path, 'Phác hình khối', 'Đi một vòng nhẹ theo hình bao giản lược, dừng ở từng đoạn đổi hướng.')],
    'Khối đã chiếm đúng vùng tương đối; mép tạm chưa phải đường viền cuối.', 'So lại với khối liền kề trước khi thêm trục hoặc mặt cắt.'))
}

function proportionsParts(shapes: ImageShape[], bounds: ImageBounds) {
  return shapes.map((shape, index) => part(`ratio-${index}`, `Trục và tỷ lệ · ${shapeName(shape, bounds)}`,
    'Trục bám theo hướng dài của vùng ảnh. Một mốc ngang đặt tại mặt cắt giữa khối.', shape.bounds, [
      stroke(line(...shape.axis), 'Trục dài', 'Kéo dọc theo hướng chính, không ép khối đối xứng nếu ảnh nghiêng.'),
      stroke(line(...shape.section), 'Mốc ngang', 'Đi từ mép này sang mép kia qua giữa khối, dùng nét tạm.'),
    ], 'Mốc ngang nằm đúng giữa vùng cần kiểm tra và cho thấy bề rộng tương đối.', 'Xem vị trí giao trục, chiều dài và chiều rộng trước khi dựng thể tích.'))
}

function volumeParts(shapes: ImageShape[], bounds: ImageBounds) {
  return shapes.map((shape, index) => {
    const [a, b] = shape.section
    const c = point((a.x + b.x) / 2, (a.y + b.y) / 2)
    const width = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
    const depth = Math.min(width * .43, Math.hypot(shape.axis[1].x - shape.axis[0].x, shape.axis[1].y - shape.axis[0].y) * .43)
    const dx = (a.y - b.y) / width * depth, dy = (b.x - a.x) / width * depth
    const front = point(c.x + dx, c.y + dy), back = point(c.x - dx, c.y - dy)
    return part(`volume-${index}`, `Mặt cắt · ${shapeName(shape, bounds)}`,
      'Dùng hai cung ôvan để gợi thể tích và hướng bề mặt. Đây là đường dựng giả định trên ảnh phẳng, không phải một mép nhìn thấy trong ảnh.', shape.bounds, [
        stroke(`M${xy(a)}Q${xy(front)} ${xy(b)}`, 'Cung phía trước', 'Nối hai đầu mốc ngang bằng một cung cong nông.'),
        stroke(`M${xy(b)}Q${xy(back)} ${xy(a)}`, 'Cung phía khuất', 'Đi vòng ngược về đầu mốc với nét mờ hơn để phân biệt mặt khuất.', { ...construction, opacity: .36 }),
      ], 'Hai cung gặp nhau ở hai đầu, ôvan nằm cùng hướng với mặt cắt.', 'Giảm độ phồng nếu mặt cắt lấn ra ngoài khối. Không tô đậm đường dựng.')
  })
}

function compare(b: ImageBounds, center: ImagePoint, style = checkpointStyle): GuidedStroke[] {
  const tick = Math.max(4, Math.min(13, Math.min(b.width, b.height) * .055))
  return [
    stroke(line(point(center.x, b.y + tick), point(center.x, b.y - tick)), 'Mốc trên', 'Đối chiếu điểm cao nhất của vùng với ảnh tham chiếu.', style),
    stroke(line(point(b.x + tick, center.y), point(b.x - tick, center.y)), 'Mốc trái', 'So khoảng trống phía trái trước khi đi nét chính.', style),
    stroke(line(point(center.x, b.y + b.height - tick), point(center.x, b.y + b.height + tick)), 'Mốc dưới', 'Kiểm tra điểm thấp nhất và khoảng trống phía dưới.', style),
    stroke(line(point(b.x + b.width - tick, center.y), point(b.x + b.width + tick, center.y)), 'Mốc phải', 'So khoảng rộng qua mốc phải; dấu đo này không để lại chì.', style),
  ]
}

function legacy(pathText: string | undefined, bounds: ImageBounds): ImageTrace[] {
  return (pathText?.match(/M[^M]*/g) ?? []).flatMap(path => {
    const points: ImagePoint[] = []
    let cursor = point(0, 0)
    for (const command of path.matchAll(/([MLl])([^MLl]*)/g)) {
      const values = command[2].match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
      for (let i = 0; i + 1 < values.length; i += 2) {
        cursor = command[1] === 'l' ? point(cursor.x + values[i], cursor.y + values[i + 1]) : point(values[i], values[i + 1])
        points.push(cursor)
      }
    }
    if (points.length < 2) return []
    const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
    const center = points[Math.floor(points.length / 2)]
    return [{ path, center, start: points[0], end: points.at(-1), shape: +(center.y > bounds.y + bounds.height * .5), bounds: { x, y, width: Math.max(1, Math.max(...points.map(p => p.x)) - x), height: Math.max(1, Math.max(...points.map(p => p.y)) - y) }, length: points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0) }]
  })
}

type TraceLayer = 'contour' | 'tone' | 'shadow' | 'detail' | 'color'
const layerText: Record<TraceLayer, { label: string; shape: string; stroke: string; instruction: string; checkpoint: string; correction: string; kind: GuidedStroke['kind']; limit: number }> = {
  contour: { label: 'Nét chính', shape: 'Đi lần lượt theo những đoạn biên nối liền của khối. Giữ đường bao trước các mép bên trong.', stroke: 'Nét biên', instruction: 'Đặt bút tại đầu đã đánh dấu, kéo một đường liền đến điểm dừng. Giảm lực khi chuyển từ mép rõ sang mép mềm.', checkpoint: 'Đọc được hình dáng chính mà không cần những cạnh vụn trên nền.', correction: 'Giữ những mép đủ rõ để nhận hình; không tự nối qua một khoảng trống lớn.', kind: 'ink', limit: 108 },
  tone: { label: 'Mảng sáng tối', shape: 'Đặt lớp chì nhạt theo vùng có sắc độ trung bình, chừa khoảng sáng trước khi làm đậm.', stroke: 'Lớp chì nhẹ', instruction: 'Kéo đều một nét mỏng trên vùng có sắc độ. Nhấc bút trước khi sang nét khác.', checkpoint: 'Các mảng sáng vẫn thoáng; chuyển sắc không phá hình dáng.', correction: 'Không phủ cùng một độ đậm lên toàn bộ vùng.', kind: 'tone', limit: 72 },
  shadow: { label: 'Vùng tối', shape: 'Tăng độ đậm ở những vùng tối đo được từ ảnh. Không tự suy diễn bóng đổ hoặc nguồn sáng khi ảnh chưa rõ.', stroke: 'Nét tối', instruction: 'Đi nét trong vùng tối của ảnh; dừng ở rìa chuyển sáng, không vạch viền cứng quanh bóng.', checkpoint: 'Tông tối nằm đúng vùng, không che mất phần trung gian.', correction: 'Giữ vùng bóng đậm vừa đủ để vẫn nhìn thấy bề mặt kế bên.', kind: 'tone', limit: 62 },
  detail: { label: 'Chi tiết chọn lọc', shape: 'Chọn các cạnh nhỏ có tương phản trong khối đã dựng; không vẽ hết mọi vân nền.', stroke: 'Nét chi tiết', instruction: 'Đặt đầu bút nhẹ, đi một nét ngắn liên tục và giảm lực khi nhấc bút.', checkpoint: 'Chi tiết không đậm hoặc dày hơn đường bao chính.', correction: 'Bỏ các nét vụn không làm rõ hình.', kind: 'ink', limit: 54 },
  color: { label: 'Lên màu', shape: 'Mỗi nét cọ có màu lấy từ vùng tương ứng trong ảnh. Các mảng được bồi lần lượt, không phủ ảnh gốc lên giấy.', stroke: 'Nét cọ màu', instruction: 'Kéo một dải màu ngắn qua vùng mẫu, rồi nhấc cọ. Giữ những ranh giới sáng tối đã xác định.', checkpoint: 'Nhìn ra các mảng màu và độ đậm nhạt chính của ảnh.', correction: 'So màu với vùng ngay cạnh; không dùng một màu duy nhất cho cả khối.', kind: 'color', limit: 176 },
}

function tracedParts(result: ProcessedImage, layer: TraceLayer, traces: ImageTrace[]) {
  const text = layerText[layer]
  if (!traces.length) return [part(`${layer}-review`, text.label, 'Không tìm thấy nét đủ rõ ở lớp này để vẽ tự động.', result.bounds, compare(result.bounds, centerOf(result.bounds)).slice(0, 1), 'Giữ nguyên bản vẽ, không thêm nét suy đoán.', 'Đối chiếu ảnh trước khi sang lớp sau.')]
  const candidates = traces.slice(0, text.limit)
  const grouped = new Map<number, ImageTrace[]>()
  for (const t of candidates) {
    const previous = grouped.get(t.shape)
    if (previous) previous.push(t)
    else grouped.set(t.shape, [t])
  }
  return [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([shape, list]) => {
    const bounds = boundsOf(list)
    const ordered = layer === 'contour' ? list : [...list].sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x)
    return part(`${layer}-${shape}`, `${text.label} ${direction(centerOf(bounds), result.bounds)}`, text.shape, bounds,
      ordered.map((trace, index) => stroke(trace.path, `${text.stroke} ${index + 1}`, strokeInstruction(layer, trace, bounds) ?? text.instruction, { kind: text.kind, color: trace.color, width: trace.width, opacity: trace.opacity })),
      text.checkpoint, text.correction)
  })
}

/** Plans exactly one drawing layer at a time; all marks follow the supplied image geometry. */
export function uploadedParts(result: ProcessedImage, step: number): GuidedPart[] {
  const b = result.bounds
  const shapes = dimensions(result)
  const approximate = result.study?.confidence === 'approximate'
  const geometryNote = result.study?.confidence === 'clear'
    ? 'Đọc hình bao và khoảng trống xung quanh trước khi dựng.'
    : 'Nền và chủ thể có vùng màu gần nhau. Các mốc là ước lượng theo ảnh, không phải nhận diện tên bộ phận.'
  switch (step) {
    case 0:
      return [part('observe', 'Quan sát mẫu và bốn mốc', geometryNote, b, compare(b, centerOf(b)), 'Xác định vị trí của hình bao trên giấy.', 'So vùng chính với ảnh tham chiếu mờ nếu ảnh có nền phức tạp.')]
    case 1:
      return frameParts(b)
    case 2:
      return blockParts(shapes, b, approximate)
    case 3:
      return proportionsParts(shapes, b)
    case 4:
      return volumeParts(shapes, b)
    case 5:
      return shapes.map((shape, index) => part(`check-${index}`, `So hình · ${shapeName(shape, b)}`, 'So lại vị trí và bề rộng của từng khối. Các dấu kiểm chỉ xuất hiện trong lúc đối chiếu.', shape.bounds, compare(shape.bounds, centerOf(shape.bounds)).slice(0, 2), 'Trục, mặt cắt và khung cùng nằm đúng vị trí tương đối.', 'Nếu một dấu cắt qua nền thay vì vùng chính, xem lại ảnh gốc trước khi đi nét đậm.'))
    case 6: {
      const form = blockParts(shapes, b), ratio = proportionsParts(shapes, b), volume = volumeParts(shapes, b)
      const erase = (item: GuidedPart, paths: GuidedStroke[], label: string) => part(`erase-${item.id}`, label,
        'Đầu tẩy lướt lại đúng đường dựng tạm đã xuất hiện ở các bước trước.', item.bounds,
        paths.map(mark => stroke(mark.path, `Nhấc ${mark.label.toLocaleLowerCase('vi')}`, 'Lướt đầu tẩy từ đầu đường dựng đến hết nét. Giữ phần nằm ngoài vệt tẩy nguyên vẹn.', { kind: 'erase', width: 11, opacity: 1 })),
        'Đường dựng mờ hoặc biến mất khi đầu tẩy đi qua.', 'Tẩy riêng các đường tạm, không phủ toàn bộ vùng vẽ.')
      const frame = frameParts(b)[0]
      return [erase(frame, frame.strokes, 'Nhấc khung bao'), ...form.map((item, i) => erase(item, [...item.strokes, ...ratio[i].strokes, ...volume[i].strokes], `Nhấc nét dựng · ${shapeName(shapes[i], b)}`))]
    }
    case 7:
      return tracedParts(result, 'contour', result.study?.contours ?? legacy(result.contourEdges, b))
    case 8:
      return tracedParts(result, 'tone', result.study?.tones ?? legacy(result.lightHatching, b))
    case 9:
      return tracedParts(result, 'shadow', result.study?.shadows ?? legacy(result.darkHatching, b))
    case 10:
      return tracedParts(result, 'detail', result.study?.details ?? legacy(result.fineEdges, b))
    case 11:
      return tracedParts(result, 'color', result.study?.colors ?? [])
    case 12: {
      // Select one existing contour per form. Reassert the edge after coloring
      // only where the original image provided a usable line.
      const contours = result.study?.contours ?? legacy(result.contourEdges, b)
      return shapes.map((shape, index) => {
        const edge = contours.filter(t => t.shape === index).sort((a, b) => b.length - a.length)[0]
        const marks = edge ? [stroke(edge.path, 'Nhấn mép chính', `Nhấn lại mép rõ nhất của khối này. ${strokeInstruction('contour', edge, shape.bounds) ?? 'Đi lại một đoạn mép đã có, giữ lực nhẹ.'} Lực vừa đủ để mép rõ hơn, không đậm hơn nét chính ở bước Nét chính.`, { kind: 'ink', color: '#36362e', width: 1.45, opacity: .88 })] : compare(shape.bounds, centerOf(shape.bounds)).slice(0, 1)
        return part(`finish-${index}`, `Hoàn thiện · ${shapeName(shape, b)}`, 'Lùi lại quan sát hình bao, nét chính và các mảng màu. Chỉ nhấn một mép rõ đã có trong ảnh.', shape.bounds, marks,
          'Khối lớn vẫn đọc được từ xa; nét chi tiết không tranh với nét chính.', 'Dừng khi dáng chính và mảng sáng tối đã rõ.')
      })
    }
    default:
      return []
  }
}
