import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import DATA from '../data/campus.json'

// A night flight over the real Myongji campuses, built from OpenStreetMap
// building footprints (© OpenStreetMap contributors, ODbL). Each campus is at
// true 1:1 scale; the ~46 km between them is compressed along its real bearing.
const TRANSIT_SCALE = 1 / 12
const M_PER_DEG_LAT = 110540
const HAN_RIVER_LAT = 37.54 // where the route crosses the Han, roughly

const buildingVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const buildingFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uWindow;
  uniform float uGlow;
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(){
    vec3 n = normalize(vNormal);
    float light = 0.35 + 0.65 * max(dot(n, normalize(vec3(-0.4, 0.8, 0.5))), 0.0);
    vec3 col = uColor * light;
    if (abs(n.y) < 0.5) {
      // Lit window bands, one per storey, with a few dark rooms.
      float floorY = fract(vWorld.y / 3.6);
      float band = smoothstep(0.35, 0.45, floorY) * (1.0 - smoothstep(0.7, 0.8, floorY));
      float along = abs(n.x) > abs(n.z) ? vWorld.z : vWorld.x;
      float cell = floor(along / 2.6);
      float lit = step(0.28, hash(vec2(cell, floor(vWorld.y / 3.6))));
      float win = band * step(0.3, fract(along / 2.6)) * lit;
      col += uWindow * win * (0.55 + 0.45 * sin(uTime * 0.7 + cell)) * (1.0 + uGlow * 1.6);
    } else {
      col += uColor * 0.25; // rooftops catch a little sky
    }
    col += vec3(1.0, 0.85, 0.55) * uGlow * 0.12;
    gl_FragColor = vec4(col, 1.0);
  }
`

function footprintGeometry({ p, h }, offset) {
  // Shape lives in XY; after rotateX(-90°) shape y becomes world -z.
  const shape = new THREE.Shape(p.map(([x, z]) => new THREE.Vector2(x + offset.x, -(z + offset.z))))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2)
  return geo
}

function buildingMaterial(color, windowColor) {
  return new THREE.ShaderMaterial({
    vertexShader: buildingVertex,
    fragmentShader: buildingFragment,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uWindow: { value: new THREE.Color(windowColor) },
      uGlow: { value: 0 },
      uTime: { value: 0 },
    },
  })
}

function lineSegments(polylines, offset, y) {
  const pts = []
  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i]
      const [bx, bz] = line[i + 1]
      pts.push(ax + offset.x, y, az + offset.z, bx + offset.x, y, bz + offset.z)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return geo
}

export class CampusFlight {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#05061a')
    this.scene.fog = new THREE.FogExp2('#05061a', 0.0007)
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 9000)
    this.mouse = new THREE.Vector2()
    this.progress = 0
    this.time = 0
    this.materials = []

    // Place Yongin along its true bearing from Seoul, at compressed distance.
    const [slat, slon] = DATA.seoul.origin
    const [ylat, ylon] = DATA.yongin.origin
    const mLon = M_PER_DEG_LAT * Math.cos((slat * Math.PI) / 180)
    this.offsets = {
      seoul: new THREE.Vector3(0, 0, 0),
      yongin: new THREE.Vector3((ylon - slon) * mLon * TRANSIT_SCALE, 0, -(ylat - slat) * M_PER_DEG_LAT * TRANSIT_SCALE),
    }
    this.riverZ = -(HAN_RIVER_LAT - slat) * M_PER_DEG_LAT * TRANSIT_SCALE

    this.#buildGround()
    this.stopMeshes = []
    for (const key of ['seoul', 'yongin']) this.#buildCampus(key)
    this.#buildRoute()
    this.#buildStops()
    this.#buildPost()

    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
    })
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  #buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 40000),
      new THREE.MeshBasicMaterial({ color: '#070a22' }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.2
    this.scene.add(ground)
  }

  #buildCampus(key) {
    const data = DATA[key]
    const off = this.offsets[key]
    const stopIdx = new Set(data.stops.map((s) => s.b).filter((b) => b !== null))
    const campus = []
    const context = []
    data.buildings.forEach((b, i) => {
      if (stopIdx.has(i)) return
      ;(b.c ? campus : context).push(footprintGeometry(b, off))
    })
    const add = (geos, color, windowColor, edgeColor, edgeOpacity) => {
      if (!geos.length) return
      const geo = mergeGeometries(geos)
      const mat = buildingMaterial(color, windowColor)
      this.materials.push(mat)
      this.scene.add(new THREE.Mesh(geo, mat))
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 30),
        new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: edgeOpacity }),
      )
      this.scene.add(edges)
    }
    add(context, '#0c1238', '#3a4f9a', '#2a3b7a', 0.35)
    add(campus, '#16287a', '#8fd3ff', '#6cc4ff', 0.8)

    // Footpaths drawn in light.
    this.scene.add(
      new THREE.LineSegments(
        lineSegments(data.paths, off, 0.2),
        new THREE.LineBasicMaterial({ color: '#34488f', transparent: true, opacity: 0.6 }),
      ),
    )

    // Stop buildings get their own material so they can light up.
    // Index of this campus's first stop in the whole route (Seoul, 2 road stops, Yongin).
    const base = key === 'seoul' ? 0 : DATA.seoul.stops.length + 2
    data.stops.forEach((s, i) => {
      if (s.b === null) {
        // Places that aren't buildings (정문, 백마상) get a pillar of light.
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(1.6, 1.6, 26, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
        )
        pillar.position.set(s.at[0] + off.x, 13, s.at[1] + off.z)
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(5, 6.5, 40),
          new THREE.MeshBasicMaterial({ color: '#ffd98a', side: THREE.DoubleSide }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.set(s.at[0] + off.x, 0.4, s.at[1] + off.z)
        this.scene.add(pillar, ring)
        return
      }
      const mat = buildingMaterial('#1d3aa8', '#bfe6ff')
      this.materials.push(mat)
      const mesh = new THREE.Mesh(footprintGeometry(data.buildings[s.b], off), mat)
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 30),
        new THREE.LineBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.4 }),
      )
      this.scene.add(mesh, edges)
      this.stopMeshes.push({ index: base + i, mat, edges })
    })
  }

  #buildRoute() {
    const sGate = this.#stopPoint('seoul', 0)
    const yGate = this.#stopPoint('yongin', 0)
    const mid = sGate.clone().lerp(yGate, 0.5).add(new THREE.Vector3(260, 0, -120))
    this.route = new THREE.CatmullRomCurve3([
      sGate,
      sGate.clone().add(new THREE.Vector3(0, 0, 220)),
      mid,
      yGate.clone().add(new THREE.Vector3(-60, 0, -260)),
      yGate,
    ])
    this.route.points.forEach((p) => (p.y = 0.5))

    const road = new THREE.Mesh(
      new THREE.TubeGeometry(this.route, 400, 2.5, 6, false),
      new THREE.MeshBasicMaterial({ color: '#6cc4ff' }),
    )
    this.scene.add(road)

    // Traffic: head lights one way, tail lights the other, streaming along the route.
    const n = 900
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    this.traffic = Array.from({ length: n }, (_, i) => {
      const dir = i % 2 ? 1 : -1
      const c = dir > 0 ? [1.6, 0.2, 0.15] : [1.4, 1.35, 1.2]
      col.set(c, i * 3)
      return { t: Math.random(), speed: (0.004 + Math.random() * 0.004) * dir, lane: dir * (1.2 + Math.random() * 1.2) }
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.trafficPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 3.2, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.scene.add(this.trafficPoints)

    // The Han River, a band of light crossing the route.
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 90),
      new THREE.MeshBasicMaterial({ color: '#1b4fd1', transparent: true, opacity: 0.55 }),
    )
    river.rotation.x = -Math.PI / 2
    river.position.set(this.route.getPointAt(0.3).x, 0.1, this.riverZ)
    this.scene.add(river)
  }

  #stopPoint(key, i) {
    const s = DATA[key].stops[i]
    return new THREE.Vector3(s.at[0], 0, s.at[1]).add(this.offsets[key])
  }

  // Route stops with a world-space focus point and a camera pose for each.
  #buildStops() {
    const riverT = this.#routeTAtZ(this.riverZ)
    const stops = []
    const campusStops = (key) =>
      DATA[key].stops.map((s, i) => {
        const b = s.b === null ? null : DATA[key].buildings[s.b]
        const top = this.#stopPoint(key, i).setY((b ? b.h : 26) + 10)
        if (i === 0) {
          // Arriving at the gate: pull back to see the whole campus at once.
          const { center, radius } = this.#campusBounds(key)
          // Narrow (portrait) screens need to back off further to fit the width.
          const r = Math.max(radius, 230) * Math.max(1, 1.2 / this.camera.aspect)
          return { focus: center, eye: center.clone().add(new THREE.Vector3(0, r * 1.15, r * 1.05)), top, overview: key }
        }
        const focus = this.#stopPoint(key, i).setY(b ? b.h * 0.6 : 4)
        const lift = b ? b.h : 10
        return { focus, eye: focus.clone().add(new THREE.Vector3(45, lift + 150, 120)), top }
      })
    stops.push(...campusStops('seoul'))
    for (const t of [riverT, 0.86]) {
      const focus = this.route.getPointAt(t)
      stops.push({ focus, eye: focus.clone().add(new THREE.Vector3(160, 300, 320)), top: focus.clone().setY(30) })
    }
    stops.push(...campusStops('yongin'))
    this.stops = stops
    this.eyeCurve = new THREE.CatmullRomCurve3(stops.map((s) => s.eye), false, 'centripetal')
    this.focusCurve = new THREE.CatmullRomCurve3(stops.map((s) => s.focus), false, 'centripetal')
  }

  // Centre and radius of a campus's official buildings, in world space.
  #campusBounds(key) {
    const pts = DATA[key].buildings.filter((b) => b.c).flatMap((b) => b.p)
    const xs = pts.map((p) => p[0])
    const zs = pts.map((p) => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2
    return { center: new THREE.Vector3(cx, 0, cz).add(this.offsets[key]), radius }
  }

  // Every official building, for name tags in the campus overviews.
  get tags() {
    if (!this._tags) {
      this._tags = ['seoul', 'yongin'].flatMap((key) =>
        DATA[key].buildings
          .filter((b) => b.n)
          .map((b) => {
            const cx = b.p.reduce((a, q) => a + q[0], 0) / b.p.length
            const cz = b.p.reduce((a, q) => a + q[1], 0) / b.p.length
            return { key, name: b.n, pos: new THREE.Vector3(cx, b.h + 4, cz).add(this.offsets[key]) }
          }),
      )
    }
    return this._tags
  }

  // Which campus overview (if any) the camera is at, and how fully (0..1).
  overview() {
    const t = this.smooth * (this.stops.length - 1)
    for (const [i, s] of this.stops.entries()) {
      if (s.overview) {
        const w = Math.max(0, 1 - Math.abs(t - i) * 2)
        if (w > 0) return { key: s.overview, weight: w }
      }
    }
    return null
  }

  screen(v) {
    const p = v.clone().project(this.camera)
    if (p.z > 1) return null
    return { x: (p.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-p.y * 0.5 + 0.5) * this.canvas.clientHeight }
  }

  #routeTAtZ(z) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i <= 200; i++) {
      const d = Math.abs(this.route.getPointAt(i / 200).z - z)
      if (d < bestD) (bestD = d), (best = i / 200)
    }
    return best
  }

  #buildPost() {
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 0.3))
    this.composer.addPass(new OutputPass())
  }

  resize() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.fov = w / h < 0.8 ? 68 : 50
    this.camera.updateProjectionMatrix()
    // Overview framing depends on the aspect ratio.
    if (this.stops) this.#buildStops()
  }

  // Scroll position in "stops": dwells on each stop, travels in between.
  stopPosition() {
    const t = this.progress * (this.stops.length - 1)
    const turn = Math.min(1, Math.max(0, (t - Math.floor(t) - 0.25) / 0.5))
    return Math.min(this.stops.length - 1, Math.floor(t) + turn * turn * (3 - 2 * turn))
  }

  // Screen anchor for stop i's label, or null when off screen / behind.
  labelScreen(i) {
    return this.screen(this.stops[i].top)
  }

  render(time, dt) {
    this.time += dt
    const s = this.stopPosition()
    const u = s / (this.stops.length - 1)
    this.smooth = this.smooth === undefined ? u : this.smooth + (u - this.smooth) * Math.min(1, dt * 3)
    const eye = this.eyeCurve.getPoint(this.smooth)
    const focus = this.focusCurve.getPoint(this.smooth)
    this.camera.position.copy(eye).add(new THREE.Vector3(this.mouse.x * 12, this.mouse.y * 8, 0))
    this.camera.lookAt(focus)
    this.current = Math.round(this.smooth * (this.stops.length - 1))

    for (const m of this.materials) m.uniforms.uTime.value = this.time
    for (const sm of this.stopMeshes) {
      const target = sm.index === this.current ? 0.8 + 0.2 * Math.sin(this.time * 3) : 0
      sm.mat.uniforms.uGlow.value += (target - sm.mat.uniforms.uGlow.value) * Math.min(1, dt * 4)
      sm.edges.material.opacity = 0.4 + sm.mat.uniforms.uGlow.value
    }

    const pos = this.trafficPoints.geometry.attributes.position
    const p = new THREE.Vector3()
    const tan = new THREE.Vector3()
    this.traffic.forEach((c, i) => {
      c.t = (c.t + c.speed * dt * 6 + 1) % 1
      this.route.getPointAt(c.t, p)
      this.route.getTangentAt(c.t, tan)
      pos.setXYZ(i, p.x - tan.z * c.lane, 1.2, p.z + tan.x * c.lane)
    })
    pos.needsUpdate = true

    this.composer.render()
  }
}
