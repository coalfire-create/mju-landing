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

import snuPath from './snu_path.js'

// Authentic Seoul National University Official Seal formed exclusively by starlight particles.
// Uses Path2D and high-resolution stroke rasterization so every contour (laurel wreath, crossed pen & torch,
// open book with VERITAS LUX MEA, and the central shield) is unmistakably clear and crisp.
let cachedEmblemPoints = null

function getEmblemPoints() {
  if (cachedEmblemPoints) return cachedEmblemPoints

  const cw = 1100
  const ch = 1140
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  // Clean black background
  ctx.clearRect(0, 0, cw, ch)

  // Map SVG viewBox (162.86 x 168.93) to canvas (cw x ch)
  const scaleX = cw / 162.86012
  const scaleY = ch / 168.93428
  ctx.scale(scaleX, scaleY)
  ctx.translate(-212.27147, 92.121406)
  ctx.transform(1.6999673, 0, 0, 1.6999673, -205.58145, 5.3577358)

  // Fill the seal exactly as the SVG does. Stroking it instead (at ~11x scale)
  // swelled every line past the gaps between letters and leaves.
  ctx.fillStyle = '#ffffff'
  ctx.fill(new Path2D(snuPath), 'nonzero')

  const data = ctx.getImageData(0, 0, cw, ch).data
  const inside = (x, y) => x >= 0 && y >= 0 && x < cw && y < ch && data[(y * cw + x) * 4 + 3] > 128
  const edgePts = []
  const fillPts = []
  let minX = cw, maxX = 0, minY = ch, maxY = 0

  // Inked pixels that touch a gap within 3px form the contour; the rest is body.
  const R = 3
  for (let py = 0; py < ch; py += 2) {
    for (let px = 0; px < cw; px += 2) {
      if (!inside(px, py)) continue
      const edge = !inside(px - R, py) || !inside(px + R, py) || !inside(px, py - R) || !inside(px, py + R)
      ;(edge ? edgePts : fillPts).push(px, py)
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
  }

  cachedEmblemPoints = { edgePts, fillPts, minX, maxX, minY, maxY }
  console.log('[SNU 3D Particle Seal] Contours generated:', edgePts.length / 2, 'Interior points:', fillPts.length / 2)
  return cachedEmblemPoints
}

export function snuOfficialEmblemShape(count, size = 9.4, { depth = 0.18, y = 0.05 } = {}) {
  const { edgePts, fillPts, minX, maxX, minY, maxY } = getEmblemPoints()
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const scale = size / Math.max(maxX - minX, maxY - minY)

  const out = new Float32Array(count * 3)

  // Most particles trace the contours so every symbol reads clearly
  const edgeCount = Math.floor(count * 0.75)
  const edgeTotal = edgePts.length / 2

  for (let i = 0; i < edgeCount; i++) {
    const idx = Math.floor(Math.random() * edgeTotal) * 2
    // Very tiny jitter for a sharp, crisp line
    const px = (edgePts[idx] - cx + rand(-0.1, 0.1)) * scale
    const py = -(edgePts[idx + 1] - cy + rand(-0.1, 0.1)) * scale + y
    out[i * 3] = px
    out[i * 3 + 1] = py
    out[i * 3 + 2] = rand(-depth * 0.1, depth * 0.1)
  }

  // ...and some of the rest fill the inked body evenly
  const fillCount = Math.floor(count * 0.23)
  const fillTotal = fillPts.length / 2
  for (let i = edgeCount; i < edgeCount + fillCount; i++) {
    const idx = Math.floor(Math.random() * fillTotal) * 2
    const px = (fillPts[idx] - cx + rand(-0.4, 0.4)) * scale
    const py = -(fillPts[idx + 1] - cy + rand(-0.4, 0.4)) * scale + y
    out[i * 3] = px
    out[i * 3 + 1] = py
    out[i * 3 + 2] = rand(-depth * 0.3, depth * 0.3)
  }

  // The remaining 2% form a faint dust haze around the emblem
  for (let i = edgeCount + fillCount; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const r = (size * 0.45) + Math.pow(Math.random(), 2) * (size * 0.3)
    out[i * 3] = Math.cos(a) * r
    out[i * 3 + 1] = Math.sin(a) * r + y
    out[i * 3 + 2] = rand(-0.35, 0.35)
  }

  return out
}

// The particles collapse into the Big Dipper (7 stars of the compass)
export function globeShape(count, radius = 5.0) {
  const out = new Float32Array(count * 3)
  
  // Approximate Big Dipper layout (scaled to fit nicely on screen)
  const spread = 1.8;
  const dipper = [
    { x: -3.0 * spread, y: 1.5 * spread },   // Alkaid
    { x: -1.8 * spread, y: 1.0 * spread },   // Mizar
    { x: -0.6 * spread, y: 0.6 * spread },   // Alioth
    { x: 0.5 * spread, y: 0.2 * spread },    // Megrez
    { x: 0.8 * spread, y: -1.2 * spread },   // Phecda
    { x: 2.2 * spread, y: -1.0 * spread },   // Merak
    { x: 2.3 * spread, y: 0.5 * spread }     // Dubhe
  ];
  
  for (let i = 0; i < count; i++) {
    const bucket = i % 7;
    const targetX = dipper[bucket].x;
    const targetY = dipper[bucket].y;

    // Make 85% of particles form a hyper-dense core, 15% form an aura
    if (Math.random() < 0.85) {
      // Extremely dense core
      const r = Math.pow(Math.random(), 4) * 0.02;
      const a = Math.random() * Math.PI * 2;
      out[i * 3] = targetX + Math.cos(a) * r;
      out[i * 3 + 1] = targetY + Math.sin(a) * r;
      out[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    } else {
      // Small swirling aura
      const r = Math.pow(Math.random(), 2) * 0.2; // Reduced aura size
      const a = Math.random() * Math.PI * 2;
      out[i * 3] = targetX + Math.cos(a) * r;
      out[i * 3 + 1] = targetY + Math.sin(a) * r;
      out[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    }
  }
  return out;
}

// Flat grid; the vertex shader lifts it into a scrolling ridge terrain (Gwanak-san).
export function terrainShape(count) {
  const out = new Float32Array(count * 3)
  const cols = Math.ceil(Math.sqrt(count * 1.4))
  const rows = Math.ceil(count / cols)
  for (let i = 0; i < count; i++) {
    const cx = i % cols
    const rz = Math.floor(i / cols)
    out[i * 3] = (cx / (cols - 1) - 0.5) * 30
    out[i * 3 + 1] = 0
    out[i * 3 + 2] = (rz / (rows - 1)) * 34 - 30 // -30 .. 4
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
