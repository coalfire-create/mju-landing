import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { textShape, globeShape, terrainShape, ringShape, snuOfficialEmblemShape } from './shapes.js'

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
  uniform float uGlobeR;
  uniform float uGlobeX;

  varying vec3 vColor;
  varying float vAlpha;

  ${NOISE}

  mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
  mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }

  float terrainH(vec3 p){
    float wz = p.z - uTime * 2.2;
    float h = fbm(vec2(p.x * 0.16, wz * 0.16));
    h = 1.0 - abs(h * 2.0 - 1.0);
    h = h * h;
    float valley = smoothstep(0.5, 7.0, abs(p.x));
    return h * 4.2 * (0.25 + 0.75 * valley);
  }

  vec3 shapePos(float i, float randVal){
    if (i < 0.5) return position;
    // Big Dipper
    if (i < 1.5) {
      // Fix for the massive GPU lag (overdraw): 
      // Do NOT rotate huge coordinates into the Z axis, otherwise they hit the camera and point sizes explode!
      return p1 * 1.2; 
    }
    // Slot 2 is the colleges ring, slot 3 the Gwanak terrain (page order).
    if (i < 2.5) return rotX(0.42) * rotY(uRingRot + uTime * 0.05) * p2;
    if (i < 3.5) return vec3(p3.x, -3.0 + terrainH(p3), p3.z);
    return p4;
  }

  vec3 shapeColor(float i, vec3 p){
    if (i < 0.5) return mix(vec3(0.85, 0.9, 1.0), vec3(0.35, 0.55, 1.0), aRand);
    if (i < 1.5) {
      // Because thousands of particles overlap, additive blending makes them EXTREMELY bright.
      // We must use very low base colors so they don't blow out into a giant white blob.
      vec3 starCore = vec3(0.05, 0.05, 0.05); // Tiny value, adds up to white
      vec3 starAura = mix(vec3(0.01, 0.03, 0.1), vec3(0.05, 0.04, 0.01), aRand);
      
      // We can use aRand > 0.85 as aura.
      return mix(starCore, starAura, step(0.85, aRand));
    }
    if (i < 2.5) return mix(vec3(0.55, 0.45, 1.0), vec3(0.35, 0.8, 1.0), aRand);
    if (i < 3.5) {
      float h = terrainH(p3) / 4.2;
      return mix(vec3(0.12, 0.2, 0.75), vec3(1.0, 0.78, 0.38), smoothstep(0.15, 0.8, h));
    }
    return mix(vec3(1.0, 0.8, 0.42), vec3(1.0, 0.97, 0.9), aRand);
  }

  float shapeAlpha(float i){
    if (i > 2.5 && i < 3.5) {
      return smoothstep(-30.0, -20.0, p3.z) * (1.0 - smoothstep(1.5, 4.0, p3.z));
    }
    return 1.0;
  }

  void main(){
    float m = clamp(uMorph, 0.0, 4.0);
    float i0 = floor(m);
    float i1 = min(i0 + 1.0, 4.0);
    float f = m - i0;
    // Staggered per-particle transition.
    float t = smoothstep(0.0, 1.0, clamp((f - aRand * 0.35) / 0.65, 0.0, 1.0));

    vec3 a = shapePos(i0, aRand);
    vec3 b = shapePos(i1, aRand);
    vec3 pos = mix(a, b, t);

    // Turbulent swirl mid-flight.
    float mid = sin(t * 3.14159);
    vec3 swirl = vec3(
      sin(pos.y * 1.3 + uTime * 1.1 + aRand * 6.28),
      cos(pos.x * 1.1 + uTime * 0.9 + aRand * 3.1),
      sin(pos.z * 1.7 + uTime * 1.3 + aRand * 4.7)
    );
    pos += swirl * mid * 1.6;

    // Subtle stability for the Globe to maintain shape while swirling
    float isGlobe = 1.0 - smoothstep(0.0, 0.7, abs(m - 1.0));
    pos += swirl * mix(0.025, 0.015, isGlobe);

    // Intro: particles collapse in from a wide cloud.
    vec3 scatter = normalize(swirl + 0.001) * (8.0 + aRand * 14.0);
    pos = mix(scatter, pos, smoothstep(aRand * 0.4, aRand * 0.4 + 0.6, uIntro));

    // Pointer repulsion on the z = 0 plane.
    vec2 d = pos.xy - uMouse.xy;
    float dist = length(d);
    float push = exp(-dist * dist * 0.9) * uMouseForce;
    pos.xy += normalize(d + 0.0001) * push * 0.9;
    pos.z += push * 1.2;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    // Size adjustments
    float isGalaxySec = 1.0 - smoothstep(0.0, 0.7, abs(m - 1.0));
    float pointScale = 1.0;
    if (isGalaxySec > 0.5) {
      // Point scale must be small so it doesn't blur into a giant blob
      pointScale = mix(0.4, 0.2, step(0.85, aRand));
    }
    gl_PointSize = uSize * aSize * uPixelRatio * pointScale * (1.0 + push * 0.6) / -mv.z;

    vColor = mix(shapeColor(i0, a), shapeColor(i1, b), t) * (1.0 + push * 0.5);
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
    vec3 base = vec3(0.012, 0.016, 0.05);
    vec3 col = base + uTint * pow(n, 2.6) * 0.28;
    col *= 1.0 - smoothstep(0.35, 1.1, length(p));
    gl_FragColor = vec4(col, 1.0);
  }
`

export class Stage {
  constructor(canvas) {
    const mobile = window.matchMedia('(max-width: 760px)').matches
    this.count = mobile ? 14000 : 26000

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100)
    this.camera.position.set(0, 0, 14)

    this.state = { morph: 0, morphTarget: 0, ringRot: 0, intro: 0, tint: new THREE.Color('#2a3cff') }
    this.tintTarget = new THREE.Color('#2a3cff')
    this.mouse = new THREE.Vector2(0, 0)
    this.mouseWorld = new THREE.Vector3(99, 99, 0)
    this.mouseForce = 0
    this.last = performance.now()
    this.elapsed = 0

    this.#buildBackground()
    this.#buildParticles(mobile)
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

  #buildParticles(mobile) {
    const n = this.count
    const geo = new THREE.BufferGeometry()
    this.globeR = mobile ? 2.1 : 3.1
    this.emblemSize = mobile ? 4.6 : 8.8
    const serif = '900 260px "Noto Serif KR", serif'
    geo.setAttribute('position', new THREE.BufferAttribute(textShape(n, 'SNU', { width: mobile ? 4.6 : 10, font: serif, y: mobile ? 1.8 : 1.4 }), 3))
    geo.setAttribute('p1', new THREE.BufferAttribute(globeShape(n, this.globeR), 3))
    geo.setAttribute('p2', new THREE.BufferAttribute(ringShape(n), 3))
    geo.setAttribute('p3', new THREE.BufferAttribute(terrainShape(n), 3))
    geo.setAttribute('p4', new THREE.BufferAttribute(textShape(n, '80', { width: mobile ? 3.8 : 5.2, font: serif, depth: 0.6, y: 2.4 }), 3))

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
      uSize: { value: mobile ? 20 : 26 },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uRingRot: { value: 0 },
      uIntro: { value: 0 },
      uMouse: { value: this.mouseWorld },
      uMouseForce: { value: 0 },
      uGlobeR: { value: this.globeR },
      uGlobeX: { value: mobile ? 0 : 3.4 },
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

  update() {
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

    // Gentle camera parallax.
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
