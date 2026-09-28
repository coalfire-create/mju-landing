// Minimal WebGL2 runner for a full-screen fragment shader.
// Every shader gets uRes, uTime, uMouse (0..1, smoothed), uHover and uProgress,
// plus any extra float/vec uniforms passed in `uniforms`.

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`

const HEADER = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uHover;
uniform float uProgress;
out vec4 fragColor;
`

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) + '\n' + src)
  }
  return s
}

export class ShaderCanvas {
  constructor(canvas, frag, { uniforms = {}, maxDpr = 1.5, idleMouse = null } = {}) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
    const gl = this.gl
    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, HEADER + frag))
    gl.linkProgram(prog)
    gl.useProgram(prog)
    this.prog = prog

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    this.uniforms = { uProgress: 0, ...uniforms }
    this.locs = {}
    for (const name of ['uRes', 'uTime', 'uMouse', 'uHover', ...Object.keys(this.uniforms)]) {
      this.locs[name] = gl.getUniformLocation(prog, name)
    }

    this.maxDpr = maxDpr
    this.idleMouse = idleMouse
    this.mouse = { x: 0.5, y: 0.5 }
    this.target = { x: 0.5, y: 0.5 }
    this.hover = 0
    this.hoverTarget = 0
    this.visible = false

    this.client = null
    const onMove = (e) => {
      this.client = { x: e.clientX, y: e.clientY }
      this.hoverTarget = e.pointerType === 'mouse' ? 1 : 0
    }
    window.addEventListener('pointermove', onMove)
    document.addEventListener('pointerleave', () => (this.hoverTarget = 0))
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize() {
    // Full-screen fragment shaders are fill-rate bound; phones render at 1x.
    const dpr = Math.min(window.devicePixelRatio, innerWidth < 760 ? 1 : this.maxDpr)
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }

  set(name, value) {
    this.uniforms[name] = value
  }

  render(time, dt) {
    const gl = this.gl
    // Without a hovering mouse (touch, or pointer elsewhere) the pointer drifts on its own.
    if (this.client) {
      const r = this.canvas.getBoundingClientRect()
      this.target.x = (this.client.x - r.left) / r.width
      this.target.y = 1 - (this.client.y - r.top) / r.height
    }
    if (this.idleMouse && this.hoverTarget < 0.5) {
      const p = this.idleMouse(time)
      this.target.x = p[0]
      this.target.y = p[1]
    }
    const k = Math.min(1, dt * 5)
    this.mouse.x += (this.target.x - this.mouse.x) * k
    this.mouse.y += (this.target.y - this.mouse.y) * k
    this.hover += (this.hoverTarget - this.hover) * k

    gl.uniform2f(this.locs.uRes, this.canvas.width, this.canvas.height)
    gl.uniform1f(this.locs.uTime, time)
    gl.uniform2f(this.locs.uMouse, this.mouse.x, this.mouse.y)
    gl.uniform1f(this.locs.uHover, this.hover)
    for (const [name, v] of Object.entries(this.uniforms)) {
      const loc = this.locs[name]
      if (typeof v === 'number') gl.uniform1f(loc, v)
      else if (v.length === 2) gl.uniform2fv(loc, v)
      else gl.uniform3fv(loc, v)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
