import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { ShaderCanvas } from './shader-canvas.js'
import { LOUVRE, MOSAIC, WAVES, RAYS } from './scenes/shaders.js'
import { Highway } from './scenes/highway.js'
import { Rotunda } from './scenes/rotunda.js'

gsap.registerPlugin(ScrollTrigger)

// [name, English name, campus]
const COLLEGES = [
  ['인문대학', 'Humanities', 'SEOUL'],
  ['사회과학대학', 'Social Sciences', 'SEOUL'],
  ['경영대학', 'Business', 'SEOUL'],
  ['법과대학', 'Law', 'SEOUL'],
  ['ICT융합대학', 'ICT Convergence', 'SEOUL'],
  ['미래융합대학', 'Future Convergence', 'SEOUL'],
  ['자연과학대학', 'Natural Sciences', 'YONGIN'],
  ['공과대학', 'Engineering', 'YONGIN'],
  ['예술체육대학', 'Arts & Physical Education', 'YONGIN'],
  ['건축대학', 'Architecture', 'YONGIN'],
]

// Wire palettes for 사랑 / 진리 / 봉사.
const PALETTES = [
  [[1.0, 0.3, 0.5], [1.0, 0.62, 0.78], [0.62, 0.32, 1.0]],
  [[0.15, 0.35, 1.0], [0.5, 0.85, 1.0], [1.0, 1.0, 1.0]],
  [[0.08, 0.8, 0.62], [0.62, 1.0, 0.72], [1.0, 0.85, 0.35]],
]

// Stops passed on the drive from the Seoul campus to the Yongin campus.
// Building codes follow the university's own numbering (S = 인문, Y = 자연).
const ROUTE = [
  { stage: 'SEOUL', ko: '정문', en: 'Main Gate', note: '서대문구 거북골로 34' },
  { stage: 'SEOUL', ko: '종합관', code: 'S1', en: 'Main Hall', note: '인문캠퍼스의 중심 강의동' },
  { stage: 'SEOUL', ko: '학생회관', code: 'S2', en: 'Student Union', note: '학생식당 · 동아리방' },
  { stage: 'SEOUL', ko: '방목학술정보관', code: 'S9', en: 'Bangmok Library', note: '중앙도서관' },
  { stage: 'SEOUL', ko: 'MCC관', code: 'S10', en: 'Myongji Campus Complex', note: '베리타스홀 · 코이노니아홀' },
  { stage: 'ROAD', ko: '한강', en: 'Han River', note: '서울을 가로질러 남쪽으로' },
  { stage: 'ROAD', ko: '용인', en: 'Yongin', note: '경기도 용인시 처인구' },
  { stage: 'YONGIN', ko: '정문', en: 'Main Gate', note: '처인구 명지로 116' },
  { stage: 'YONGIN', ko: '백마상', en: 'White Horse', note: '자연캠퍼스의 상징' },
  { stage: 'YONGIN', ko: '창조예술관', code: 'Y2', en: 'Creative Arts Hall', note: '캠퍼스 랜드마크' },
  { stage: 'YONGIN', ko: '명진당', code: 'Y3', en: 'Myungjindang', note: '자연도서관' },
  { stage: 'YONGIN', ko: '함박관', code: 'Y9', en: 'Hambak Hall', note: '신입생 교양 강의동' },
  { stage: 'YONGIN', ko: '60주년 채플관', code: 'Y22', en: '60th Anniversary Chapel', note: '채플 · 공연장' },
]
const STAGE_LABEL = { SEOUL: '인문캠퍼스 · SEOUL', ROAD: '이동 중 · ON THE ROAD', YONGIN: '자연캠퍼스 · YONGIN' }
// Scroll progress at which each stop is right ahead of the viewer.
const ROUTE_AT = ROUTE.map((_, i) => 0.05 + (0.9 * i) / (ROUTE.length - 1))
const ROUTE_SPAN = 600 // world units of road per unit of scroll progress
const SIGN_READ = 13 // distance (world units) at which a sign is best read

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp01 = gsap.utils.clamp(0, 1)

function splitChars(el) {
  el.setAttribute('aria-label', el.textContent)
  const text = el.textContent
  el.textContent = ''
  for (const ch of text) {
    const s = document.createElement('span')
    s.className = 'char'
    s.setAttribute('aria-hidden', 'true')
    s.textContent = ch === ' ' ? ' ' : ch
    el.appendChild(s)
  }
}

// 0..1 progress through a tall section whose content is sticky.
function buildSigns() {
  const wrap = document.getElementById('signs')
  return ROUTE.map((stop, i) => {
    const el = document.createElement('div')
    el.className = `sign sign--${stop.stage.toLowerCase()}`
    el.innerHTML = `
      <div class="sign__top">
        <span class="sign__stage">${stop.stage === 'ROAD' ? 'ROUTE' : stop.stage === 'SEOUL' ? '인문캠퍼스' : '자연캠퍼스'}</span>
        <span class="sign__code">${stop.code ?? String(i + 1).padStart(2, '0')}</span>
      </div>
      <strong class="sign__ko">${stop.ko}</strong>
      <div class="sign__bottom"><span>${stop.en}</span><span>${stop.note}</span></div>`
    wrap.appendChild(el)
    return el
  })
}

function stickyProgress(el) {
  const r = el.getBoundingClientRect()
  return clamp01(-r.top / Math.max(1, r.height - innerHeight))
}

async function boot() {
  const countEl = document.getElementById('loaderCount')
  const barEl = document.getElementById('loaderBar')
  const counter = { v: 0 }
  const paint = () => {
    countEl.textContent = Math.round(counter.v)
    barEl.style.transform = `scaleX(${counter.v / 100})`
  }
  const countTween = gsap.to(counter, { v: 90, duration: 1.4, ease: 'power2.out', onUpdate: paint })

  // Canvas-drawn panels need their fonts ready.
  await Promise.race([
    Promise.all([
      document.fonts.load('italic 400 100px "Instrument Serif"', 'Myongji'),
      document.fonts.load('800 100px "Pretendard Variable"', '인문대학공과ICT'),
      document.fonts.load('900 100px "Noto Serif KR"', '明知'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ])

  /* scenes */
  const hero = new ShaderCanvas(document.getElementById('cvHero'), LOUVRE, { maxDpr: 1.5 })
  const name = new ShaderCanvas(document.getElementById('cvName'), MOSAIC, {
    maxDpr: 1.25,
    idleMouse: (t) => [0.62 + 0.18 * Math.sin(t * 0.5), 0.5 + 0.22 * Math.sin(t * 0.37 + 1.2)],
  })
  const values = new ShaderCanvas(document.getElementById('cvValues'), WAVES, {
    maxDpr: 1.25,
    uniforms: { uC1: [...PALETTES[0][0]], uC2: [...PALETTES[0][1]], uC3: [...PALETTES[0][2]] },
  })
  const finale = new ShaderCanvas(document.getElementById('cvFinale'), RAYS, {
    maxDpr: 1.5,
    idleMouse: (t) => [0.5 + 0.25 * Math.sin(t * 0.4), 0.3],
  })
  const highway = new Highway(document.getElementById('cvCampus'))
  const rotunda = new Rotunda(document.getElementById('cvColleges'), COLLEGES)

  const scenes = [
    { el: document.getElementById('hero'), view: hero },
    { el: document.getElementById('name'), view: name },
    { el: document.getElementById('campus'), view: highway },
    { el: document.getElementById('values'), view: values },
    { el: document.getElementById('colleges'), view: rotunda },
    { el: document.getElementById('finale'), view: finale },
  ]
  // Only scenes near the viewport render.
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => (scenes.find((s) => s.el === e.target).on = e.isIntersecting)),
    { rootMargin: '10% 0px' },
  )
  scenes.forEach((s) => io.observe(s.el))

  document.querySelectorAll('.split').forEach(splitChars)

  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
  lenis.stop()
  document.querySelectorAll('a[href^="#"]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      lenis.scrollTo(a.getAttribute('href'), { duration: 2 })
    }),
  )

  await countTween
  await gsap.to(counter, { v: 100, duration: 0.35, onUpdate: paint })

  /* intro: the light screen wipes up and "Myongji" rises out of the glass */
  gsap
    .timeline({ onComplete: () => lenis.start() })
    .to('#loader', { clipPath: 'inset(0 0 100% 0)', duration: 1.2, ease: 'expo.inOut' })
    .from('.hero .char', { yPercent: 110, opacity: 0, stagger: 0.06, duration: 1.4, ease: 'expo.out' }, '-=0.5')
    .from('.nav, .hero .eyebrow, .reveal-hero', { y: 20, opacity: 0, stagger: 0.08, duration: 1, ease: 'power3.out' }, '-=1.1')

  /* reveals */
  document.querySelectorAll('section:not(.hero) .split').forEach((el) => {
    gsap.from(el.querySelectorAll('.char'), {
      yPercent: 110,
      opacity: 0,
      stagger: 0.035,
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: el.closest('section'), start: 'top 60%' },
    })
  })
  document.querySelectorAll('.reveal').forEach((el) => {
    gsap.from(el, { y: 30, opacity: 0, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: el.closest('section'), start: 'top 55%' } })
  })

  /* per-section scroll wiring */
  const heroWord = document.querySelector('.hero__word')
  const speedEl = document.getElementById('speed')
  const signEls = buildSigns()
  const campusHead = document.querySelector('.campus__head')
  const routeStage = document.getElementById('routeStage')
  const routePlace = document.getElementById('routePlace')
  const routeFill = document.getElementById('routeFill')
  let currentStop = -1
  // Place the bar's landmarks at their stops' share of the route.
  document.querySelectorAll('.route__mark[data-stage]').forEach((m) => {
    const i = ROUTE.findIndex((s) => s.stage === m.dataset.stage)
    m.style.left = `${(i / (ROUTE.length - 1)) * 100}%`
  })
  const valueEls = [...document.querySelectorAll('.value')]
  const valueIdx = [...document.querySelectorAll('#valuesIndex li')]
  const activeEl = document.getElementById('collegeActive')
  const collegeBar = document.getElementById('collegeProgress')
  let currentValue = -1
  const palette = PALETTES[0].map((c) => [...c])

  rotunda.onActive = (i) => {
    const [ko, en, campus] = COLLEGES[i]
    activeEl.innerHTML = `<b>${ko}</b> ${en} · ${campus === 'SEOUL' ? '인문캠퍼스' : '자연캠퍼스'}`
  }
  rotunda.onActive(0)

  const showValue = (i) => {
    valueEls.forEach((el, j) => {
      el.classList.toggle('is-active', j === i)
      if (j === i) {
        gsap.fromTo(el.children, { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: 0.08, duration: 1, ease: 'expo.out', overwrite: true })
      }
    })
    valueIdx.forEach((li, j) => li.classList.toggle('is-active', j === i))
  }

  let last = performance.now()
  let time = 0
  gsap.ticker.add(() => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    time += dt

    const hp = stickyProgress(scenes[0].el)
    heroWord.style.transform = `translateY(${hp * -18}vh) scale(${1 + hp * 0.08})`

    const cp = stickyProgress(scenes[2].el)
    highway.boost += (1 + Math.min(Math.abs(lenis.velocity), 40) * 0.15 - highway.boost) * Math.min(1, dt * 3)
    speedEl.textContent = Math.round(60 + highway.boost * 34)
    // Each stop's gantry sits ahead of us by how much scroll remains until it;
    // the last one (arrival) stays in view to the end.
    const lastStop = ROUTE.length - 1
    highway.setGantries(ROUTE_AT.map((at, i) => {
      const d = (at - cp) * ROUTE_SPAN + SIGN_READ
      return i === lastStop ? Math.max(d, SIGN_READ) : d
    }))
    if (scenes[2].on) {
      signEls.forEach((el, i) => {
        const s = highway.signScreen(i)
        const fade = Math.min(1, Math.max(0, (170 - s.distance) / 50))
        el.style.visibility = s.visible && fade > 0 ? 'visible' : 'hidden'
        el.style.opacity = fade
        el.style.zIndex = 1000 - Math.round(s.distance)
        el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${s.width / 640})`
      })
    }
    // The title steps aside once the signs start coming overhead.
    campusHead.style.opacity = 1 - Math.min(1, Math.max(0, (cp - 0.02) / 0.05))
    routeFill.style.transform = `scaleX(${Math.min(1, Math.max(0, (cp - ROUTE_AT[0]) / (ROUTE_AT[lastStop] - ROUTE_AT[0])))})`
    const stop = Math.max(0, Math.min(lastStop, Math.round((cp - ROUTE_AT[0]) / (ROUTE_AT[1] - ROUTE_AT[0]))))
    if (stop !== currentStop) {
      currentStop = stop
      routeStage.textContent = STAGE_LABEL[ROUTE[stop].stage]
      routePlace.textContent = ROUTE[stop].code ? `${ROUTE[stop].ko} ${ROUTE[stop].code}` : ROUTE[stop].ko
      gsap.fromTo(routePlace, { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.6, ease: 'expo.out', overwrite: true })
    }

    const vp = stickyProgress(scenes[3].el)
    const vi = Math.min(2, Math.floor(vp * 3))
    if (vi !== currentValue) {
      currentValue = vi
      showValue(vi)
    }
    // Ease the wire palette toward the active value's colours.
    palette.forEach((c, k) => c.forEach((v, j) => (c[j] = v + (PALETTES[vi][k][j] - v) * Math.min(1, dt * 3))))
    values.set('uC1', palette[0])
    values.set('uC2', palette[1])
    values.set('uC3', palette[2])

    const rp = stickyProgress(scenes[4].el)
    rotunda.progress = rp
    collegeBar.style.transform = `scaleX(${rp})`

    for (const s of scenes) if (s.on) s.view.render(time, dt)
  })
}

boot()
