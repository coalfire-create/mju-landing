// Fragment shader bodies for ShaderCanvas (the shared header declares
// uRes, uTime, uMouse, uHover, uProgress and fragColor).

const COMMON = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 tonemap(vec3 c){ return 1.0 - exp(-c); }
`

// Hero — a twisting cobalt ribbon seen through vertical fluted-glass louvres.
export const LOUVRE = /* glsl */ `
  ${COMMON}
  vec3 ribbon(vec2 p, vec2 m){
    float t = uTime * 0.35;
    float y = 0.26 * sin(p.x * 1.5 + t) + 0.1 * sin(p.x * 3.2 - t * 1.4) + m.y * 0.35;
    float twist = p.x * 2.1 + t * 1.6 + m.x * 1.8;
    float w = 0.05 + 0.17 * abs(cos(twist));
    float d = abs(p.y - y);
    float core = smoothstep(w, w * 0.2, d);
    float glow = exp(-d * d * 10.0 / (w + 0.04));
    float face = 0.5 + 0.5 * cos(twist);
    vec3 cobalt = vec3(0.08, 0.28, 1.0);
    vec3 ice = vec3(0.75, 0.9, 1.0);
    return cobalt * glow * 1.6 + mix(cobalt * 1.4, ice * 2.2, face) * core;
  }
  void main(){
    vec2 uv = gl_FragCoord.xy / uRes;
    float aspect = uRes.x / uRes.y;
    float cols = max(7.0, floor(uRes.x / 120.0));
    float cx = uv.x * cols;
    float f = fract(cx) - 0.5;

    // Each flute shows a mirrored, squeezed slice of the scene behind it.
    vec2 suv = uv;
    suv.x = (floor(cx) + 0.5 - f * 0.7) / cols;
    suv.y += f * f * 0.12 - 0.02;
    vec2 p = (suv - 0.5) * vec2(aspect, 1.0);
    vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);

    vec3 bg = mix(vec3(0.02, 0.05, 0.28), vec3(0.01, 0.02, 0.1), uv.y);
    vec3 col = bg + ribbon(p, m);

    // Flute shading: rounded body, bright rim, dark seam.
    float body = 1.0 - pow(abs(f) * 2.0, 2.0);
    col *= 0.62 + 0.5 * body;
    col += vec3(0.45, 0.6, 1.0) * pow(abs(f) * 2.0, 10.0) * 0.35;
    col *= smoothstep(0.5, 0.47, abs(f)) * 0.3 + 0.7;

    col *= 1.0 - 0.45 * length(uv - 0.5);
    fragColor = vec4(pow(tonemap(col * 1.2), vec3(0.9)), 1.0);
  }
`

// Name — a bright flowing field quantized into tiles; the pointer is a lens
// that resolves tiles into finer detail the closer they are.
export const MOSAIC = /* glsl */ `
  ${COMMON}
  vec3 field(vec2 p){
    float t = uTime * 0.18;
    vec2 q = p + 0.35 * vec2(sin(p.y * 2.1 + t * 2.0), cos(p.x * 1.6 - t * 1.5));
    float v = sin(q.x * 2.6 + sin(q.y * 2.2 + t * 3.0) * 1.6 + t * 4.0);
    float b = pow(0.5 + 0.5 * v, 2.5);
    float g = pow(0.5 + 0.5 * sin(q.y * 3.3 - q.x * 1.2 + t * 5.0), 6.0);
    vec3 paper = vec3(0.95, 0.97, 1.0);
    vec3 sky = vec3(0.55, 0.8, 1.0);
    vec3 cobalt = vec3(0.12, 0.3, 0.95);
    vec3 sun = vec3(1.0, 0.82, 0.35);
    vec3 c = mix(paper, sky, smoothstep(0.0, 0.5, b));
    c = mix(c, cobalt, smoothstep(0.55, 1.0, b));
    return mix(c, sun, g * 0.8);
  }
  void main(){
    vec2 px = gl_FragCoord.xy;
    float aspect = uRes.x / uRes.y;
    float unit = min(uRes.x, uRes.y);
    float d = length(px - uMouse * uRes) / unit;
    float lensR = 0.3;

    // Tile size steps down by powers of two toward the lens centre.
    float lv = smoothstep(0.0, lensR * 1.6, d);
    float size = exp2(floor(mix(0.0, 6.0, lv))) * (unit / 900.0);
    size = max(size, 1.0);
    vec2 cell = (floor(px / size) + 0.5) * size;
    vec3 c = field((cell / uRes - 0.5) * vec2(aspect, 1.0));

    vec2 g = fract(px / size);
    float gap = step(0.07, g.x) * step(0.07, g.y);
    c = mix(c, c * 0.86, (1.0 - gap) * step(6.0, size));

    float ring = smoothstep(0.004, 0.0, abs(d - lensR)) * 0.5;
    c = mix(c, vec3(0.1, 0.2, 0.8), ring);
    fragColor = vec4(c, 1.0);
  }
`

// Values — dozens of twisted light wires drifting on a slow sine wave,
// tinted by a three-colour palette that changes per value.
export const WAVES = /* glsl */ `
  ${COMMON}
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  void main(){
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    vec2 m = (uMouse - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float px = 1.0 / uRes.y;
    vec3 col = vec3(0.0);
    const int N = 56;
    for (int i = 0; i < N; i++){
      float fi = float(i) / float(N - 1);
      float spread = 0.55 + 0.45 * cos(p.x * 1.1 + uTime * 0.2);
      float y = (fi - 0.5) * 0.95 * spread
              + 0.2 * sin(p.x * 1.3 + uTime * 0.45 + fi * 2.6)
              + 0.06 * sin(p.x * 3.4 - uTime * 0.8 + fi * 9.0);
      y += 0.18 * exp(-dot(p - m, p - m) * 6.0) * uHover * sign(fi - 0.5);
      float tw = 0.5 + 0.5 * sin(p.x * 2.4 + fi * 7.0 + uTime * 1.1);
      float d = abs(p.y - y);
      float w = px * (0.8 + 2.2 * tw);
      float a = smoothstep(w + px, 0.0, d) + exp(-d * 120.0) * 0.12;
      vec3 pc = fi < 0.5 ? mix(uC1, uC2, fi * 2.0) : mix(uC2, uC3, fi * 2.0 - 1.0);
      col += pc * a * (0.35 + 0.9 * tw);
    }
    vec3 bg = mix(vec3(0.015, 0.01, 0.04), uC2 * 0.08, 1.0 - length(uv - 0.5));
    fragColor = vec4(bg + tonemap(col * 1.3), 1.0);
  }
`

// Finale — dawn light shafts fanning down from above the frame; the pointer
// is an aperture that opens the rays on its bearing.
export const RAYS = /* glsl */ `
  ${COMMON}
  void main(){
    vec2 uv = gl_FragCoord.xy / uRes;
    float aspect = uRes.x / uRes.y;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    vec2 o = vec2(0.0, 0.85);
    vec2 d = p - o;
    float ang = atan(d.x, -d.y);
    vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0) - o;
    float am = atan(m.x, -m.y);

    float r = 0.0;
    r += pow(0.5 + 0.5 * sin(ang * 23.0 + uTime * 0.3), 6.0);
    r += pow(0.5 + 0.5 * sin(ang * 41.0 - uTime * 0.5 + 1.7), 10.0) * 0.8;
    r += pow(0.5 + 0.5 * sin(ang * 67.0 + uTime * 0.7 + 4.1), 16.0) * 0.6;
    float open = exp(-pow((ang - am) * 2.6, 2.0));
    float fall = exp(-length(d) * 0.85);
    float beam = r * fall * (0.35 + 1.3 * open) * smoothstep(1.4, 0.0, abs(ang));

    vec3 top = vec3(0.04, 0.12, 0.55);
    vec3 bottom = vec3(0.86, 0.93, 1.0);
    vec3 col = mix(bottom, top, smoothstep(0.05, 1.0, uv.y));
    col += vec3(1.0, 0.95, 0.82) * beam * 0.9;
    col += vec3(1.0, 0.9, 0.7) * exp(-length(d) * 3.0) * 0.6;
    fragColor = vec4(col, 1.0);
  }
`
