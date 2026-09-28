// Each generator returns a Float32Array of `count` xyz positions.

function rand(a, b) {
  return a + Math.random() * (b - a)
}

// Sample points from rendered text. Pixels with alpha become candidate positions.
export function textShape(count, text, { width = 11, font = '900 220px "Noto Serif KR", serif', depth = 0.35, y = 0 } = {}) {
  const cw = 1400
  const ch = 420
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font
  // Shrink to fit.
  let size = parseInt(font.match(/(\d+)px/)[1], 10)
  while (ctx.measureText(text).width > cw * 0.94 && size > 20) {
    size -= 6
    ctx.font = font.replace(/\d+px/, `${size}px`)
  }
  ctx.fillText(text, cw / 2, ch / 2)

  const data = ctx.getImageData(0, 0, cw, ch).data
  const pts = []
  let minX = cw, maxX = 0, minY = ch, maxY = 0
  for (let py = 0; py < ch; py += 2) {
    for (let px = 0; px < cw; px += 2) {
      if (data[(py * cw + px) * 4 + 3] > 128) {
        pts.push(px, py)
        minX = Math.min(minX, px); maxX = Math.max(maxX, px)
        minY = Math.min(minY, py); maxY = Math.max(maxY, py)
      }
    }
  }

  // Scale the glyphs' bounding box to `width` world units, centered.
  const scale = width / Math.max(1, maxX - minX)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const j = Math.floor(Math.random() * (pts.length / 2)) * 2
    out[i * 3] = (pts[j] - cx + rand(-1, 1)) * scale
    out[i * 3 + 1] = -(pts[j + 1] - cy + rand(-1, 1)) * scale + y
    out[i * 3 + 2] = rand(-depth, depth)
  }
  return out
}

// A tilted rotunda of particles that frames the colleges carousel.
export function ringShape(count) {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const band = Math.random()
    let r, y
    if (band < 0.6) {
      r = 5.4 + Math.pow(Math.random(), 3) * 1.2
      y = rand(-0.12, 0.12)
    } else if (band < 0.85) {
      r = 4.2 + rand(-0.05, 0.05)
      y = rand(-1.6, 1.6)
    } else {
      r = rand(0, 7.5)
      y = rand(-4, 4) * Math.pow(Math.random(), 2)
    }
    out[i * 3] = Math.cos(a) * r
    out[i * 3 + 1] = y
    out[i * 3 + 2] = Math.sin(a) * r
  }
  return out
}

// Hollow shell of scattered points that frames the kinetic-text knot.
export function shellShape(count, radius = 4.6) {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1
    const th = Math.random() * Math.PI * 2
    const r = radius * (0.92 + Math.pow(Math.random(), 4) * 0.5)
    const s = Math.sqrt(1 - u * u)
    out[i * 3] = Math.cos(th) * s * r
    out[i * 3 + 1] = u * r
    out[i * 3 + 2] = Math.sin(th) * s * r
  }
  return out
}

// Two campus clusters joined by a bundle of arcing fibre strands.
export function fibreShape(count, span = 4.2) {
  const out = new Float32Array(count * 3)
  const strands = 28
  const heights = Array.from({ length: strands }, (_, k) => (k / (strands - 1) - 0.5) * 5.2)
  const depths = Array.from({ length: strands }, () => rand(-1.6, 1.6))
  const clusterCount = Math.floor(count * 0.22)
  for (let i = 0; i < count; i++) {
    let x, y, z
    if (i < clusterCount * 2) {
      const side = i < clusterCount ? -1 : 1
      const u = Math.random() * 2 - 1
      const th = Math.random() * Math.PI * 2
      const r = 1.05 * Math.cbrt(Math.random())
      const s = Math.sqrt(1 - u * u)
      x = side * span + Math.cos(th) * s * r
      y = u * r
      z = Math.sin(th) * s * r
    } else {
      const k = i % strands
      const u = Math.random()
      const bow = Math.sin(u * Math.PI)
      x = (u * 2 - 1) * span
      y = bow * heights[k] + rand(-0.02, 0.02)
      z = bow * depths[k] + rand(-0.02, 0.02)
    }
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = z
  }
  return out
}

// Flat grid; the vertex shader folds it into layered silk waves.
export function silkShape(count) {
  const out = new Float32Array(count * 3)
  const cols = Math.ceil(Math.sqrt(count * 1.6))
  const rows = Math.ceil(count / cols)
  for (let i = 0; i < count; i++) {
    out[i * 3] = ((i % cols) / (cols - 1) - 0.5) * 30
    out[i * 3 + 1] = 0
    out[i * 3 + 2] = (Math.floor(i / cols) / (rows - 1)) * 22 - 18 // -18 .. 4
  }
  return out
}
