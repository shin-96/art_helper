export interface ImageBounds { x: number; y: number; width: number; height: number }
export interface ImagePoint { x: number; y: number }
export interface ImageTrace {
  path: string;
  bounds: ImageBounds;
  center: ImagePoint;
  length: number;
  shape: number;
  color?: string;
  width?: number;
  opacity?: number;
  /** First and last point of the stroke, in board coordinates. Used to write
   *  an instruction that names where this exact stroke starts and ends. */
  start?: ImagePoint;
  end?: ImagePoint;
}
export interface ImageShape {
  bounds: ImageBounds;
  center: ImagePoint;
  axis: [ImagePoint, ImagePoint];
  section: [ImagePoint, ImagePoint];
  path: string;
  family: 'ellipse' | 'box' | 'wedge' | 'mass';
  area: number;
}
export interface ImageStudy {
  shapes: ImageShape[];
  contours: ImageTrace[];
  details: ImageTrace[];
  tones: ImageTrace[];
  shadows: ImageTrace[];
  colors: ImageTrace[];
  confidence: 'clear' | 'approximate';
}
export interface ProcessedImage {
  /** All path coordinates use the drawing board's 800 × 640 viewBox. */
  bounds: ImageBounds;
  imageBounds: ImageBounds;
  center: ImagePoint;
  angle: number;
  blockInPath: string;
  coarseEdges: string;
  contourEdges: string;
  fineEdges: string;
  lightHatching: string;
  darkHatching: string;
  crossHatching: string;
  grayscaleUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  study?: ImageStudy;
}

export function loadCanvasImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không thể đọc ảnh tham chiếu. Vui lòng chọn ảnh khác.'));
    image.src = src;
  });
}

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const round = (n: number) => Math.round(n * 10) / 10;
const xy = (point: ImagePoint) => `${round(point.x)} ${round(point.y)}`;
const pathFrom = (points: ImagePoint[], close = false) => points.map((p, i) => `${i ? 'L' : 'M'}${xy(p)}`).join('') + (close ? 'Z' : '');
const distance = (a: ImagePoint, b: ImagePoint) => Math.hypot(a.x - b.x, a.y - b.y);
type RGB = [number, number, number];
const luminance = ([r, g, b]: RGB) => .2126 * r + .7152 * g + .0722 * b;
const colorGap = (a: RGB, b: RGB) => {
  const ar = a[0] - b[0], ag = a[1] - b[1], ab = a[2] - b[2];
  return Math.hypot(ar, ag, ab) / 1.73;
};
const sampleOf = (r: Float32Array, g: Float32Array, b: Float32Array, i: number): RGB => [r[i], g[i], b[i]];
const hex = (rgb: RGB) => '#' + rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('');

function blur(values: Float32Array, width: number, height: number) {
  const horizontal = new Float32Array(values.length);
  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    horizontal[i] = (values[i - Number(x > 0)] + 2 * values[i] + values[i + Number(x + 1 < width)]) / 4;
  }
  for (let i = 0; i < values.length; i++) {
    output[i] = (horizontal[Math.max(i % width, i - width)] + 2 * horizontal[i] + horizontal[Math.min(values.length - width + i % width, i + width)]) / 4;
  }
  return output;
}

function components(mask: Uint8Array, width: number, minimum: number, diagonals = false) {
  const visited = new Uint8Array(mask.length);
  const found: number[][] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const cells = [start];
    visited[start] = 1;
    for (let j = 0; j < cells.length; j++) {
      const i = cells[j];
      for (const delta of diagonals ? [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1] : [-width, -1, 1, width]) {
        const next = i + delta;
        if (!mask[next] || visited[next] || Math.abs(next % width - i % width) > 1) continue;
        visited[next] = 1;
        cells.push(next);
      }
    }
    if (cells.length >= minimum) found.push(cells);
  }
  return found.sort((a, b) => b.length - a.length);
}

function envelope(points: ImagePoint[]): ImagePoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (ordered: ImagePoint[]) => {
    const out: ImagePoint[] = [];
    for (const p of ordered) {
      while (out.length > 1) {
        const a = out[out.length - 2], b = out[out.length - 1];
        if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0) break;
        out.pop();
      }
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

function simplify(points: ImagePoint[], tolerance: number): ImagePoint[] {
  if (points.length < 3) return points;
  const a = points[0], b = points[points.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy;
  let maximum = tolerance, split = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const t = square ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / square, 0, 1) : 0;
    const distance = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    if (distance > maximum) { maximum = distance; split = i; }
  }
  return split === -1 ? [a, b] : [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)];
}

/** Chaikin corner cutting: removes pixel stair-steps from a traced line
 *  while keeping both endpoints exactly where they were. */
function smooth(points: ImagePoint[], iterations = 1): ImagePoint[] {
  let out = points;
  for (let n = 0; n < iterations; n++) {
    if (out.length < 3) break;
    const next: ImagePoint[] = [out[0]];
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i], b = out[i + 1];
      next.push({ x: a.x * .75 + b.x * .25, y: a.y * .75 + b.y * .25 });
      next.push({ x: a.x * .25 + b.x * .75, y: a.y * .25 + b.y * .75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** Split a line where it naturally turns (a corner a teacher would lift the
 *  pen at), instead of every fixed number of units. Lengths are board units. */
function splitAtCorners(points: ImagePoint[], minLength: number, maxLength: number, turnDegrees = 38): ImagePoint[][] {
  if (points.length < 3) return [points];
  const sections: ImagePoint[][] = [];
  let current = [points[0]], length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distance(points[i - 1], points[i]);
    current.push(points[i]);
    let split = length >= maxLength;
    if (!split && length >= minLength && i > 1 && i + 1 < points.length) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
      const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
      if (m1 && m2) {
        const angle = Math.acos(clamp((v1x * v2x + v1y * v2y) / (m1 * m2), -1, 1)) * 180 / Math.PI;
        split = angle >= turnDegrees;
      }
    }
    if (split && i + 1 < points.length) { sections.push(current); current = [points[i]]; length = 0; }
  }
  if (current.length > 1) {
    if (sections.length && length < minLength * .45) sections[sections.length - 1].push(...current.slice(1));
    else sections.push(current);
  }
  return sections.filter(section => section.length > 1);
}

function pointBounds(points: ImagePoint[]): ImageBounds {
  let x = Infinity, y = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    x = Math.min(x, point.x); y = Math.min(y, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { x, y, width: Math.max(1, maxX - x), height: Math.max(1, maxY - y) };
}

function principal(cells: number[], width: number) {
  let x = 0, y = 0, xx = 0, xy = 0, yy = 0;
  for (const i of cells) {
    const cx = i % width, cy = Math.floor(i / width);
    x += cx; y += cy; xx += cx * cx; xy += cx * cy; yy += cy * cy;
  }
  x /= cells.length; y /= cells.length;
  return { x, y, angle: .5 * Math.atan2(2 * (xy / cells.length - x * y), xx / cells.length - x * x - yy / cells.length + y * y) };
}

function foreground(r: Float32Array, g: Float32Array, b: Float32Array, width: number, height: number) {
  const size = width * height;
  const border: RGB[] = [];
  const borderRatio = new Uint32Array(216), interiorRatio = new Uint32Array(216);
  const bin = (r: number, g: number, b: number) => Math.min(5, Math.floor(r / 43)) * 36 + Math.min(5, Math.floor(g / 43)) * 6 + Math.min(5, Math.floor(b / 43));
  let borderCount = 0, innerCount = 0;
  const margin = Math.max(2, Math.round(Math.min(width, height) * .04));
  for (let i = 0; i < size; i++) {
    const x = i % width, y = Math.floor(i / width), index = bin(r[i], g[i], b[i]);
    if (x < margin || y < margin || x >= width - margin || y >= height - margin) {
      borderRatio[index]++; borderCount++;
      if (x % 4 === 0 && y % 4 === 0) border.push(sampleOf(r, g, b, i));
    } else if (x >= width * .16 && y >= height * .1 && x < width * .84 && y < height * .9) {
      interiorRatio[index]++; innerCount++;
    }
  }
  // A palette of border colors keeps textured, multicolored backgrounds from
  // being mistaken for one dark object. The interior prior can recover a hue
  // that occurs at a crop edge but is mostly present in the subject.
  const palette: RGB[] = [];
  for (const rgb of border) if (!palette.some(other => colorGap(rgb, other) < 15)) palette.push(rgb);
  const medianBorder = ([0, 1, 2] as const).map(channel => {
    const values = border.map(rgb => rgb[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 255;
  }) as RGB;
  const variation = border.map(rgb => colorGap(rgb, medianBorder)).sort((a, b) => a - b);
  const borderSpread = variation[Math.floor(variation.length * .72)] ?? 0;
  const simple = borderSpread < 17;
  const raw = new Uint8Array(size), score = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const rgb = sampleOf(r, g, b, i), c = bin(...rgb);
    const distance = simple ? colorGap(rgb, medianBorder) : Math.min(...palette.map(bg => colorGap(rgb, bg)));
    const rarity = Math.log((interiorRatio[c] / Math.max(1, innerCount) + .003) / (borderRatio[c] / Math.max(1, borderCount) + .003));
    const x = (i % width + .5) / width, y = (Math.floor(i / width) + .5) / height;
    const central = 1 - Math.hypot((x - .5) * 1.7, (y - .5) * 1.1);
    score[i] = distance + (simple ? 3 : 10) * clamp(rarity, -2, 3) + 7 * central;
    raw[i] = Number(score[i] > (simple ? 23 : 24));
  }
  const cleanup = new Uint8Array(size);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) count += raw[i + dy * width + dx];
    cleanup[i] = Number(count >= (raw[i] ? 3 : 6));
  }
  let groups = components(cleanup, width, Math.max(12, Math.round(size * .006)), true);
  const ranked = groups.map(cells => {
    const p = principal(cells, width);
    return { cells, score: cells.length * (1.05 - .75 * Math.hypot(p.x / width - .5, p.y / height - .5)) };
  }).sort((a, b) => b.score - a.score);
  groups = ranked.filter((group, i) => i < 5 && group.cells.length >= ranked[0].cells.length * (simple ? .075 : .12)).map(group => group.cells);
  const selected = new Uint8Array(size);
  for (const cells of groups) for (const i of cells) selected[i] = 1;
  // Fill enclosed light areas without filling gaps open to the background.
  if (groups.length) {
    const inverted = selected.map(value => Number(!value));
    for (const hole of components(inverted, width, 1)) {
      if (hole.length > size * .26 || hole.some(i => i < width || i >= size - width || i % width === 0 || i % width === width - 1)) continue;
      for (const i of hole) selected[i] = 1;
    }
    groups = components(selected, width, 1, true);
  }
  const fraction = selected.reduce((n, value) => n + value, 0) / size;
  if (fraction < .02 || fraction > .91) {
    const frame: number[] = [];
    const insetX = Math.min(2, Math.floor((width - 1) / 2));
    const insetY = Math.min(2, Math.floor((height - 1) / 2));
    selected.fill(0);
    for (let y = insetY; y < height - insetY; y++) for (let x = insetX; x < width - insetX; x++) { const i = y * width + x; selected[i] = 1; frame.push(i); }
    return { mask: selected, groups: [frame], simple: false, hasSilhouette: false };
  }
  return { mask: selected, groups, simple, hasSilhouette: true };
}

function splitMass(cells: number[], width: number, height: number): number[][] {
  if (cells.length < width * height * .045) return [cells];
  let best: { score: number; horizontal: boolean; at: number } | undefined;
  // A change in silhouette cross-section is evidence for a smaller attached
  // volume. Both vertical and horizontal profiles are evaluated.
  for (const horizontal of [false, true]) {
    const project = (i: number) => horizontal ? i % width : Math.floor(i / width);
    const profile = new Uint32Array(horizontal ? width : height);
    let min = profile.length, max = 0;
    for (const i of cells) { const n = project(i); profile[n]++; min = Math.min(min, n); max = Math.max(max, n); }
    const extent = max - min;
    if (extent < 18) continue;
    let before = 0;
    for (let at = min; at < max; at++) {
      before += profile[at];
      if (before < cells.length * .17 || before > cells.length * .83 || at < min + extent * .22 || at > max - extent * .22) continue;
      const span = Math.max(4, Math.round(extent * .15));
      const low = Math.min(profile[at - 1], profile[at], profile[at + 1]);
      const left = Math.max(...profile.slice(Math.max(min, at - span), at));
      const right = Math.max(...profile.slice(at + 1, Math.min(max + 1, at + span + 1)));
      const localMax = Math.max(left, right);
      if (!localMax) continue;
      const valley = Math.max(0, (Math.min(left, right) - low) / localMax);
      const shoulder = Math.abs(left - right) / localMax;
      const score = valley + shoulder * .46 - Math.abs(before / cells.length - .5) * .18;
      if (score > .28 && (!best || score > best.score)) best = { score, horizontal, at };
    }
  }
  if (!best) return [cells];
  const result: [number[], number[]] = [[], []];
  for (const i of cells) result[Number((best.horizontal ? i % width : Math.floor(i / width)) > best.at)].push(i);
  return result.sort((a, b) => b.length - a.length);
}

function shapeFrom(cells: number[], width: number, toBoard: (x: number, y: number) => ImagePoint): ImageShape {
  const p = principal(cells, width);
  const vx = Math.cos(p.angle), vy = Math.sin(p.angle);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const pixelPoints: ImagePoint[] = [];
  for (const i of cells) {
    const x = i % width, y = Math.floor(i / width);
    pixelPoints.push({ x, y });
    const u = (x - p.x) * vx + (y - p.y) * vy, v = (y - p.y) * vx - (x - p.x) * vy;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const extentU = Math.max(2, maxU - minU), extentV = Math.max(2, maxV - minV);
  const u0 = (minU + maxU) / 2, v0 = (minV + maxV) / 2;
  const toAxis = (u: number, v: number) => toBoard(p.x + u * vx - v * vy, p.y + u * vy + v * vx);
  const center = toAxis(u0, v0);
  const band = Math.max(1.5, extentU * .09);
  let sectionLow = Infinity, sectionHigh = -Infinity;
  for (const { x, y } of pixelPoints) {
    const u = (x - p.x) * vx + (y - p.y) * vy;
    if (Math.abs(u - u0) > band) continue;
    const v = (y - p.y) * vx - (x - p.x) * vy;
    sectionLow = Math.min(sectionLow, v); sectionHigh = Math.max(sectionHigh, v);
  }
  const occupancy = cells.length / (extentU * extentV);
  const hull = envelope(pixelPoints);
  let outline: ImagePoint[], family: ImageShape['family'];
  if (occupancy > .86) {
    family = 'box';
    outline = [toAxis(minU, minV), toAxis(maxU, minV), toAxis(maxU, maxV), toAxis(minU, maxV)];
  } else if (occupancy > .67 && hull.length >= 9) {
    family = 'ellipse';
    outline = Array.from({ length: 28 }, (_, i) => {
      const angle = 2 * Math.PI * i / 28;
      return toAxis(u0 + extentU * .5 * Math.cos(angle), v0 + extentV * .5 * Math.sin(angle));
    });
  } else {
    const reduced = simplify([...hull, hull[0]], Math.max(2, Math.min(extentU, extentV) * .12)).slice(0, -1);
    family = reduced.length <= 4 && occupancy < .62 ? 'wedge' : 'mass';
    // Prefer the group's real silhouette, simplified lightly, over its convex
    // hull: a hull invents straight edges the subject does not have (a diamond
    // laid over a dog), and a learner copying them learns angles that are not
    // in the reference. Fall back to the hull only if no usable chain exists.
    let silhouette: ImagePoint[] = [];
    let maxCell = 0;
    for (const i of cells) if (i > maxCell) maxCell = i;
    const heightGuess = Math.floor(maxCell / width) + 1;
    const cellMask = new Uint8Array(width * heightGuess);
    for (const i of cells) cellMask[i] = 1;
    const chains = traceSilhouette(cellMask, width, heightGuess);
    if (chains.length) {
      const simplified = simplify(chains[0], Math.max(1.5, Math.min(extentU, extentV) * .045));
      if (simplified.length >= 5) silhouette = simplified;
    }
    if (silhouette.length > 1 && silhouette[0].x === silhouette[silhouette.length - 1].x && silhouette[0].y === silhouette[silhouette.length - 1].y) silhouette = silhouette.slice(0, -1);
    outline = (silhouette.length >= 3 ? silhouette : (reduced.length >= 3 ? reduced : hull)).map(({ x, y }) => toBoard(x, y));
  }
  if (outline.length < 3) outline = [toAxis(minU, minV), toAxis(maxU, minV), toAxis(maxU, maxV), toAxis(minU, maxV)];
  return {
    bounds: pointBounds(outline), center, axis: [toAxis(minU, v0), toAxis(maxU, v0)],
    section: [toAxis(u0, Number.isFinite(sectionLow) ? sectionLow : minV), toAxis(u0, Number.isFinite(sectionHigh) ? sectionHigh : maxV)],
    path: pathFrom(outline, true), family, area: cells.length,
  };
}

function traceSilhouette(mask: Uint8Array, width: number, height: number) {
  const vertex = width + 1;
  const edges = new Map<number, number[]>();
  const add = (a: number, b: number) => { const targets = edges.get(a); if (targets) targets.push(b); else edges.set(a, [b]); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!mask[i]) continue;
    const top = y * vertex + x, bottom = top + vertex;
    if (!y || !mask[i - width]) add(top, top + 1);
    if (x === width - 1 || !mask[i + 1]) add(top + 1, bottom + 1);
    if (y === height - 1 || !mask[i + width]) add(bottom + 1, bottom);
    if (!x || !mask[i - 1]) add(bottom, top);
  }
  const result: ImagePoint[][] = [];
  for (const start of edges.keys()) {
    while (edges.has(start)) {
      const chain: ImagePoint[] = [];
      let i = start;
      while (true) {
        chain.push({ x: i % vertex, y: Math.floor(i / vertex) });
        const next = edges.get(i);
        if (!next?.length) break;
        const j = next.pop()!;
        if (!next.length) edges.delete(i);
        i = j;
        if (i === start) { chain.push(chain[0]); break; }
      }
      if (chain.length >= 16) result.push(chain);
    }
  }
  return result.sort((a, b) => b.length - a.length);
}

function traceInterior(r: Float32Array, g: Float32Array, b: Float32Array, mask: Uint8Array, width: number, height: number) {
  const size = width * height;
  const magnitude = new Float32Array(size), orientation = new Uint8Array(size);
  const neighbors = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (!mask[i] || !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]) continue;
    let best = 0, ax = 0, ay = 0;
    for (const channel of [r, g, b]) {
      const gx = (channel[i - width + 1] + channel[i + width + 1] + 2 * channel[i + 1]) - (channel[i - width - 1] + channel[i + width - 1] + 2 * channel[i - 1]);
      const gy = (channel[i + width + 1] + channel[i + width - 1] + 2 * channel[i + width]) - (channel[i - width + 1] + channel[i - width - 1] + 2 * channel[i - width]);
      const signal = Math.hypot(gx, gy) / 8;
      if (signal > best) { best = signal; ax = gx; ay = gy; }
    }
    magnitude[i] = best;
    orientation[i] = ((Math.round(Math.atan2(ay, ax) / (Math.PI / 4)) % 4) + 4) % 4;
  }
  const thin = new Uint8Array(size), gradients: number[] = [];
  for (let i = width + 1; i < size - width - 1; i++) {
    if (magnitude[i] < 5) continue;
    const delta = [1, width + 1, width, width - 1][orientation[i]];
    if (magnitude[i] >= magnitude[i - delta] && magnitude[i] > magnitude[i + delta]) {
      thin[i] = 1; gradients.push(magnitude[i]);
    }
  }
  gradients.sort((a, b) => a - b);
  const threshold = Math.max(8, gradients[Math.floor(gradients.length * .44)] ?? 8);
  const occupied = thin.map((mark, i) => Number(mark && magnitude[i] >= threshold));
  const get = (i: number, offset: number) => occupied[i + offset] && Math.abs((i + offset) % width - i % width) <= 1;
  const chains: { points: ImagePoint[]; strength: number }[] = [];
  const point = (i: number) => ({ x: i % width, y: Math.floor(i / width) });
  const extend = (start: number) => {
    const nodes: number[] = [];
    let i = start, last: number | undefined;
    for (let loop = 0; loop < 150; loop++) {
      let next = -1, best = -1;
      for (const delta of neighbors) {
        if (!get(i, delta)) continue;
        const candidate = i + delta;
        const dx = candidate % width - i % width, dy = Math.floor(candidate / width) - Math.floor(i / width);
        const dot = last === undefined ? 0 : (dx * (i % width - last % width) + dy * (Math.floor(i / width) - Math.floor(last / width))) / Math.hypot(dx, dy);
        const weight = 1 + dot * .5 + Math.min(50, magnitude[candidate]) / 100;
        if (weight > best) { best = weight; next = candidate; }
      }
      if (next < 0) break;
      occupied[next] = 0; nodes.push(next); last = i; i = next;
    }
    return nodes;
  };
  for (const endsOnly of [true, false]) for (let i = width + 1; i < size - width - 1; i++) {
    if (!occupied[i] || (endsOnly && neighbors.filter(delta => get(i, delta)).length > 1)) continue;
    occupied[i] = 0;
    const nodes = [...extend(i).reverse(), i, ...extend(i)];
    if (nodes.length < 6) continue;
    const strength = nodes.reduce((sum, n) => sum + magnitude[n], 0) / nodes.length;
    chains.push({ points: nodes.map(point), strength });
  }
  return chains.sort((a, b) => b.points.length * Math.sqrt(b.strength) - a.points.length * Math.sqrt(a.strength));
}

export function analyzeImagePixels(pixels: Uint8ClampedArray, width: number, height: number) {
  const size = width * height;
  const fit = Math.min(490 / width, 455 / height);
  const imageBounds = { x: (800 - width * fit) / 2, y: 88 + (455 - height * fit) / 2, width: width * fit, height: height * fit };
  const toBoard = (x: number, y: number) => ({ x: imageBounds.x + x * fit, y: imageBounds.y + y * fit });
  let r = new Float32Array(size), g = new Float32Array(size), b = new Float32Array(size);
  for (let i = 0; i < size; i++) { r[i] = pixels[i * 4]; g[i] = pixels[i * 4 + 1]; b[i] = pixels[i * 4 + 2]; }
  r = blur(r, width, height); g = blur(g, width, height); b = blur(b, width, height);
  const { mask, groups, simple, hasSilhouette } = foreground(r, g, b, width, height);
  const mass = groups.flat();
  const p = principal(mass, width);
  const bounds = pointBounds(mass.map(i => toBoard(i % width, Math.floor(i / width))));
  // Reserve one part in the erase stage for the overall frame.
  const shapeCells = groups.slice(0, 4).flatMap(group => hasSilhouette ? splitMass(group, width, height) : [group]).sort((a, b) => b.length - a.length).slice(0, 5);
  const shapes = shapeCells.map(cells => shapeFrom(cells, width, toBoard));
  const membership = new Int8Array(size).fill(-1);
  shapeCells.forEach((cells, n) => { for (const i of cells) membership[i] = n; });
  const shapeAt = (point: ImagePoint) => {
    const x = clamp(Math.round((point.x - imageBounds.x) / fit), 0, width - 1);
    const y = clamp(Math.round((point.y - imageBounds.y) / fit), 0, height - 1);
    const direct = membership[y * width + x];
    if (direct >= 0) return direct;
    let winner = 0, best = Infinity;
    shapes.forEach((shape, index) => { const d = distance(shape.center, point); if (d < best) { best = d; winner = index; } });
    return winner;
  };
  const trace = (points: ImagePoint[], style: Pick<ImageTrace, 'color' | 'opacity' | 'width'> = {}): ImageTrace => {
    const bounds = pointBounds(points);
    const center = points[Math.floor(points.length / 2)];
    return { path: pathFrom(points), bounds, center, shape: shapeAt(center), length: points.slice(1).reduce((n, point, i) => n + distance(points[i], point), 0), start: points[0], end: points[points.length - 1], ...style };
  };
  const exterior = hasSilhouette ? traceSilhouette(mask, width, height) : [];
  const contourPaint = { color: '#3e4039', width: 2.35, opacity: .88 };
  const boundary = exterior.slice(0, 7).flatMap(chain => {
    const boardPoints = smooth(simplify(chain, 1.65).map(({ x, y }) => toBoard(x, y)), 1);
    return splitAtCorners(boardPoints, 34, 135).map(section => trace(section, contourPaint));
  }).slice(0, 68);
  const interior = traceInterior(r, g, b, mask, width, height);
  const major = interior.filter(chain => chain.points.length >= 10).slice(0, 40);
  const contours = [...boundary, ...major.map(({points}) => trace(smooth(simplify(points, 1.25).map(({x,y}) => toBoard(x,y)), 1), { color: '#3e4039', width: 1.7, opacity: .78 }))];
  const details = interior.filter(item => !major.includes(item)).slice(0, 54).map(({points}) => trace(smooth(simplify(points, .85).map(({x,y}) => toBoard(x,y)), 1), { color: '#49463d', width: .95, opacity: .69 }));

  const luma = mass.map(i => luminance(sampleOf(r,g,b,i))).sort((a,b) => a-b);
  const low = luma[Math.floor(luma.length * .2)] ?? 60;
  const high = luma[Math.floor(luma.length * .88)] ?? 220;
  const brushRows = (spacing: number, widthFor: number, variant: 'color' | 'tone' | 'shadow') => {
    const strokes: ImageTrace[] = [];
    const minY = Math.floor((bounds.y - imageBounds.y) / fit), maxY = Math.ceil((bounds.y + bounds.height - imageBounds.y) / fit);
    const maxLength = Math.max(10, Math.round(spacing * (variant === 'color' ? 3.5 : variant === 'tone' ? 7 : 2.5)));
    const group = (i: number) => variant === 'color' ? mask[i] : mask[i] && (variant === 'shadow' ? luminance(sampleOf(r,g,b,i)) <= low + 10 : luminance(sampleOf(r,g,b,i)) <= high - 4);
    for (let y = minY; y <= maxY && y < height; y += spacing) {
      const paint = (from: number, to: number) => {
        const n = to - from;
        if (n < 3) return;
        const rgb: RGB = [0,0,0];
        for (let x = from; x < to; x++) {
          const i = y * width + x;
          rgb[0] += r[i]; rgb[1] += g[i]; rgb[2] += b[i];
        }
        const actual = rgb.map(value => value / n) as RGB;
        const darkness = 1 - luminance(actual) / 255;
        const feather = Math.max(0, Math.min(widthFor * .27, (n - 1) / 3));
        const toward = Math.max(1, n - 1 - 2 * feather);
        const fromPoint = toBoard(from + feather, y), toPoint = toBoard(from + feather + toward, y);
        const style = variant === 'color'
          ? { color: hex(actual), width: Math.max(1.2, Math.min(widthFor, n * .9) * fit), opacity: .91 }
          : { color: variant === 'shadow' ? '#625b53' : '#8d8276', width: (variant === 'shadow' ? 2.6 : 3.7) * fit, opacity: clamp(darkness * (variant === 'shadow' ? .85 : .55), .13, .72) };
        strokes.push(trace([fromPoint, toPoint], style));
      };
      let start = -1;
      for (let x = 0; x <= width; x++) {
        const i = y * width + x;
        if (x < width && group(i)) {
          if (start < 0) start = x;
          // Tone passes run the full width of the region: fur noise must not
          // chop a shading stroke into dashes. Colour and shadow strokes
          // still break where the sampled colour actually changes.
          else if (x - start >= maxLength || (variant !== 'tone' && x - start >= Math.max(5, spacing * .8) && colorGap(sampleOf(r,g,b,i), sampleOf(r,g,b,y * width + start)) > (variant === 'color' ? 26 : 34))) { paint(start, x); start = x; }
        } else if (start >= 0) { paint(start, x); start = -1; }
      }
    }
    return strokes;
  };
  const spacing = Math.max(4, Math.ceil(Math.max(width, height) / 24));
  const cap = <T,>(items: T[], limit: number) => items.length <= limit ? items : Array.from({ length: limit }, (_, i) => items[Math.floor(i * (items.length - 1) / (limit - 1))]);
  let colors: ImageTrace[] = [];
  for (let step = spacing; step <= spacing * 2; step += 2) {
    colors = brushRows(step, step * 1.13, 'color');
    if (colors.length <= 176) break;
  }
  colors = cap(colors, 176);
  // Shading strokes must follow the form they shade: rotate each scanline
  // segment around its own centre onto the long axis of the shape it belongs
  // to, so a leg gets vertical hatching and a body gets lengthwise hatching
  // instead of one global horizontal direction for the whole picture.
  const followForm = (list: ImageTrace[]): ImageTrace[] => list.map(item => {
    const shape = shapes[item.shape]
    if (!shape || !item.start || !item.end) return item
    const angle = Math.atan2(shape.axis[1].y - shape.axis[0].y, shape.axis[1].x - shape.axis[0].x)
    if (Math.abs(angle) < 0.06 || Math.abs(Math.abs(angle) - Math.PI) < 0.06) return item
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const rotate = (p: ImagePoint): ImagePoint => {
      const dx = p.x - item.center.x, dy = p.y - item.center.y
      return { x: item.center.x + dx * cos - dy * sin, y: item.center.y + dx * sin + dy * cos }
    }
    const start = rotate(item.start), end = rotate(item.end)
    const points = [start, end]
    return { ...item, path: pathFrom(points), bounds: pointBounds(points), start, end }
  });
  const tones = followForm(cap(brushRows(Math.max(5, Math.ceil(spacing * 1.13)), 0, 'tone'), 72));
  const shadows = followForm(cap(brushRows(Math.max(5, Math.ceil(spacing * 1.1)), 0, 'shadow'), 62));
  return {
    bounds, imageBounds, center: toBoard(p.x, p.y), angle: p.angle * 180 / Math.PI,
    blockInPath: shapes[0].path,
    coarseEdges: boundary.map(item => item.path).join(''), contourEdges: contours.map(item => item.path).join(''), fineEdges: details.map(item => item.path).join(''),
    lightHatching: tones.map(item => item.path).join(''), darkHatching: shadows.map(item => item.path).join(''), crossHatching: shadows.map(item => item.path).join(''),
    study: { shapes, contours, details, tones, shadows, colors, confidence: simple ? 'clear' : 'approximate' } satisfies ImageStudy,
  };
}

export async function processImage(src: string): Promise<ProcessedImage> {
  const image = await loadCanvasImage(src);
  const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(8, Math.round(image.naturalWidth * scale));
  const height = Math.max(8, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Trình duyệt chưa hỗ trợ xử lý ảnh.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  let pixels: ImageData;
  try { pixels = context.getImageData(0, 0, width, height); }
  catch { throw new Error('Ảnh không cho phép đọc dữ liệu. Hãy tải ảnh từ thiết bị của bạn.'); }
  const analysis = analyzeImagePixels(pixels.data, width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.round(luminance([pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]]));
    pixels.data[i] = gray; pixels.data[i + 1] = gray; pixels.data[i + 2] = gray;
  }
  context.putImageData(pixels, 0, 0);
  return { ...analysis, grayscaleUrl: canvas.toDataURL('image/png'), sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight };
}

export async function rasterizeSvg(svg: string, width = 1600, height = 1280): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadCanvasImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Không thể xuất bản vẽ trong trình duyệt này.');
    context.fillStyle = '#fbf9f3'; context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}
