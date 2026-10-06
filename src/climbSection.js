import * as THREE from 'three'
import { Climb, EXAGGERATE } from './climb.js'
import DATA from './data/climb.json'

// The Gwanak-san climb as a pinned section of the SNU site. Scrolling through
// #climb walks from the real 정문 to the summit; the section opens white so it
// continues the light flood at the end of the starlight gate above it.

const OFFICIAL_SUMMIT = 632 // 관악산, official height (the 10 m DEM smooths the rock to ~618 m)
const clamp01 = (v) => Math.min(1, Math.max(0, v))

export async function initClimb() {
  const section = document.getElementById('climb')
  const climb = new Climb(document.getElementById('climbCanvas'))
  await climb.load()
  if (import.meta.env.DEV) window.__climb = climb

  // Mobile browsers change innerHeight as the address bar slides; only take a
  // new viewport height when the width changes.
  let viewH = innerHeight
  let viewW = innerWidth
  addEventListener('resize', () => innerWidth !== viewW && ((viewW = innerWidth), (viewH = innerHeight)))

  let visible = false
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(section)

  /* labels: named peaks and campus buildings */
  const tagWrap = document.getElementById('climbTags')
  const makeTag = (html, cls) => {
    const el = document.createElement('span')
    el.className = `cl-tag ${cls}`
    el.innerHTML = html
    tagWrap.appendChild(el)
    return el
  }
  const peaks = DATA.landmarks
    .filter((l) => l.peak)
    .map((l) => ({
      pos: new THREE.Vector3(l.x, climb.groundAt(l.x, l.z) * EXAGGERATE + 25, l.z),
      el: makeTag(`${l.name}<small>${Math.round(l.y)}m</small>`, 'cl-tag--peak'),
    }))
  const buildings = DATA.buildings
    .filter((b) => b.n)
    .map((b) => {
      const cx = b.p.reduce((a, q) => a + q[0], 0) / b.p.length
      const cz = b.p.reduce((a, q) => a + q[1], 0) / b.p.length
      return { pos: new THREE.Vector3(cx, (b.y + b.h) * EXAGGERATE + 8, cz), el: makeTag(b.n, 'cl-tag--bldg') }
    })

  /* HUD and story */
  const altEl = document.getElementById('climbAlt')
  const distEl = document.getElementById('climbDist')
  const gauge = document.getElementById('climbGauge')
  const hud = document.getElementById('climbHud')
  const veil = document.getElementById('climbVeil')
  const footer = section.querySelector('.climb__footer')
  // Map distance, as a hiker would measure it (the 3D curve also counts exaggerated climb).
  const mapLength = DATA.trail.reduce((a, q, i, all) => (i ? a + Math.hypot(q[0] - all[i - 1][0], q[2] - all[i - 1][2]) : 0), 0)
  document.getElementById('climbTotal').textContent = (mapLength / 1000).toFixed(1)
  const stages = [...section.querySelectorAll('.cl-stage')].map((el) => ({ el, from: +el.dataset.from, to: +el.dataset.to }))
  const summitTrailElev = DATA.trail[DATA.trail.length - 1][1]

  const progress = () => {
    const r = section.getBoundingClientRect()
    return clamp01(-r.top / Math.max(1, r.height - viewH))
  }

  // Whether the pinned climb currently fills the screen (the particle stage
  // behind it can skip rendering then).
  const covering = () => {
    const r = section.getBoundingClientRect()
    return r.top <= 0 && r.bottom >= viewH
  }

  function update(dt) {
    if (!visible) return
    const p = progress()
    climb.progress = p
    climb.render(dt)

    // White at the start (continuing the gate's light), clearing as we set off.
    veil.style.opacity = 1 - clamp01((p - 0.004) / 0.03)
    footer.style.opacity = clamp01((p - 0.95) / 0.03)

    const s = climb.stats()
    const t = s.walked / s.total
    const fix = clamp01((t - 0.95) / 0.05) * (OFFICIAL_SUMMIT - summitTrailElev)
    const alt = Math.round(s.elevation + fix)
    altEl.textContent = alt
    distEl.textContent = ((t * mapLength) / 1000).toFixed(1)
    gauge.style.transform = `scaleY(${alt / OFFICIAL_SUMMIT})`
    hud.style.opacity = clamp01((p - 0.03) / 0.03)

    for (const st of stages) {
      const span = st.to - st.from
      const fade = Math.min(clamp01((p - st.from) / (span * 0.2)), clamp01((st.to - p) / (span * 0.2)))
      st.el.style.opacity = fade
      st.el.style.visibility = fade > 0.01 ? 'visible' : 'hidden'
      st.el.style.translate = `0 ${(1 - fade) * 24}px`
    }

    // Labels already on screen keep their spot, must be clear for 0.2 s
    // before appearing, and fade instead of popping (no flicker).
    const W = section.clientWidth
    const H = viewH
    const placed = []
    const shown = new Set()
    const place = (item, want, opacity) => {
      const sc = want && climb.screen(item.pos)
      let ok = !!sc && sc.x > 0 && sc.x < W && sc.y > 120 && sc.y < H
      if (ok) {
        const w = item.w ?? (item.w = item.el.offsetWidth)
        const h = item.h ?? (item.h = item.el.offsetHeight)
        const box = { l: sc.x - w / 2 - 4, r: sc.x + w / 2 + 4, t: sc.y - h - 2, b: sc.y + 2 }
        ok = !placed.some((q) => box.l < q.r && box.r > q.l && box.t < q.b && box.b > q.t) && !shown.has(item.el.textContent)
        if (ok) placed.push(box), shown.add(item.el.textContent)
      }
      item.clear = ok ? (item.clear ?? 0) + dt : 0
      item.on = ok && (item.on || item.clear > 0.2)
      const target = item.on ? opacity : 0
      item.a = (item.a ?? 0) + (target - (item.a ?? 0)) * Math.min(1, dt * 8)
      item.el.style.visibility = item.a > 0.02 ? 'visible' : 'hidden'
      item.el.style.opacity = item.a
      if (sc) item.el.style.transform = `translate(${sc.x}px, ${sc.y}px) translate(-50%, -100%)`
    }
    const near = Math.max(clamp01(1 - (p - 0.3) / 0.08), clamp01((p - 0.9) / 0.04) * (p < 0.95 ? 1 : 0))
    const all = [...peaks.map((it) => [it, p > 0.05 && p < 0.95, 1]), ...buildings.map((it) => [it, p > 0.04 && near > 0.05, near])]
    all.sort((x, y) => (y[0].on ? 1 : 0) - (x[0].on ? 1 : 0))
    for (const [it, want, op] of all) place(it, want, op)
  }

  return { update, covering, section }
}
