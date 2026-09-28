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

function lineSegments(polylines, offset, y, closed = false) {
  const pts = []
  for (const line of polylines) {
    const n = closed ? line.length : line.length - 1
    for (let i = 0; i < n; i++) {
      const [ax, az] = line[i]
      const [bx, bz] = line[(i + 1) % line.length]
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
    this.scene.fog = new THREE.FogExp2('#05061a', 0.0016)
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

    // Campus boundary and footpaths drawn in light.
    this.scene.add(
      new THREE.LineSegments(lineSegments([data.outline], off, 0.3, true), new THREE.LineBasicMaterial({ color: '#8fd3ff' })),
    )
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
      if (s.b === null) return
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
        const focus = this.#stopPoint(key, i).setY(b ? b.h * 0.6 : 4)
        const lift = b ? b.h : 10
        return { focus, eye: focus.clone().add(new THREE.Vector3(45, lift + 150, 120)), top: focus.clone().setY((b ? b.h : 8) + 10) }
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
  }

  // Scroll position in "stops": dwells on each stop, travels in between.
  stopPosition() {
    const t = this.progress * (this.stops.length - 1)
    const turn = Math.min(1, Math.max(0, (t - Math.floor(t) - 0.25) / 0.5))
    return Math.min(this.stops.length - 1, Math.floor(t) + turn * turn * (3 - 2 * turn))
  }

  // Screen anchor for stop i's label, or null when off screen / behind.
  labelScreen(i) {
    const v = this.stops[i].top.clone().project(this.camera)
    if (v.z > 1) return null
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight }
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
