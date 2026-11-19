// "Hold to snap" shape recognition for freedraw strokes.
// Given the stroke points (any coordinate space), decide whether the user drew
// a line, an arrow, a rectangle, an ellipse or a diamond.
import { distToPolyline, distToSegment, pointsBounds, type P2 } from '@/engine/math';

export type RecognizedShape =
  | { type: 'line' | 'arrow'; start: P2; end: P2; score: number }
  | { type: 'rectangle' | 'ellipse' | 'diamond'; x: number; y: number; width: number; height: number; score: number };

const pathLength = (pts: P2[]) => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
};

/** resample to n evenly spaced points along the path */
export const resample = (pts: P2[], n: number): P2[] => {
  const total = pathLength(pts);
  if (total === 0 || pts.length < 2) return pts.slice();
  const step = total / (n - 1);
  const out: P2[] = [pts[0]];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length && out.length < n; i++) {
    const cur = pts[i];
    let seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (acc + seg >= step && out.length < n) {
      const t = (step - acc) / seg;
      const np: P2 = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      out.push(np);
      prev = np;
      seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      acc = 0;
    }
    acc += seg;
    prev = cur;
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out;
};

const straightness = (pts: P2[], a: P2, b: P2) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return Infinity;
  let max = 0;
  for (const p of pts) max = Math.max(max, distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]));
  return max / len;
};

/** returns null when nothing is recognized with enough confidence */
export function recognizeShape(input: P2[]): RecognizedShape | null {
  if (input.length < 3) return null;
  const total = pathLength(input);
  const bb = pointsBounds(input);
  const w = bb.maxX - bb.minX, h = bb.maxY - bb.minY;
  const size = Math.max(w, h);
  if (size < 10 || total < 15) return null;
  const pts = resample(input, 96);
  const first = pts[0], last = pts[pts.length - 1];
  const gap = Math.hypot(last[0] - first[0], last[1] - first[1]);
  const closed = gap < Math.max(total * 0.12, size * 0.18);

  if (!closed) {
    // straight line?
    if (straightness(pts, first, last) < 0.07) return { type: 'line', start: first, end: last, score: 1 };
    // arrow: straight shaft to the farthest point, then a short hook back
    let far = 0, farD = 0;
    pts.forEach((p, i) => {
      const d = Math.hypot(p[0] - first[0], p[1] - first[1]);
      if (d > farD) { farD = d; far = i; }
    });
    const shaft = pts.slice(0, far + 1);
    const tail = pts.slice(far);
    const tailLen = pathLength(tail);
    if (far > 4 && straightness(shaft, first, pts[far]) < 0.08 && tailLen > farD * 0.08 && tailLen < farD * 0.9) {
      // the tail must head back towards the start (arrowhead wing)
      const sx = pts[far][0] - first[0], sy = pts[far][1] - first[1];
      const tx = last[0] - pts[far][0], ty = last[1] - pts[far][1];
      const cos = (sx * tx + sy * ty) / (Math.hypot(sx, sy) * Math.hypot(tx, ty) || 1);
      if (cos < -0.3) return { type: 'arrow', start: first, end: pts[far], score: 1 };
    }
    return null;
  }

  if (w < 8 || h < 8) return null;
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  const hw = w / 2, hh = h / 2;
  const norm = Math.min(hw, hh);
  // ellipse: radial error in normalized space
  let eErr = 0, rErr = 0, dErr = 0;
  const rect: P2[] = [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.maxX, bb.maxY], [bb.minX, bb.maxY]];
  const dia: P2[] = [[cx, bb.minY], [bb.maxX, cy], [cx, bb.maxY], [bb.minX, cy]];
  for (const [x, y] of pts) {
    const nx = (x - cx) / hw, ny = (y - cy) / hh;
    eErr += Math.abs(Math.hypot(nx, ny) - 1);
    rErr += distToPolyline(x, y, rect, true) / norm;
    dErr += distToPolyline(x, y, dia, true) / norm;
  }
  eErr /= pts.length; rErr /= pts.length; dErr /= pts.length;
  const cands: Array<[RecognizedShape['type'], number]> = [
    ['ellipse', eErr],
    ['rectangle', rErr],
    ['diamond', dErr],
  ];
  cands.sort((a, b) => a[1] - b[1]);
  const [type, err] = cands[0];
  // require a clear winner and a decent fit
  if (err > 0.13 || cands[1][1] - err < 0.015) return null;
  return { type: type as 'rectangle' | 'ellipse' | 'diamond', x: bb.minX, y: bb.minY, width: w, height: h, score: 1 - err };
}
