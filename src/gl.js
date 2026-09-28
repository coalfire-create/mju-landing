import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { textShape, shellShape, fibreShape, silkShape, ringShape } from './shapes.js'

// Shape indices, in scroll order.
export const SHAPE = { MJU: 0, KNOT: 1, CAMPUS: 2, SILK: 3, RING: 4, MYONGJI: 5 }
const LAST = 5

const NOISE = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
`

const particleVertex = /* glsl */ `
  attribute vec3 p1;
  attribute vec3 p2;
  attribute vec3 p3;
  attribute vec3 p4;
  attribute vec3 p5;
  attribute float aRand;
  attribute float aSize;

  uniform float uTime;
  uniform float uMorph;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uRingRot;
  uniform float uIntro;
  uniform vec3 uMouse;
  uniform float uMouseForce;
  uniform vec3 uKnotPos;
  uniform float uSpan;

  varying vec3 vColor;
  varying float vAlpha;

  mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
  mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }

  float silkH(vec3 p){
    float t = uTime;
    return 0.7 * sin(p.x * 0.45 + t * 0.9)
         + 0.45 * sin(p.z * 0.6 - t * 1.2 + p.x * 0.15)
         + 0.3 * sin((p.x + p.z) * 0.9 - t * 0.7);
  }

  // 0 at the Seoul cluster, 1 at the Yongin cluster.
  float fibreU(){ return clamp((p2.x / uSpan) * 0.5 + 0.5, 0.0, 1.0); }

  float fibrePulse(){
    float u = fibreU();
    float head = fract(uTime * 0.22);
    float head2 = fract(uTime * 0.22 + 0.5);
    return smoothstep(0.07, 0.0, abs(u - head)) + smoothstep(0.07, 0.0, abs(u - head2));
  }

  vec3 shapePos(float i){
    if (i < 0.5) return position;
    if (i < 1.5) return rotY(uTime * 0.08) * rotX(0.3) * p1 + uKnotPos;
    if (i < 2.5) return rotX(0.18) * p2;
    if (i < 3.5) return vec3(p3.x, -1.9 + silkH(p3), p3.z);
    if (i < 4.5) return rotX(0.42) * rotY(uRingRot + uTime * 0.05) * p4;
    return p5;
  }

  vec3 shapeColor(float i){
    if (i < 0.5) return mix(vec3(0.95, 0.97, 1.0), vec3(0.45, 0.8, 1.0), aRand);
    if (i < 1.5) return mix(vec3(0.3, 0.5, 1.0), vec3(0.8, 0.9, 1.0), aRand) * 0.7;
    if (i < 2.5) {
      vec3 seoul = vec3(0.35, 0.75, 1.0);
      vec3 yongin = vec3(0.45, 1.0, 0.8);
      return mix(seoul, yongin, fibreU()) * (1.0 + fibrePulse() * 2.2);
    }
    if (i < 3.5) {
      float h = silkH(p3) / 1.45 * 0.5 + 0.5;
      vec3 c = mix(vec3(0.35, 0.25, 0.95), vec3(1.0, 0.5, 0.78), smoothstep(0.2, 0.75, h));
      return mix(c, vec3(1.0, 0.95, 1.0), smoothstep(0.82, 1.0, h));
    }
    if (i < 4.5) return mix(vec3(0.35, 0.5, 1.0), vec3(0.4, 0.9, 1.0), aRand);
    return mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 1.0, 1.0), aRand);
  }

  float shapeAlpha(float i){
    if (i > 2.5 && i < 3.5) {
      return smoothstep(-18.0, -10.0, p3.z) * (1.0 - smoothstep(1.5, 4.0, p3.z));
    }
    return 1.0;
  }

  void main(){
    float m = clamp(uMorph, 0.0, ${LAST}.0);
    float i0 = floor(m);
    float i1 = min(i0 + 1.0, ${LAST}.0);
    float f = m - i0;
    // Staggered per-particle transition.
    float t = smoothstep(0.0, 1.0, clamp((f - aRand * 0.35) / 0.65, 0.0, 1.0));

    vec3 a = shapePos(i0);
    vec3 b = shapePos(i1);
    vec3 pos = mix(a, b, t);

    // Turbulent swirl mid-flight.
    float mid = sin(t * 3.14159);
    vec3 swirl = vec3(
      sin(pos.y * 1.3 + uTime * 1.1 + aRand * 6.28),
      cos(pos.x * 1.1 + uTime * 0.9 + aRand * 3.1),
      sin(pos.z * 1.7 + uTime * 1.3 + aRand * 4.7)
    );
    pos += swirl * mid * 1.6;
    pos += swirl * 0.025;

    // Intro: particles collapse in from a wide cloud.
    vec3 scatter = normalize(swirl + 0.001) * (8.0 + aRand * 14.0);
    pos = mix(scatter, pos, smoothstep(aRand * 0.4, aRand * 0.4 + 0.6, uIntro));

    // Pointer repulsion on the z = 0 plane.
    vec2 d = pos.xy - uMouse.xy;
    float push = exp(-dot(d, d) * 0.9) * uMouseForce;
    pos.xy += normalize(d + 0.0001) * push * 0.9;
    pos.z += push * 1.2;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aSize * uPixelRatio * (1.0 + push * 0.6) / -mv.z;

    vColor = mix(shapeColor(i0), shapeColor(i1), t) * (1.0 + push * 0.5);
    vAlpha = mix(shapeAlpha(i0), shapeAlpha(i1), t) * uIntro;
  }
`

const particleFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a * vAlpha * 0.5);
  }
`

const bgVertex = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`

const bgFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTint;
  uniform vec2 uRes;
  varying vec2 vUv;
  ${NOISE}
  void main(){
    vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    vec2 q = vec2(fbm(p * 1.4 + uTime * 0.03), fbm(p * 1.4 + 5.2 - uTime * 0.04));
    float n = fbm(p * 1.8 + q * 2.2 + uTime * 0.02);
    vec3 base = vec3(0.01, 0.016, 0.045);
    vec3 col = base + uTint * pow(n, 2.6) * 0.28;
    col *= 1.0 - smoothstep(0.35, 1.1, length(p));
    gl_FragColor = vec4(col, 1.0);
  }
`

// Canvas texture of repeating type for the kinetic knot.
function makeTypeTexture(text) {
  const c = document.createElement('canvas')
  c.width = 4096
  c.height = 512
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.font = 'italic 900 330px "Playfair Display", serif'
  let x = 0
  while (x < c.width) {
    ctx.fillText(text, x, c.height / 2 + 20)
    x += ctx.measureText(text).width
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3, 2)
  tex.anisotropy = 8
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Stage {
  constructor(canvas) {
    const mobile = window.matchMedia('(max-width: 760px)').matches
    this.mobile = mobile
    this.count = mobile ? 14000 : 26000
    this.span = mobile ? 1.9 : 4.2
    this.knotPos = new THREE.Vector3(mobile ? 0 : 2.8, mobile ? 1.2 : 0, 0)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100)
    this.camera.position.set(0, 0, 14)

    this.state = { morph: 0, morphTarget: 0, ringRot: 0, intro: 0, tint: new THREE.Color('#1f4bff') }
    this.tintTarget = new THREE.Color('#1f4bff')
    this.mouse = new THREE.Vector2(0, 0)
    this.mouseWorld = new THREE.Vector3(99, 99, 0)
    this.mouseForce = 0
    this.last = performance.now()
    this.elapsed = 0

    this.#buildBackground()
    this.#buildParticles()
    this.#buildKnot()
    this.#buildPost()

    window.addEventListener('resize', () => this.#resize())
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
      this.pointerActive = true
    })
    document.addEventListener('pointerleave', () => (this.pointerActive = false))
  }

  #buildBackground() {
    this.bgUniforms = {
      uTime: { value: 0 },
      uTint: { value: this.state.tint },
      uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    }
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: bgVertex,
        fragmentShader: bgFragment,
        uniforms: this.bgUniforms,
        depthWrite: false,
        depthTest: false,
      }),
    )
    bg.frustumCulled = false
    bg.renderOrder = -1
    this.scene.add(bg)
  }

  #buildParticles() {
    const n = this.count
    const m = this.mobile
    const geo = new THREE.BufferGeometry()
    const latin = '900 260px "Playfair Display", serif'
    const hangul = '900 260px "Noto Serif KR", serif'
    geo.setAttribute('position', new THREE.BufferAttribute(textShape(n, 'MJU', { width: m ? 4.6 : 9, font: latin, y: m ? 2.2 : 2.1 }), 3))
    geo.setAttribute('p1', new THREE.BufferAttribute(shellShape(n, m ? 3 : 4.6), 3))
    geo.setAttribute('p2', new THREE.BufferAttribute(fibreShape(n, this.span), 3))
    geo.setAttribute('p3', new THREE.BufferAttribute(silkShape(n), 3))
    geo.setAttribute('p4', new THREE.BufferAttribute(ringShape(n), 3))
    geo.setAttribute('p5', new THREE.BufferAttribute(textShape(n, '명지', { width: m ? 4.2 : 6.4, font: hangul, depth: 0.6, y: 2.2 }), 3))

    const rnd = new Float32Array(n)
    const size = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      rnd[i] = Math.random()
      size[i] = 0.5 + Math.pow(Math.random(), 3) * 1.8
    }
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))

    this.uniforms = {
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uSize: { value: m ? 20 : 26 },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uRingRot: { value: 0 },
      uIntro: { value: 0 },
      uMouse: { value: this.mouseWorld },
      uMouseForce: { value: 0 },
      uKnotPos: { value: this.knotPos },
      uSpan: { value: this.span },
    }

    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: particleVertex,
        fragmentShader: particleFragment,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    this.points.frustumCulled = false
    this.scene.add(this.points)
  }

  // Kinetic type: a torus knot tiled with scrolling text over a dark core
  // that hides the mirrored back faces.
  #buildKnot() {
    const r = this.mobile ? 1.35 : 1.9
    const tube = this.mobile ? 0.42 : 0.56
    this.knot = new THREE.Group()
    this.knot.position.copy(this.knotPos)

    const core = new THREE.Mesh(
      new THREE.TorusKnotGeometry(r, tube * 0.94, 320, 48, 2, 3),
      new THREE.MeshBasicMaterial({ color: '#040817', transparent: true }),
    )
    this.knotTex = makeTypeTexture('MYONGJI UNIVERSITY ✦ 明知 ✦ ')
    const skin = new THREE.Mesh(
      new THREE.TorusKnotGeometry(r, tube, 320, 48, 2, 3),
      new THREE.MeshBasicMaterial({
        map: this.knotTex,
        color: new THREE.Color(0.55, 0.78, 1.0),
        transparent: true,
        depthWrite: false,
      }),
    )
    core.renderOrder = 1
    skin.renderOrder = 2
    this.knotMats = [core.material, skin.material]
    this.knot.add(core, skin)
    this.scene.add(this.knot)
  }

  #buildPost() {
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.7, 0.5, 0.2)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
  }

  #resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.bgUniforms.uRes.value.set(w, h)
  }

  setTint(hex) {
    this.tintTarget.set(hex)
  }

  visibility(shape) {
    return Math.max(0, 1 - Math.abs(this.state.morph - shape) * 1.8)
  }

  // Screen positions of the two campus clusters, for HTML labels.
  campusScreens() {
    const tilt = new THREE.Euler(0.18, 0, 0)
    return [-1, 1].map((side) => {
      const v = new THREE.Vector3(side * this.span, this.mobile ? -1.4 : -1.5, 0).applyEuler(tilt).project(this.camera)
      return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight }
    })
  }

  update(scrollVelocity = 0) {
    const now = performance.now()
    const dt = Math.min((now - this.last) / 1000, 0.05)
    this.last = now
    this.elapsed += dt
    const t = this.elapsed
    const s = this.state

    s.morph += (s.morphTarget - s.morph) * Math.min(1, dt * 3.2)
    s.tint.lerp(this.tintTarget, Math.min(1, dt * 2))

    // Pointer → world position on the z = 0 plane.
    const v = new THREE.Vector3(this.mouse.x, this.mouse.y, 0.5).unproject(this.camera)
    v.sub(this.camera.position).normalize()
    const k = -this.camera.position.z / v.z
    this.mouseWorld.copy(this.camera.position).addScaledVector(v, k)
    const forceTarget = this.pointerActive ? 1.1 : 0
    this.mouseForce += (forceTarget - this.mouseForce) * Math.min(1, dt * 4)

    // Knot: fades and scales in around its section; type speeds up with scroll.
    const kv = this.visibility(SHAPE.KNOT)
    const ke = kv * kv * (3 - 2 * kv)
    this.knot.visible = kv > 0.01
    this.knot.scale.setScalar(0.55 + 0.45 * ke)
    this.knot.rotation.y += dt * 0.25
    this.knot.rotation.x = 0.35 + this.mouse.y * 0.3
    this.knot.rotation.z = this.mouse.x * 0.2
    this.knotMats[0].opacity = ke
    this.knotMats[1].opacity = ke
    this.knotTex.offset.x -= dt * (0.06 + Math.min(Math.abs(scrollVelocity), 60) * 0.004)

    this.camera.position.x += (this.mouse.x * 0.8 - this.camera.position.x) * dt * 2
    this.camera.position.y += (this.mouse.y * 0.5 - this.camera.position.y) * dt * 2
    this.camera.lookAt(0, 0, 0)

    const u = this.uniforms
    u.uTime.value = t
    u.uMorph.value = s.morph
    u.uRingRot.value = s.ringRot
    u.uIntro.value = s.intro
    u.uMouseForce.value = this.mouseForce
    this.bgUniforms.uTime.value = t

    this.composer.render()
  }
}
