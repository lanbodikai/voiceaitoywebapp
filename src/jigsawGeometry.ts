/** Shared boundaries are generated once, then reversed for the neighbouring piece.
 * SVG curves and responsive CSS clips use the same geometry, so tabs and sockets fit.
 */
type Point = readonly [number, number]
type Curve = { from: Point; to: Point; c1?: Point; c2?: Point }
export type PuzzleCell = readonly [number, number, number, number]
export const puzzleViewBox = '0 0 1200 750'
const width = 1200, height = 750
const rounded = (value: number) => Number(value.toFixed(5))
const xy = (point: Point) => point.map(rounded).join(' ')

function sample(curve: Curve): Point[] {
  if (!curve.c1 || !curve.c2) return [curve.to]
  const { from, to, c1, c2 } = curve
  return Array.from({ length: 12 }, (_, index) => {
    const t = (index + 1) / 12, u = 1 - t
    const coordinate = (axis: 0 | 1) => u ** 3 * from[axis] + 3 * u ** 2 * t * c1[axis] + 3 * u * t ** 2 * c2[axis] + t ** 3 * to[axis]
    return [coordinate(0), coordinate(1)]
  })
}

function reverse(curves: Curve[]): Curve[] {
  return [...curves].reverse().map(curve => ({ from: curve.to, to: curve.from, c1: curve.c2, c2: curve.c1 }))
}

export function jigsawShapes(cells: readonly PuzzleCell[], seed: number) {
  const vertices = cells.flatMap(([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Point[])
  const boundaries = new Map<string, Curve[]>()
  function boundary(horizontal: boolean, fixed: number, start: number, end: number): Curve[] {
    const key = `${horizontal}:${fixed}:${start}:${end}`
    const previous = boundaries.get(key)
    if (previous) return previous
    const length = end - start
    const direction = (Math.round(fixed + start + end) + seed) % 2 ? 1 : -1
    const depth = Math.min(52, length * .23) * direction
    const point = (along: number, normal = 0): Point => horizontal
      ? [start + along * length, fixed + normal * depth]
      : [fixed + normal * depth, start + along * length]
    let current = point(0)
    const curves: Curve[] = []
    function line(to: Point) { curves.push({ from: current, to }); current = to }
    function cubic(c1: Point, c2: Point, to: Point) { curves.push({ from: current, c1, c2, to }); current = to }
    if (fixed !== 0 && fixed !== (horizontal ? height : width)) {
      line(point(.4))
      cubic(point(.46), point(.46, .25), point(.43, .4))
      cubic(point(.36, .78), point(.41, 1), point(.5, 1))
      cubic(point(.59, 1), point(.64, .78), point(.57, .4))
      cubic(point(.54, .25), point(.54), point(.6))
    }
    line(point(1))
    boundaries.set(key, curves)
    return curves
  }
  function side(horizontal: boolean, fixed: number, start: number, end: number, backwards: boolean) {
    const cuts = [...new Set([start, end, ...vertices.filter(p => p[horizontal ? 1 : 0] === fixed).map(p => p[horizontal ? 0 : 1]).filter(v => v > start && v < end)])].sort((a, b) => a - b)
    const curves = cuts.slice(0, -1).flatMap((value, index) => boundary(horizontal, fixed, value, cuts[index + 1]))
    return backwards ? reverse(curves) : curves
  }
  return cells.map(([x0, y0, x1, y1]) => {
    const curves = [...side(true, y0, x0, x1, false), ...side(false, x1, y0, y1, false), ...side(true, y1, x0, x1, true), ...side(false, x0, y0, y1, true)]
    const points = [curves[0].from, ...curves.flatMap(sample)]
    return {
      path: `M ${xy(curves[0].from)} ${curves.map(c => c.c1 && c.c2 ? `C ${xy(c.c1)} ${xy(c.c2)} ${xy(c.to)}` : `L ${xy(c.to)}`).join(' ')} Z`,
      clipPath: `polygon(${points.map(([x, y]) => `${rounded(x / width * 100)}% ${rounded(y / height * 100)}%`).join(', ')})`,
    }
  })
}
