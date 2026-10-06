import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import DATA from '../data/campus.json'
import WORLD from '../data/world.json'

// A flight over the real Myongji campuses, built only from free open data:
// OpenStreetMap footprints, land use and trees (© OpenStreetMap contributors,
// ODbL) on AWS Terrain Tiles elevation. Each campus is at true 1:1 scale on
// its real relief; the ~46 km between them is compressed along its real
// bearing. Golden hour over 인문캠퍼스, turning to dusk with the windows lit
// by the time the flight reaches 자연캠퍼스 on its mountainside.
const TRANSIT_SCALE = 1 / 12
const M_PER_DEG_LAT = 110540
const HAN_RIVER_LAT = 37.54 // where the route crosses the Han, roughly
const MOBILE = innerWidth < 760
const KEYS = ['seoul', 'yongin']
const EDGE = 160 // metres over which each terrain patch settles to the plain

// 0 = golden hour, 1 = blue hour with the windows lit.
const NIGHT = { value: 0 }
// Official building currently at the flight's stop: its global stop index.
const CURRENT = { value: -1 }
const PULSE = { value: 0 }
const DUSK = {
  sun: [new THREE.Color('#ffc98f'), new THREE.Color('#ff7a45')],
  sky: [new THREE.Color('#a9c3e6'), new THREE.Color('#34487a')],
  fog: [new THREE.Color('#b3bcc6'), new THREE.Color('#3a466a')],
}

// Wall / roof look by style: s = style index, per-building seed, base and top.
const STYLE = { c: 0, m: 2, d: 4, t: 5 }
const buildingChunks = {
  vertexPars: /* glsl */ `
    attribute vec4 aB; // style, seed, base y, top y
    attribute float aStop; // global stop index, or -1
    varying vec4 vB;
    varying float vStop;
    varying vec3 vPos;
    varying vec2 vUv2;
    varying float vUp;
  `,
  vertex: /* glsl */ `
    vB = aB;
    vStop = aStop;
    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vUv2 = uv;
    vUp = normal.y;
  `,
  fragmentPars: /* glsl */ `
    uniform float uNight;
    uniform float uCurrent;
    uniform float uPulse;
    varying vec4 vB;
    varying float vStop;
    varying vec3 vPos;
    varying vec2 vUv2;
    varying float vUp;
    float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1,0), 1.0)), c = hash(vec3(i + vec2(0,1), 1.0)), d = hash(vec3(i + 1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
    // Per style: bay width, floor height, window w, window h, wall colour, glass tint.
    void styleOf(float s, float seed, out vec4 g, out vec3 wall, out vec3 glass){
      if (s < 0.5)      { g = vec4(3.6, 3.8, 1.8, 2.2); wall = mix(vec3(0.7, 0.68, 0.64), vec3(0.62, 0.5, 0.42), step(0.5, seed)); glass = vec3(0.14, 0.17, 0.21); } // stone / brick campus hall
      else if (s < 2.5) { g = vec4(1.6, 4.0, 1.52, 3.7); wall = vec3(0.5, 0.54, 0.58); glass = vec3(0.16, 0.25, 0.33); }   // curtain wall
      else if (s < 4.5) { g = vec4(2.8, 3.0, 1.1, 1.3); wall = vec3(0.74, 0.68, 0.6); glass = vec3(0.15, 0.17, 0.19); }  // dorm
      else {
        g = vec4(3.2, 3.0, 1.3, 1.4);
        float k = floor(seed * 5.0);
        wall = k < 1.0 ? vec3(0.66, 0.63, 0.58) : k < 2.0 ? vec3(0.58, 0.49, 0.42) : k < 3.0 ? vec3(0.5, 0.31, 0.24) : k < 4.0 ? vec3(0.76, 0.75, 0.72) : vec3(0.46, 0.49, 0.52);
        glass = vec3(0.16, 0.18, 0.2);
      }
    }
  `,
  color: /* glsl */ `
    float bStyle = vB.x, bSeed = vB.y, bBase = vB.z, bTop = vB.w;
    vec4 g; vec3 wall; vec3 glass;
    styleOf(bStyle, bSeed, g, wall, glass);
    float hgt = vPos.y - bBase;
    float isWall = 1.0 - step(0.5, abs(vUp));
    float winMask = 0.0;
    float lit = 0.0;
    if (isWall > 0.5) {
      wall *= 0.92 + 0.12 * vnoise(vec2(vUv2.x * 0.7, hgt * 1.3) + bSeed * 50.0);
      wall *= 0.9 + 0.1 * smoothstep(0.0, 3.0, hgt);
      float fl = floor(hgt / g.y);
      float bay = floor(vUv2.x / g.x);
      vec2 cell = vec2(fract(vUv2.x / g.x) * g.x - g.x * 0.5, fract(hgt / g.y) * g.y - g.y * 0.45);
      float inWin = step(abs(cell.x), g.z * 0.5) * step(abs(cell.y), g.w * 0.5);
      inWin *= step(hgt, bTop - bBase - 0.9) * step(0.9, hgt);
      winMask = inWin;
      float r = hash(vec3(fl, bay, bSeed * 91.0));
      lit = inWin * step(0.82 - uNight * 0.32, r);
      vec3 sky = mix(vec3(0.95, 0.72, 0.45), vec3(0.45, 0.6, 0.8), clamp(cell.y / g.w + 0.5, 0.0, 1.0));
      vec3 glassCol = mix(glass, sky * (1.0 - uNight * 0.75), 0.28 + 0.2 * r);
      wall = mix(wall, glassCol, inWin);
    } else {
      float n = vnoise(vPos.xz * 0.35 + bSeed * 20.0);
      wall = mix(vec3(0.42, 0.42, 0.41), vec3(0.52, 0.51, 0.49), n) * (0.9 + 0.1 * bSeed);
      wall *= 1.0 - 0.15 * step(0.93, fract(vPos.x * 0.12)) * step(0.5, fract(vPos.z * 0.05));
    }
    diffuseColor.rgb = wall;
  `,
  roughness: /* glsl */ `
    roughnessFactor = mix(0.85, 0.18, winMask);
  `,
  metalness: /* glsl */ `
    metalnessFactor = mix(0.0, 0.55, winMask);
  `,
  emissive: /* glsl */ `
    totalEmissiveRadiance += vec3(1.0, 0.72, 0.4) * lit * (0.9 + uNight * 2.6);
    // The building the tour is visiting glows gold.
    float here = step(abs(vStop - uCurrent), 0.5) * step(0.0, vStop);
    totalEmissiveRadiance += vec3(1.0, 0.78, 0.38) * here * uPulse * (0.25 + 0.5 * lit + 0.15 * isWall);
  `,
}

function buildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 })
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT
    sh.uniforms.uCurrent = CURRENT
    sh.uniforms.uPulse = PULSE
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + buildingChunks.vertexPars)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + buildingChunks.vertex)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + buildingChunks.fragmentPars)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + buildingChunks.color)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + buildingChunks.roughness)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + buildingChunks.metalness)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + buildingChunks.emissive)
  }
  mat.customProgramCacheKey = () => 'mju-building'
  return mat
}

export class CampusFlight {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.25 : 1.6))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.5
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(50, 1, 2, 12000)
    this.mouse = new THREE.Vector2()
    this.progress = 0
    this.time = 0
    this.exploreTarget = null
    this.heights = {}

    // Place Yongin along its true bearing from Seoul, at compressed distance.
    const [slat, slon] = DATA.seoul.origin
    const [ylat, ylon] = DATA.yongin.origin
    const mLon = M_PER_DEG_LAT * Math.cos((slat * Math.PI) / 180)
    this.offsets = {
      seoul: new THREE.Vector3(0, 0, 0),
      yongin: new THREE.Vector3((ylon - slon) * mLon * TRANSIT_SCALE, 0, -(ylat - slat) * M_PER_DEG_LAT * TRANSIT_SCALE),
    }
    this.riverZ = -(HAN_RIVER_LAT - slat) * M_PER_DEG_LAT * TRANSIT_SCALE

    this.#buildSky()
    this.#buildPlain()
    this.stopEdges = []
    for (const key of KEYS) {
      this.#buildGround(key)
      this.#buildCampus(key)
    }
    this.#buildRoute()
    this.#buildStops()
    this.#loadTerrain()

    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
    })
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  // Ground height at a world point: each campus's real relief, settling to
  // the flat plain at the edge of its patch.
  groundAt(x, z) {
    for (const key of KEYS) {
      const h = this.heights[key]
      if (!h) continue
      const T = WORLD[key].terrain
      const lx = x - this.offsets[key].x
      const lz = z - this.offsets[key].z
      const R = -T.x0
      if (Math.abs(lx) > R || Math.abs(lz) > R) continue
      const fx = THREE.MathUtils.clamp((lx - T.x0) / T.step, 0, T.w - 1.001)
      const fz = THREE.MathUtils.clamp((lz - T.z0) / T.step, 0, T.h - 1.001)
      const i = Math.floor(fx)
      const j = Math.floor(fz)
      const tx = fx - i
      const tz = fz - j
      const a = h[j * T.w + i] * (1 - tx) + h[j * T.w + i + 1] * tx
      const b = h[(j + 1) * T.w + i] * (1 - tx) + h[(j + 1) * T.w + i + 1] * tx
      const edge = Math.min(R - Math.abs(lx), R - Math.abs(lz)) / EDGE
      return (a * (1 - tz) + b * tz) * THREE.MathUtils.smoothstep(edge, 0, 1)
    }
    return 0
  }

  #buildSky() {
    const sky = new Sky()
    sky.scale.setScalar(40000)
    const u = sky.material.uniforms
    u.turbidity.value = 7
    u.rayleigh.value = 2.2
    u.mieCoefficient.value = 0.006
    u.mieDirectionalG.value = 0.85
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 12), THREE.MathUtils.degToRad(235))
    this.lightDir = this.sunDir.clone()
    u.sunPosition.value.copy(this.sunDir)
    this.sky = sky
    this.scene.add(sky)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const envScene = new THREE.Scene()
    envScene.add(sky.clone())
    this.scene.environment = pmrem.fromScene(envScene, 0, 1, 60000).texture
    this.scene.environmentIntensity = 0.35
    pmrem.dispose()
    this.scene.fog = new THREE.Fog(DUSK.fog[0].clone(), 1400, 5200)

    this.sun = new THREE.DirectionalLight('#ffc98f', 3.2)
    this.sun.castShadow = true
    const sm = MOBILE ? 1024 : 2048
    this.sun.shadow.mapSize.set(sm, sm)
    const c = this.sun.shadow.camera
    c.left = c.bottom = -520
    c.right = c.top = 520
    c.near = 10
    c.far = 2600
    c.updateProjectionMatrix()
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.8
    this.hemi = new THREE.HemisphereLight('#a9c3e6', '#5a4d3c', 0.55)
    this.scene.add(this.sun, this.sun.target, this.hemi)
  }

  #setNight(n) {
    NIGHT.value = n
    const u = this.sky.material.uniforms
    const az = THREE.MathUtils.degToRad(235 + n * 12)
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - THREE.MathUtils.lerp(12, 0.6, n)), az)
    u.sunPosition.value.copy(this.sunDir)
    u.rayleigh.value = 2.2 + n * 2.2
    u.turbidity.value = 7 - n * 4
    // The light itself never drops below the horizon.
    this.lightDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - THREE.MathUtils.lerp(12, 4, n)), az)
    this.sun.intensity = THREE.MathUtils.lerp(3.2, 0.45, n)
    this.sun.color.lerpColors(...DUSK.sun, n)
    this.hemi.intensity = THREE.MathUtils.lerp(0.55, 0.32, n)
    this.hemi.color.lerpColors(...DUSK.sky, n)
    this.scene.fog.color.lerpColors(...DUSK.fog, n)
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.35, 0.12, n)
  }

  // The country between the campuses: farmland and town seen from high up.
  #buildPlain() {
    const c = document.createElement('canvas')
    c.width = c.height = 1024
    const g = c.getContext('2d')
    g.fillStyle = '#6d7560'
    g.fillRect(0, 0, 1024, 1024)
    for (let i = 0; i < 2600; i++) {
      const tone = Math.random()
      g.fillStyle = tone < 0.45 ? `rgba(${95 + Math.random() * 30},${110 + Math.random() * 25},${70 + Math.random() * 20},0.6)` : tone < 0.8 ? `rgba(${120 + Math.random() * 30},${118 + Math.random() * 25},${110 + Math.random() * 20},0.55)` : `rgba(${55 + Math.random() * 20},${80 + Math.random() * 20},${45 + Math.random() * 15},0.7)`
      g.fillRect(Math.random() * 1024, Math.random() * 1024, 8 + Math.random() * 40, 8 + Math.random() * 40)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(30, 30)
    tex.colorSpace = THREE.SRGBColorSpace
    // Holes where the campus patches are, so valleys below the plain show.
    const S = 30000
    const shape = new THREE.Shape([new THREE.Vector2(-S, -S), new THREE.Vector2(S, -S), new THREE.Vector2(S, S), new THREE.Vector2(-S, S)])
    for (const key of KEYS) {
      const r = -WORLD[key].terrain.x0 - 2
      const { x, z } = this.offsets[key]
      shape.holes.push(new THREE.Path([new THREE.Vector2(x - r, -(z - r)), new THREE.Vector2(x - r, -(z + r)), new THREE.Vector2(x + r, -(z + r)), new THREE.Vector2(x + r, -(z - r))]))
    }
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(-Math.PI / 2)
    // World-space UVs so the farmland texture tiles evenly.
    const uv = geo.attributes.uv
    const pos = geo.attributes.position
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 2000, pos.getZ(i) / 2000)
    tex.repeat.set(1, 1)
    const plain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }))
    plain.position.y = -0.3
    plain.receiveShadow = true
    this.scene.add(plain)
  }

  // Ground texture painted from OSM land areas and streets; relief from DEM.
  #buildGround(key) {
    const T = WORLD[key].terrain
    const off = this.offsets[key]
    const W = (T.w - 1) * T.step
    const CW = MOBILE ? 2048 : 4096
    const cv = document.createElement('canvas')
    cv.width = cv.height = CW
    const ctx = cv.getContext('2d')
    const sx = CW / W
    const P = (x, z) => [(x - T.x0) * sx, (z - T.z0) * sx]
    ctx.fillStyle = '#7b7b78'
    ctx.fillRect(0, 0, CW, CW)
    for (let i = 0; i < CW * CW * 0.003; i++) {
      const v = 120 + Math.random() * 40
      ctx.fillStyle = `rgba(${v},${v - 4},${v - 12},0.35)`
      ctx.fillRect(Math.random() * CW, Math.random() * CW, 2 + Math.random() * 3, 2 + Math.random() * 3)
    }
    // Wooded mountainsides: wherever there are trees, the ground is forest floor.
    const trees = WORLD[key].trees
    ctx.fillStyle = 'rgba(58,82,42,0.85)'
    for (let k = 0; k < trees.length; k += 4) {
      const [x, z] = [trees[k], trees[k + 1]]
      ctx.beginPath()
      ctx.arc(...P(x, z), 7 * sx, 0, 7)
      ctx.fill()
    }
    const FILL = { urban: '#807e79', campus: '#9d978a', dirt: '#9b8a6b', grass: '#6f8a47', wood: '#3f5a2e', parking: '#77736d', pitch: '#4f8a3c', track: '#a8553f', water: '#4c6f86', rock: '#8a857b' }
    for (const a of WORLD[key].areas) {
      ctx.beginPath()
      a.p.forEach(([x, z], i) => (i ? ctx.lineTo(...P(x, z)) : ctx.moveTo(...P(x, z))))
      ctx.closePath()
      ctx.fillStyle = FILL[a.k]
      ctx.fill()
      if (a.k === 'wood' || a.k === 'grass') {
        ctx.save()
        ctx.clip()
        const xs = a.p.map((p) => P(...p)[0])
        const ys = a.p.map((p) => P(...p)[1])
        const [minx, maxx, miny, maxy] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
        const n = Math.min(4000, ((maxx - minx) * (maxy - miny)) / (a.k === 'wood' ? 60 : 140))
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = a.k === 'wood' ? `rgba(${30 + Math.random() * 40},${60 + Math.random() * 40},${25 + Math.random() * 20},0.55)` : `rgba(${100 + Math.random() * 30},${130 + Math.random() * 30},${60 + Math.random() * 20},0.35)`
          const r = (a.k === 'wood' ? 3 : 2) * sx * (1 + Math.random() * 2)
          ctx.beginPath()
          ctx.arc(minx + Math.random() * (maxx - minx), miny + Math.random() * (maxy - miny), r, 0, 7)
          ctx.fill()
        }
        ctx.restore()
      }
      if (a.k === 'pitch') {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'
        ctx.lineWidth = 0.4 * sx
        ctx.stroke()
      }
    }
    // Streets: asphalt with a darker edge; walks in pale paving.
    const WID = { w: 14, r: 7, p: 9, f: 3 }
    const COL = { w: '#4a4a4c', r: '#57575a', p: '#b8ad9c', f: '#c2b7a5' }
    const paths = WORLD[key].paths
    for (const k of ['w', 'r', 'p', 'f']) {
      for (const pass of [0, 1]) {
        for (const s of paths) {
          if (s.k !== k) continue
          ctx.beginPath()
          s.p.forEach(([x, z], i) => (i ? ctx.lineTo(...P(x, z)) : ctx.moveTo(...P(x, z))))
          ctx.strokeStyle = pass ? COL[k] : 'rgba(40,38,34,0.35)'
          ctx.lineWidth = (WID[k] + (pass ? 0 : 1.2)) * sx
          ctx.lineCap = ctx.lineJoin = 'round'
          ctx.stroke()
        }
      }
    }
    ctx.fillStyle = 'rgba(30,26,22,0.35)'
    for (const b of DATA[key].buildings) {
      ctx.beginPath()
      b.p.forEach(([x, z], i) => (i ? ctx.lineTo(...P(x + 1, z + 1)) : ctx.moveTo(...P(x + 1, z + 1))))
      ctx.fill()
    }
    // Feather the patch into the plain.
    const fade = ctx.createRadialGradient(CW / 2, CW / 2, CW * 0.36, CW / 2, CW / 2, CW * 0.52)
    fade.addColorStop(0, 'rgba(109,117,96,0)')
    fade.addColorStop(1, 'rgba(109,117,96,1)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, CW, CW)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    const seg = MOBILE ? 2 : 1
    const geo = new THREE.PlaneGeometry(W, W, Math.round(W / (10 * seg)), Math.round(W / (10 * seg)))
    geo.rotateX(-Math.PI / 2)
    geo.translate(off.x, 0, off.z)
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }))
    ground.receiveShadow = true
    this.scene.add(ground)
    ;(this.grounds ??= {})[key] = ground
  }

  async #loadTerrain() {
    await Promise.all(
      KEYS.map(async (key) => {
        const T = WORLD[key].terrain
        const img = new Image()
        img.src = `/terrain-${key}.png`
        await img.decode()
        const c = document.createElement('canvas')
        c.width = T.w
        c.height = T.h
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        const px = ctx.getImageData(0, 0, T.w, T.h).data
        const h = new Float32Array(T.w * T.h)
        for (let i = 0; i < h.length; i++) h[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 100 + T.hmin
        this.heights[key] = h
      }),
    )
    for (const key of KEYS) {
      const pos = this.grounds[key].geometry.attributes.position
      for (let i = 0; i < pos.count; i++) pos.setY(i, this.groundAt(pos.getX(i), pos.getZ(i)) - 0.3)
      pos.needsUpdate = true
      this.grounds[key].geometry.computeVertexNormals()
    }
    // Everything placed on the ground follows the relief.
    for (const key of KEYS) this.#placeTrees(key)
    for (const m of this.onGround) m.position.y = this.groundAt(m.position.x, m.position.z)
    this.#buildRoute()
    this.#buildStops()
    this.ready = true
  }

  #buildCampus(key) {
    const data = DATA[key]
    const W = WORLD[key]
    const off = this.offsets[key]
    // Global index of this campus's first stop (Seoul, 2 road stops, Yongin).
    const first = key === 'seoul' ? 0 : DATA.seoul.stops.length + 2
    const stopOf = new Map(data.stops.map((s, i) => [s.b, first + i]).filter(([b]) => b !== null))
    const walls = []
    this.onGround ??= []
    data.buildings.forEach((b, i) => {
      const base = W.bases[i]
      const s = STYLE[W.styles[i]] ?? 0
      const seed = ((i * 0.6180339) % 1 + 1) % 1
      const shape = new THREE.Shape(b.p.map(([x, z]) => new THREE.Vector2(x + off.x, -(z + off.z))))
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h + 1, bevelEnabled: false })
      geo.rotateX(-Math.PI / 2)
      geo.translate(0, base - 1, 0)
      const n = geo.attributes.position.count
      const a = new Float32Array(n * 4)
      for (let k = 0; k < n; k++) a.set([s, seed, base, base + b.h], k * 4)
      geo.setAttribute('aB', new THREE.BufferAttribute(a, 4))
      geo.setAttribute('aStop', new THREE.BufferAttribute(new Float32Array(n).fill(stopOf.get(i) ?? -1), 1))
      walls.push(geo)
      if (stopOf.has(i)) {
        // A gold outline, lit while the tour stands at this building.
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0 }))
        this.scene.add(edges)
        this.stopEdges.push({ index: stopOf.get(i), edges })
      }
    })
    const mesh = new THREE.Mesh(mergeGeometries(walls), buildingMaterial())
    mesh.castShadow = mesh.receiveShadow = true
    this.scene.add(mesh)

    // Places that aren't buildings (정문, 백마상) get a slim beam of light.
    data.stops.forEach((s) => {
      if (s.b !== null) return
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 1.8, 36, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      beam.geometry.translate(0, 18, 0)
      beam.position.set(s.at[0] + off.x, 0, s.at[1] + off.z)
      this.scene.add(beam)
      this.onGround.push(beam)
    })
    this.#buildTreeMesh(key)
  }

  #buildTreeMesh(key) {
    const trunk = new THREE.CylinderGeometry(0.3, 0.45, 4, 5)
    trunk.translate(0, 2, 0)
    const crown = new THREE.IcosahedronGeometry(3.4, 0)
    crown.scale(1, 1.15, 1)
    crown.translate(0, 6.4, 0)
    const crown2 = new THREE.IcosahedronGeometry(2.4, 0)
    crown2.translate(1.2, 8.3, 0.6)
    const parts = [trunk, crown, crown2].map((g, k) => {
      g = g.index ? g.toNonIndexed() : g
      g.deleteAttribute('uv')
      const c = new Float32Array(g.attributes.position.count * 3)
      const col = k === 0 ? [0.28, 0.2, 0.14] : [1, 1, 1]
      for (let i = 0; i < c.length; i += 3) c.set(col, i)
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
      return g
    })
    const pick = MOBILE ? 2 : 1
    const n = Math.floor(WORLD[key].trees.length / 4 / pick)
    const mesh = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }), n)
    mesh.userData.pick = pick
    mesh.castShadow = !MOBILE
    mesh.frustumCulled = false
    ;(this.treeMeshes ??= {})[key] = mesh
    this.#placeTrees(key)
    this.scene.add(mesh)
  }

  #placeTrees(key) {
    const mesh = this.treeMeshes[key]
    const trees = WORLD[key].trees
    const off = this.offsets[key]
    const pick = mesh.userData.pick
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const c = new THREE.Color()
    for (let i = 0; i < mesh.count; i++) {
      const [x, z, y, s] = trees.slice(i * pick * 4, i * pick * 4 + 4)
      const wx = x + off.x
      const wz = z + off.z
      q.setFromEuler(e.set(0, (i * 2.399) % 6.28, 0))
      m.compose(new THREE.Vector3(wx, (this.heights[key] ? this.groundAt(wx, wz) : y) - 0.3, wz), q, new THREE.Vector3(s, s * (0.9 + ((i * 0.37) % 0.3)), s))
      mesh.setMatrixAt(i, m)
      c.setHSL(0.22 + ((i * 0.131) % 0.1), 0.5, 0.17 + ((i * 0.071) % 0.09))
      mesh.setColorAt(i, c)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  #buildRoute() {
    // The expressway between the campuses (rebuilt once the relief is known).
    if (this.roadGroup) this.scene.remove(this.roadGroup)
    this.roadGroup = new THREE.Group()
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
    this.route.points.forEach((p) => (p.y = this.groundAt(p.x, p.z) + 0.6))
    const road = new THREE.Mesh(new THREE.TubeGeometry(this.route, 600, 6, 4, false), new THREE.MeshStandardMaterial({ color: '#3e3f42', roughness: 0.9 }))
    road.scale.y = 0.15
    road.position.y = 0.4
    road.receiveShadow = true
    this.roadGroup.add(road)

    // Traffic: headlights one way, tail lights the other.
    const n = 700
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    this.traffic = Array.from({ length: n }, (_, i) => {
      const dir = i % 2 ? 1 : -1
      col.set(dir > 0 ? [1.6, 0.25, 0.15] : [1.4, 1.35, 1.2], i * 3)
      return { t: Math.random(), speed: (0.004 + Math.random() * 0.004) * dir, lane: dir * (1.5 + Math.random() * 2) }
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.trafficPoints = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.6, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.roadGroup.add(this.trafficPoints)

    // The Han River crossing the route.
    const river = new THREE.Mesh(new THREE.PlaneGeometry(9000, 110), new THREE.MeshStandardMaterial({ color: '#46647c', roughness: 0.15, metalness: 0.2 }))
    river.rotation.x = -Math.PI / 2
    river.position.set(this.route.getPointAt(0.3).x, -0.3, this.riverZ)
    this.roadGroup.add(river)
    this.scene.add(this.roadGroup)
  }

  #stopPoint(key, i) {
    const s = DATA[key].stops[i]
    const p = new THREE.Vector3(s.at[0], 0, s.at[1]).add(this.offsets[key])
    return p.setY(this.groundAt(p.x, p.z))
  }

  // Route stops with a world-space focus point and a camera pose for each.
  #buildStops() {
    const riverT = this.#routeTAtZ(this.riverZ)
    const stops = []
    const campusStops = (key) =>
      DATA[key].stops.map((s, i) => {
        const b = s.b === null ? null : DATA[key].buildings[s.b]
        const gy = this.#stopPoint(key, i).y
        const top = this.#stopPoint(key, i).setY(gy + (b ? b.h : 26) + 10)
        if (i === 0) {
          // Arriving at the gate: pull back to see the whole campus at once.
          const { center, radius } = this.#campusBounds(key)
          // Narrow (portrait) screens need to back off further to fit the width.
          const r = Math.max(radius, 230) * Math.max(1, 1.2 / this.camera.aspect)
          return { focus: center, eye: this.#clear(center.clone().add(new THREE.Vector3(0, r * 1.15, r * 1.05))), top, overview: key, tour: true }
        }
        const focus = this.#stopPoint(key, i).setY(gy + (b ? b.h * 0.6 : 4))
        const lift = b ? b.h : 10
        return { focus, eye: this.#clear(focus.clone().add(new THREE.Vector3(45, lift + 150, 120))), top, tour: s.famous }
      })
    stops.push(...campusStops('seoul'))
    for (const t of [riverT, 0.86]) {
      const focus = this.route.getPointAt(t)
      stops.push({ focus, eye: focus.clone().add(new THREE.Vector3(160, 300, 320)), top: focus.clone().setY(focus.y + 30), tour: true })
    }
    stops.push(...campusStops('yongin'))
    this.stops = stops
    // Scrolling only passes the famous stops; the directory can fly to any stop.
    this.tour = stops.flatMap((s, i) => (s.tour ? [i] : []))
    this.eyeCurve = new THREE.CatmullRomCurve3(this.tour.map((i) => stops[i].eye), false, 'centripetal')
    this.focusCurve = new THREE.CatmullRomCurve3(this.tour.map((i) => stops[i].focus), false, 'centripetal')
  }

  // Centre and radius of a campus's official buildings, in world space.
  #campusBounds(key) {
    const pts = DATA[key].buildings.filter((b) => b.c).flatMap((b) => b.p)
    const xs = pts.map((p) => p[0])
    const zs = pts.map((p) => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2
    const center = new THREE.Vector3(cx, 0, cz).add(this.offsets[key])
    return { center: center.setY(this.groundAt(center.x, center.z)), radius }
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
            const base = WORLD[key].bases[DATA[key].buildings.indexOf(b)]
            return { key, name: b.n, pos: new THREE.Vector3(cx, base + b.h + 4, cz).add(this.offsets[key]) }
          }),
      )
    }
    return this._tags
  }

  // Which campus overview (if any) the camera is at, and how fully (0..1).
  overview() {
    if (this.exploreTarget !== null) {
      const s = this.stops[this.exploreTarget]
      return s.overview ? { key: s.overview, weight: 1 } : null
    }
    const t = (this.smooth ?? 0) * (this.tour.length - 1)
    for (const [k, i] of this.tour.entries()) {
      const s = this.stops[i]
      if (s.overview) {
        const w = Math.max(0, 1 - Math.abs(t - k) * 2)
        if (w > 0) return { key: s.overview, weight: w }
      }
    }
    return null
  }

  // Fly to any stop (from the building directory); scrolling resumes the tour.
  flyTo(i) {
    this.exploreTarget = i
  }

  exitExplore() {
    this.exploreTarget = null
  }

  // The stop whose sign should show, and how settled the camera is on it (0..1).
  activeStop() {
    if (this.exploreTarget !== null) {
      return { index: this.exploreTarget, weight: Math.max(0, 1 - this.camEye.distanceTo(this.stops[this.exploreTarget].eye) / 60) }
    }
    const t = (this.smooth ?? 0) * (this.tour.length - 1)
    const k = Math.round(t)
    return { index: this.tour[k], weight: Math.max(0, 1 - Math.abs(t - k) * 1.4) }
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

  // Keep a camera pose well above the ground around it.
  #clear(eye) {
    let g = -Infinity
    for (let dx = -60; dx <= 60; dx += 30) for (let dz = -60; dz <= 60; dz += 30) g = Math.max(g, this.groundAt(eye.x + dx, eye.z + dz))
    eye.y = Math.max(eye.y, g + 70)
    return eye
  }

  resize() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.fov = w / h < 0.8 ? 68 : 50
    this.camera.updateProjectionMatrix()
    // Overview framing depends on the aspect ratio.
    if (this.stops) this.#buildStops()
  }

  // Scroll position in "stops": dwells on each stop, travels in between.
  stopPosition() {
    const n = this.tour.length
    const t = this.progress * (n - 1)
    const turn = Math.min(1, Math.max(0, (t - Math.floor(t) - 0.25) / 0.5))
    return Math.min(n - 1, Math.floor(t) + turn * turn * (3 - 2 * turn))
  }

  // Screen anchor for stop i's label, or null when off screen / behind.
  labelScreen(i) {
    return this.screen(this.stops[i].top)
  }

  render(time, dt) {
    this.time += dt
    const u = this.stopPosition() / (this.tour.length - 1)
    this.smooth = this.smooth === undefined ? u : this.smooth + (u - this.smooth) * Math.min(1, dt * 3)
    const explore = this.exploreTarget !== null ? this.stops[this.exploreTarget] : null
    const eye = explore ? explore.eye : this.eyeCurve.getPoint(this.smooth)
    const focus = explore ? explore.focus : this.focusCurve.getPoint(this.smooth)
    // Ease toward the pose so directory jumps and returns to the tour glide.
    if (!this.camEye) (this.camEye = eye.clone()), (this.camFocus = focus.clone())
    const k = Math.min(1, dt * (explore ? 2.5 : 8))
    this.camEye.lerp(eye, k)
    this.camFocus.lerp(focus, k)
    this.camera.position.copy(this.camEye).add(new THREE.Vector3(this.mouse.x * 12, this.mouse.y * 8, 0))
    this.camera.lookAt(this.camFocus)
    this.current = this.activeStop().index

    // Golden hour over Seoul, dusk by the time the flight reaches Yongin.
    const night = THREE.MathUtils.smoothstep(this.smooth, 0.35, 0.8) * 0.75
    if (Math.abs(night - NIGHT.value) > 0.002) this.#setNight(night)
    // Sun and its shadow box follow what we look at.
    this.sun.target.position.copy(this.camFocus)
    this.sun.position.copy(this.camFocus).addScaledVector(this.lightDir, 1400)

    CURRENT.value = this.current
    PULSE.value = 0.7 + 0.3 * Math.sin(this.time * 3)
    for (const se of this.stopEdges) {
      const target = se.index === this.current ? 0.55 + 0.35 * Math.sin(this.time * 3) : 0
      se.edges.material.opacity += (target - se.edges.material.opacity) * Math.min(1, dt * 4)
    }

    const pos = this.trafficPoints.geometry.attributes.position
    const p = new THREE.Vector3()
    const tan = new THREE.Vector3()
    this.traffic.forEach((c, i) => {
      c.t = (c.t + c.speed * dt * 6 + 1) % 1
      this.route.getPointAt(c.t, p)
      this.route.getTangentAt(c.t, tan)
      pos.setXYZ(i, p.x - tan.z * c.lane, p.y + 1.2, p.z + tan.x * c.lane)
    })
    pos.needsUpdate = true
    this.trafficPoints.material.opacity = 0.35 + 0.65 * NIGHT.value

    this.renderer.render(this.scene, this.camera)
  }
}
