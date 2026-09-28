import * as THREE from 'three'

// Camera stands inside a cylinder of college panels; scrolling or dragging
// sweeps the curved wall past the viewer.
const R = 6
const H = 3.7

function panelTexture([ko, en, campus], i, n) {
  const c = document.createElement('canvas')
  c.width = 900
  c.height = 1220
  const ctx = c.getContext('2d')
  const seoul = campus === 'SEOUL'
  const g = ctx.createLinearGradient(0, 0, 900, 1220)
  g.addColorStop(0, seoul ? '#2f5bff' : '#10b3a3')
  g.addColorStop(1, seoul ? '#0b1a6b' : '#063f5c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 900, 1220)

  // Soft light blob.
  const rg = ctx.createRadialGradient(700, 220, 0, 700, 220, 520)
  rg.addColorStop(0, 'rgba(255,255,255,0.45)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, 900, 1220)

  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = 'italic 400 360px "Instrument Serif", serif'
  ctx.textBaseline = 'top'
  ctx.globalAlpha = 0.22
  ctx.fillText(String(i + 1).padStart(2, '0'), 60, 40)
  ctx.globalAlpha = 1

  ctx.font = '600 34px "Pretendard Variable", Pretendard, sans-serif'
  ctx.fillText(`${String(i + 1).padStart(2, '0')} / ${n}`, 70, 70)
  const chip = seoul ? '인문캠퍼스 · SEOUL' : '자연캠퍼스 · YONGIN'
  ctx.font = '600 32px "Pretendard Variable", Pretendard, sans-serif'
  const cw = ctx.measureText(chip).width + 48
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(900 - 70 - cw, 56, cw, 64, 32)
  ctx.stroke()
  ctx.fillText(chip, 900 - 70 - cw + 24, 72)

  // Name, wrapped to fit.
  ctx.textBaseline = 'alphabetic'
  let size = 150
  ctx.font = `800 ${size}px "Pretendard Variable", Pretendard, sans-serif`
  while (ctx.measureText(ko).width > 760 && size > 80) {
    size -= 6
    ctx.font = `800 ${size}px "Pretendard Variable", Pretendard, sans-serif`
  }
  ctx.fillStyle = '#fff'
  ctx.fillText(ko, 70, 1020)
  ctx.font = 'italic 400 64px "Instrument Serif", serif'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillText(en, 74, 1110)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  // Seen from inside the cylinder, so mirror horizontally.
  tex.wrapS = THREE.RepeatWrapping
  tex.repeat.x = -1
  tex.offset.x = 1
  return tex
}

export class Rotunda {
  constructor(canvas, items) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#eef2fb')
    this.scene.fog = new THREE.Fog('#eef2fb', 6, 13)
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 50)
    this.camera.position.set(0, 0, 0)

    this.n = items.length
    this.step = (Math.PI * 2) / this.n
    this.group = new THREE.Group()
    this.panels = items.map((item, i) => {
      const len = this.step * 0.84
      // Panel i sits at theta = PI - i*step, i.e. clockwise from straight ahead.
      const theta = Math.PI - i * this.step
      const geo = new THREE.CylinderGeometry(R, R, H, 32, 1, true, theta - len / 2, len)
      const mat = new THREE.MeshBasicMaterial({ map: panelTexture(item, i, this.n), side: THREE.BackSide, transparent: true })
      const mesh = new THREE.Mesh(geo, mat)
      this.group.add(mesh)
      return mesh
    })

    // Thin floor and ceiling rings of light.
    for (const y of [-H / 2 - 0.35, H / 2 + 0.35]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(R * 0.98, 0.012, 6, 160),
        new THREE.MeshBasicMaterial({ color: '#2f5bff' }),
      )
      ring.rotation.x = Math.PI / 2
      ring.position.y = y
      this.group.add(ring)
    }
    this.group.position.y = -0.35
    this.scene.add(this.group)

    this.progress = 0
    this.drag = 0
    this.dragVel = 0
    this.mouse = new THREE.Vector2()
    this.active = 0
    this.onActive = null

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX }
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return
      const dx = e.clientX - this.dragging.x
      this.dragging.x = e.clientX
      this.dragVel = dx * 0.004
      this.drag += this.dragVel
    })
    const end = () => (this.dragging = null)
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
    })

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep roughly one and a half panels in view on narrow screens.
    this.camera.fov = w / h < 0.8 ? 88 : 72
    this.camera.updateProjectionMatrix()
  }

  render(time, dt) {
    if (!this.dragging) {
      this.dragVel *= Math.pow(0.03, dt)
      this.drag += this.dragVel
    }
    // Dwell on each panel: scroll only turns the wall between panels.
    const t = this.progress * (this.n - 1)
    const turn = Math.min(1, Math.max(0, (t - Math.floor(t) - 0.3) / 0.4))
    const snapped = Math.floor(t) + turn * turn * (3 - 2 * turn)
    const rot = snapped * this.step - this.drag
    this.group.rotation.y += (rot - this.group.rotation.y) * Math.min(1, dt * 6)

    // Brighten the panel facing the viewer.
    const idx = ((Math.round(this.group.rotation.y / this.step) % this.n) + this.n) % this.n
    this.panels.forEach((p, i) => {
      const target = i === idx ? 1 : 0.55
      p.material.opacity += (target - p.material.opacity) * Math.min(1, dt * 5)
    })
    if (idx !== this.active) {
      this.active = idx
      this.onActive?.(idx)
    }

    this.camera.rotation.set(this.mouse.y * 0.08, -this.mouse.x * 0.12, 0)
    this.renderer.render(this.scene, this.camera)
  }
}
