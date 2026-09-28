import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// Night highway from Seoul (camera) to Yongin (horizon): instanced head/tail
// light trails, lane dashes and roadside posts all bend through one curve.
const LEN = 260
const NEAR = 4
const BEND = /* glsl */ `float roadX(float z){ return 16.0 * (1.0 - cos(z * 0.011)); }`
const roadX = (z) => 16 * (1 - Math.cos(z * 0.011))

const streamVertex = /* glsl */ `
  attribute float aX;
  attribute float aOffset;
  attribute float aSpeed;
  attribute float aLen;
  attribute float aDir;
  attribute vec3 aColor;
  uniform float uTravel;
  uniform float uWidth;
  uniform float uHeight;
  uniform float uVertical;
  varying vec3 vColor;
  varying float vAlpha;
  ${BEND}
  void main(){
    float run = mod(aOffset * ${LEN}.0 + uTravel * aSpeed, ${LEN}.0);
    // aDir = 1 moves away from the camera, -1 comes toward it.
    float zc = aDir > 0.0 ? ${NEAR}.0 - run : ${NEAR}.0 - ${LEN}.0 + run;
    float along = position.y + 0.5;               // 0 = light head, 1 = trail end
    float z = zc + along * aLen * aDir;
    vec3 p;
    if (uVertical > 0.5) {
      p = vec3(roadX(zc) + aX + position.x * uWidth, (position.y + 0.5) * uHeight, zc);
    } else {
      p = vec3(roadX(z) + aX + position.x * uWidth, uHeight, z);
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float fade = smoothstep(${NEAR}.0 - ${LEN}.0, ${NEAR}.0 - ${LEN}.0 + 70.0, p.z) * smoothstep(${NEAR}.0 - 2.0, ${NEAR}.0 - 12.0, p.z);
    vAlpha = fade * (uVertical > 0.5 ? 1.0 : pow(1.0 - along, 1.6)) * mix(0.35, 1.0, smoothstep(-160.0, -20.0, p.z));
    vColor = aColor;
  }
`

const streamFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main(){ gl_FragColor = vec4(vColor * vAlpha, vAlpha); }
`

const skyVertex = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`

const skyFragment = /* glsl */ `
  uniform vec2 uHorizon;
  uniform float uAspect;
  varying vec2 vUv;
  void main(){
    float h = vUv.y - uHorizon.y;
    vec3 sky = mix(vec3(0.05, 0.03, 0.16), vec3(0.01, 0.01, 0.05), smoothstep(0.0, 0.5, h));
    vec3 ground = vec3(0.005, 0.006, 0.02);
    vec3 col = h > 0.0 ? sky : ground;
    vec2 d = (vUv - uHorizon) * vec2(uAspect, 3.0);
    // City glow where the road meets the horizon.
    col += vec3(0.9, 0.35, 0.4) * exp(-abs(h) * 30.0) * 0.18;
    col += vec3(1.0, 0.65, 0.4) * exp(-dot(d, d) * 40.0) * 0.22;
    gl_FragColor = vec4(col, 1.0);
  }
`

function stream({ count, lanes, dir, colors, speed, len, spread = 0 }) {
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = new THREE.PlaneGeometry(1, 1).index
  geo.setAttribute('position', new THREE.PlaneGeometry(1, 1).getAttribute('position'))
  const aX = []
  const aOffset = []
  const aSpeed = []
  const aLen = []
  const aDir = []
  const aColor = []
  for (let i = 0; i < count; i++) {
    const lane = lanes[i % lanes.length]
    const offset = Math.random()
    const s = speed[0] + Math.random() * (speed[1] - speed[0])
    const c = colors[Math.floor(Math.random() * colors.length)]
    const l = len[0] + Math.random() * (len[1] - len[0])
    // Cars carry a pair of lights; other streams are single.
    for (const side of spread ? [-spread, spread] : [0]) {
      aX.push(lane + side)
      aOffset.push(offset)
      aSpeed.push(s)
      aLen.push(l)
      aDir.push(dir)
      aColor.push(...c)
    }
  }
  const n = aX.length
  geo.instanceCount = n
  geo.setAttribute('aX', new THREE.InstancedBufferAttribute(new Float32Array(aX), 1))
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(aOffset), 1))
  geo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(new Float32Array(aSpeed), 1))
  geo.setAttribute('aLen', new THREE.InstancedBufferAttribute(new Float32Array(aLen), 1))
  geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(aDir), 1))
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(aColor), 3))
  return geo
}

export class Highway {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400)
    this.camera.position.set(0.6, 1.5, 6)
    this.travel = 0
    this.boost = 0
    this.mouse = new THREE.Vector2()
    this.uniformsTravel = { value: 0 }

    this.skyUniforms = { uHorizon: { value: new THREE.Vector2(0.5, 0.6) }, uAspect: { value: 1 } }
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms: this.skyUniforms, depthWrite: false, depthTest: false }),
    )
    sky.frustumCulled = false
    sky.renderOrder = -1
    this.scene.add(sky)

    const add = (geo, { width, height, vertical = 0 }) => {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({
          vertexShader: streamVertex,
          fragmentShader: streamFragment,
          uniforms: {
            uTravel: this.uniformsTravel,
            uWidth: { value: width },
            uHeight: { value: height },
            uVertical: { value: vertical },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      )
      mesh.frustumCulled = false
      this.scene.add(mesh)
    }

    const red = [
      [1.6, 0.1, 0.08],
      [1.4, 0.06, 0.16],
    ]
    const white = [
      [1.3, 1.25, 1.1],
      [1.0, 1.15, 1.45],
    ]
    // Our direction (right-hand traffic): tail lights pulling away.
    add(stream({ count: 70, lanes: [1.0, 2.8], dir: 1, colors: red, speed: [5, 8], len: [3, 7], spread: 0.36 }), { width: 0.14, height: 0.35 })
    // Oncoming: head lights streaming toward us.
    add(stream({ count: 70, lanes: [-1.0, -2.8], dir: -1, colors: white, speed: [9, 13], len: [4, 9], spread: 0.38 }), { width: 0.16, height: 0.4 })
    // Lane dashes and road edges drift toward us.
    const dash = [[0.5, 0.52, 0.6]]
    add(stream({ count: 44, lanes: [0], dir: -1, colors: [[0.9, 0.75, 0.3]], speed: [7, 7], len: [3, 3] }), { width: 0.08, height: 0.01 })
    add(stream({ count: 88, lanes: [1.9, -1.9], dir: -1, colors: dash, speed: [7, 7], len: [2, 2] }), { width: 0.06, height: 0.01 })
    add(stream({ count: 260, lanes: [3.9, -3.9], dir: -1, colors: [[0.25, 0.3, 0.45]], speed: [7, 7], len: [1.2, 1.2] }), { width: 0.08, height: 0.01 })
    // Roadside posts in Myongji sky blue.
    add(stream({ count: 90, lanes: [5.4, -5.4], dir: -1, colors: [[0.4, 1.2, 2.2]], speed: [7, 7], len: [0, 0] }), { width: 0.07, height: 1.1, vertical: 1 })

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.35)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

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
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.skyUniforms.uAspect.value = w / h
  }

  // Screen position (px within the canvas) of the far end of the road.
  horizonPoint() {
    const z = NEAR - LEN + 40
    const v = new THREE.Vector3(roadX(z), 0, z).project(this.camera)
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight, uv: [v.x * 0.5 + 0.5, v.y * 0.5 + 0.5] }
  }

  render(time, dt) {
    this.travel += dt * (1 + this.boost)
    this.uniformsTravel.value = this.travel
    const cam = this.camera
    cam.position.x += (0.6 + this.mouse.x * 0.8 - cam.position.x) * dt * 2
    cam.position.y += (1.5 + this.mouse.y * 0.4 - cam.position.y) * dt * 2
    cam.lookAt(roadX(-40) * 0.6, 0.7, -40)
    const hp = this.horizonPoint()
    this.skyUniforms.uHorizon.value.set(hp.uv[0], hp.uv[1])
    this.composer.render()
  }
}
