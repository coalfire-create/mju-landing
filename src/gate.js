// The SNU '샤' gate drawn in starlight particles, matching the emblem above.
// Scrolling walks the camera up the approach road and through the gate:
// the gate swells, the portal brightens, and the frame floods with light.

// Gate geometry in world units (x right, y down; ground at y = 45).
const GATE = [
  // ㅅ — left leg
  [[-18, -145], [0, -170], [8, -140], [-75, 45], [-115, 45]],
  // ㅅ — right leg
  [[0, -170], [18, -145], [115, 45], [75, 45], [0, -135]],
  // ㄱ
  [[-195, -50], [-75, -50], [-75, -28], [-165, -28], [-165, 45], [-195, 45]],
  // ㄷ
  [[75, -20], [175, -20], [175, 0], [105, 0], [105, 25], [185, 25], [185, 45], [75, 45]],
]
const GROUND = 45
const PORTAL = { x: 0, y: -10 }
const GATE_Z = 1000
const STAR_FAR = 4200

const COLORS = {
  white: [240, 245, 255],
  ice: [170, 210, 255],
  blue: [90, 150, 255],
  gold: [255, 214, 120],
}

function rand(a, b) {
  return a + Math.random() * (b - a)
}

// Soft round sprite so thousands of points can be drawn with drawImage.
function makeSprite([r, g, b]) {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = c.getContext('2d')
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`)
  grad.addColorStop(0.25, `rgba(${r},${g},${b},0.55)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 32, 32)
  return c
}

// Rasterize the gate and return contour-heavy sample points in world units.
function sampleGate(count) {
  const S = 2 // raster pixels per world unit
  const ox = 200
  const oy = 175
  const c = document.createElement('canvas')
  c.width = 400 * S
  c.height = 225 * S
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  for (const poly of GATE) {
    ctx.beginPath()
    poly.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (x + ox) * S, (y + oy) * S))
    ctx.closePath()
    ctx.fill()
  }
  const data = ctx.getImageData(0, 0, c.width, c.height).data
  const inside = (x, y) => x >= 0 && y >= 0 && x < c.width && y < c.height && data[(y * c.width + x) * 4 + 3] > 128
  const edge = []
  const body = []
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      if (!inside(x, y)) continue
      const e = !inside(x - 3, y) || !inside(x + 3, y) || !inside(x, y - 3) || !inside(x, y + 3)
      ;(e ? edge : body).push([x / S - ox, y / S - oy])
    }
  }
  const pts = []
  for (let i = 0; i < count; i++) {
    const src = i < count * 0.62 ? edge : body
    const [x, y] = src[Math.floor(Math.random() * src.length)]
    pts.push({
      x: x + rand(-0.6, 0.6),
      y: y + rand(-0.6, 0.6),
      z: GATE_Z + rand(-6, 6),
      color: Math.random() < 0.18 ? 'gold' : Math.random() < 0.5 ? 'white' : 'ice',
      phase: Math.random() * Math.PI * 2,
      size: 0.8 + Math.pow(Math.random(), 3) * 1.6,
    })
  }
  return pts
}

export class GateExperience {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.mobile = window.matchMedia('(max-width: 760px)').matches
    this.progress = 0
    this.scrollSpeed = 1
    this.time = 0
    this.cam = 0
    this.mouse = { x: 0, y: 0 }
    this.sprites = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, makeSprite(v)]))

    this.gate = sampleGate(this.mobile ? 1800 : 3200)
    this.stars = Array.from({ length: this.mobile ? 160 : 280 }, () => this.#star(true))
    this.road = []
    for (let z = 40; z < GATE_Z; z += 26) {
      for (const x of [-60, -30, 0, 30, 60]) this.road.push({ x, z })
    }

    this.resize()
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('pointermove', (e) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1
      this.mouse.y = (e.clientY / innerHeight) * 2 - 1
    })

    // Only animate while on screen.
    this.visible = false
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting
      if (this.visible) this.#start()
    }).observe(canvas)
  }

  #star(scatter) {
    // Stars pour out of the portal toward the viewer from far beyond the gate.
    const a = Math.random() * Math.PI * 2
    const r = Math.pow(Math.random(), 0.6) * 520
    return {
      x: PORTAL.x + Math.cos(a) * r,
      y: PORTAL.y + Math.sin(a) * r * 0.7,
      z: scatter ? rand(this.cam + 60, STAR_FAR) : rand(GATE_Z + 200, STAR_FAR),
      speed: rand(6, 14),
      color: ['white', 'ice', 'blue', 'gold', 'white'][Math.floor(Math.random() * 5)],
      size: rand(0.8, 2.2),
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.width = rect.width || innerWidth
    this.height = rect.height || innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    this.canvas.width = Math.round(this.width * dpr)
    this.canvas.height = Math.round(this.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // At the start of the walk the gate spans about 45% of the width.
    this.focal = Math.min((this.width * 0.45) / 380, (this.height * 0.5) / 215) * GATE_Z
  }

  #project(x, y, z) {
    const d = z - this.cam
    if (d < 1) return null
    const k = this.focal / d
    // Camera eye sits a little above the road; the horizon is at 45% height.
    return {
      x: this.width / 2 + (x - this.mouse.x * 30) * k,
      y: this.height * 0.45 + (y - 10 + this.mouse.y * 12) * k,
      k,
    }
  }

  #start() {
    if (this.running) return
    this.running = true
    let last = performance.now()
    const tick = (now) => {
      if (!this.visible) {
        this.running = false
        return
      }
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      this.#frame(dt)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  #frame(dt) {
    const ctx = this.ctx
    const p = this.progress
    this.time += dt
    // Ease the walk so it settles when scrolling stops.
    const targetCam = Math.pow(p, 1.6) * (GATE_Z - 30)
    this.cam += (targetCam - this.cam) * Math.min(1, dt * 4)
    const approach = this.cam / GATE_Z

    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.globalCompositeOperation = 'lighter'

    // Portal glow behind the gate, strengthening as we approach.
    const pc = this.#project(PORTAL.x, PORTAL.y, GATE_Z + 40)
    if (pc) {
      const pulse = 1 + Math.sin(this.time * 2.2) * 0.08
      const r = 150 * pc.k * pulse * (1 + approach)
      const g = ctx.createRadialGradient(pc.x, pc.y, 0, pc.x, pc.y, r)
      g.addColorStop(0, `rgba(235, 244, 255, ${0.55 + approach * 0.4})`)
      g.addColorStop(0.3, `rgba(110, 170, 255, ${0.28 + approach * 0.3})`)
      g.addColorStop(1, 'rgba(20, 40, 120, 0)')
      ctx.fillStyle = g
      ctx.fillRect(pc.x - r, pc.y - r, r * 2, r * 2)
    }

    // Approach road: rows of dots flowing toward us.
    const flow = (this.time * 60 * this.scrollSpeed) % 26
    for (const d of this.road) {
      const z = d.z - flow
      const q = this.#project(d.x, GROUND, z)
      if (!q) continue
      const a = Math.min(1, (z - this.cam) / 240) * (1 - z / GATE_Z) * 0.9
      if (a <= 0) continue
      const s = Math.min(6, Math.max(1.5, 5 * q.k))
      ctx.globalAlpha = a
      ctx.drawImage(this.sprites.ice, q.x - s, q.y - s, s * 2, s * 2)
    }

    // Stars streaming out of the portal and past the viewer.
    const step = dt * 60 * this.scrollSpeed
    for (let i = 0; i < this.stars.length; i++) {
      const st = this.stars[i]
      st.z -= st.speed * step * (1 + approach * 2)
      if (st.z < this.cam + 20) {
        this.stars[i] = this.#star(false)
        continue
      }
      const head = this.#project(st.x, st.y, st.z)
      const tail = this.#project(st.x, st.y, st.z + st.speed * 10)
      if (!head || !tail) continue
      const a = Math.min(1, (STAR_FAR - st.z) / 600)
      const [r, g, b] = COLORS[st.color]
      ctx.globalAlpha = a
      ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`
      ctx.lineWidth = Math.min(2.5, Math.max(0.6, st.size * head.k * 0.9))
      ctx.beginPath()
      ctx.moveTo(tail.x, tail.y)
      ctx.lineTo(head.x, head.y)
      ctx.stroke()
      const s = Math.min(9, Math.max(1.2, st.size * head.k * 2.2))
      ctx.drawImage(this.sprites[st.color], head.x - s, head.y - s, s * 2, s * 2)
    }

    // The gate itself, in twinkling starlight.
    for (const pt of this.gate) {
      const q = this.#project(pt.x, pt.y, pt.z)
      if (!q) continue
      const tw = 0.7 + 0.3 * Math.sin(this.time * 2.4 + pt.phase)
      const s = Math.min(16, Math.max(1, pt.size * q.k * 2.4))
      ctx.globalAlpha = tw
      ctx.drawImage(this.sprites[pt.color], q.x - s, q.y - s, s * 2, s * 2)
    }

    // Passing through: light floods the frame and stays white — the climb
    // section below opens on the same white and clears onto the real 정문.
    const f = Math.min(1, Math.max(0, (p - 0.78) / 0.2))
    const flood = f * f * (3 - 2 * f)
    if (flood > 0) {
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = `rgba(225, 236, 255, ${flood})`
      ctx.fillRect(0, 0, this.width, this.height)
    }
    ctx.globalAlpha = 1
  }
}
