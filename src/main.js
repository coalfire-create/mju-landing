import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { ShaderCanvas } from './shader-canvas.js'
import { LOUVRE, MOSAIC, WAVES, RAYS } from './scenes/shaders.js'
import { CampusFlight } from './scenes/campus.js'
import CAMPUS_DATA from './data/campus.json'
import { Rotunda } from './scenes/rotunda.js'

gsap.registerPlugin(ScrollTrigger)

// [name, English name, campus] — the university's college list (mju.ac.kr,
// 대학 page, 2026). Campus follows where each college's departments are housed.
const COLLEGES = [
  ['인문대학', 'Humanities', 'SEOUL'],
  ['사회과학대학', 'Social Sciences', 'SEOUL'],
  ['경영대학', 'Business', 'SEOUL'],
  ['미디어·휴먼라이프대학', 'Media & Human Life', 'SEOUL'],
  ['인공지능·소프트웨어융합대학', 'AI & Software Convergence', 'SEOUL'],
  ['미래융합대학', 'Future Convergence', 'SEOUL'],
  ['화학·생명과학대학', 'Chemistry & Life Sciences', 'YONGIN'],
  ['스마트시스템공과대학', 'Smart Systems Engineering', 'YONGIN'],
  ['반도체·ICT대학', 'Semiconductor & ICT', 'YONGIN'],
  ['스포츠·예술대학', 'Sports & Arts', 'YONGIN'],
  ['건축대학', 'Architecture', 'YONGIN'],
  ['아너칼리지', 'Honors College', 'BOTH'],
  ['방목기초교육대학', 'Bangmok College of Basic Education', 'BOTH'],
]
const CAMPUS_NAME = { SEOUL: '인문캠퍼스', YONGIN: '자연캠퍼스', BOTH: '양 캠퍼스' }

// Wire palettes for 사랑 / 진리 / 봉사.
const PALETTES = [
  [[1.0, 0.3, 0.5], [1.0, 0.62, 0.78], [0.62, 0.32, 1.0]],
  [[0.15, 0.35, 1.0], [0.5, 0.85, 1.0], [1.0, 1.0, 1.0]],
  [[0.08, 0.8, 0.62], [0.62, 1.0, 0.72], [1.0, 0.85, 0.35]],
]

// English names and notes for places the campus map doesn't describe. Building
// contents, codes and storeys come from the campus map (src/data/campus.json).
const INFO = {
  정문: { en: 'Main Gate' },
  MCC관: { en: 'Myongji Campus Complex' },
  종합관: { en: 'Main Hall' },
  학생회관: { en: 'Student Union' },
  방목학술정보관: { en: 'Bangmok Library' },
  '60주년채플관': { en: '60th Anniversary Chapel' },
  창조예술관: { en: 'Creative Arts Hall' },
  백마상: { en: 'White Horse Statue', note: '자연캠퍼스의 상징' },
  명진당: { en: 'Myungjindang Library' },
  함박관: { en: 'Hambak Hall' },
}
const ADDRESS = { SEOUL: '서대문구 거북골로 34', YONGIN: '처인구 명지로 116' }

// Every stop on the flight, in the same order as the camera path in
// scenes/campus.js: each campus's stops from src/data/campus.json (built by
// scripts/build_campus.py), with two stops on the road in between.
const campusRoute = (key, stage) =>
  CAMPUS_DATA[key].stops.map((s, i) => ({
    stage,
    ko: s.ko,
    code: s.code ?? null,
    en: INFO[s.ko]?.en ?? '',
    note: s.note || INFO[s.ko]?.note || (i === 0 ? ADDRESS[stage] : ''),
    floors: s.floors ? `${s.basement ? `지하${s.basement} · ` : ''}지상 ${s.floors}층` : '',
  }))
const ROUTE = [
  ...campusRoute('seoul', 'SEOUL'),
  { stage: 'ROAD', ko: '한강', en: 'Han River', note: '서울을 가로질러 남쪽으로' },
  { stage: 'ROAD', ko: '용인', en: 'Yongin', note: '경기도 용인시 처인구' },
  ...campusRoute('yongin', 'YONGIN'),
]
const STAGE_LABEL = { SEOUL: '인문캠퍼스 · SEOUL', ROAD: '이동 중 · ON THE ROAD', YONGIN: '자연캠퍼스 · YONGIN' }

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

function buildSigns() {
  const wrap = document.getElementById('signs')
  return ROUTE.map((stop) => {
    const el = document.createElement('div')
    el.className = `sign sign--${stop.stage.toLowerCase()}`
    el.innerHTML = `
      <div class="sign__top">
        <span class="sign__stage">${stop.stage === 'ROAD' ? 'ROUTE' : stop.stage === 'SEOUL' ? '인문캠퍼스' : '자연캠퍼스'}</span>
        ${stop.code ? `<span class="sign__code">${stop.code}</span>` : ''}
      </div>
      <strong class="sign__ko" style="font-size:${Math.min(92, Math.floor(600 / [...stop.ko].length))}px">${stop.ko}</strong>
      <div class="sign__bottom"><span>${stop.en}</span><span>${stop.floors}</span></div>
      ${stop.note ? `<p class="sign__note">${stop.note}</p>` : ''}`
    wrap.appendChild(el)
    return el
  })
}

// 0..1 progress through a tall section whose content is sticky.
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
  const campus = new CampusFlight(document.getElementById('cvCampus'))
  const rotunda = new Rotunda(document.getElementById('cvColleges'), COLLEGES)

  const scenes = [
    { el: document.getElementById('hero'), view: hero },
    { el: document.getElementById('name'), view: name },
    { el: document.getElementById('campus'), view: campus },
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
  const signEls = buildSigns()
  // Small name tags for every official building, shown in the campus overviews.
  const tagWrap = document.getElementById('buildingTags')
  const tagEls = campus.tags.map((t) => {
    const el = document.createElement('span')
    el.className = 'btag'
    el.textContent = t.name
    tagWrap.appendChild(el)
    return el
  })
  const famous = new Set(ROUTE.filter((r, i) => campus.tour.includes(i)).map((r) => r.ko))
  const tagOrder = campus.tags.map((_, i) => i).sort((a, b) => famous.has(campus.tags[b].name) - famous.has(campus.tags[a].name))
  const campusHead = document.querySelector('.campus__head')
  const routeStage = document.getElementById('routeStage')
  const routePlace = document.getElementById('routePlace')
  const routeFill = document.getElementById('routeFill')
  let currentStop = -1
  // Place the bar's landmarks at their stops' share of the route.
  document.querySelectorAll('.route__mark[data-stage]').forEach((m) => {
    const k = campus.tour.findIndex((i) => ROUTE[i].stage === m.dataset.stage)
    m.style.left = `${(k / (campus.tour.length - 1)) * 100}%`
  })

  // Building directory: every place on both campuses, one tap to fly there.
  const dir = document.getElementById('directory')
  const dirToggle = document.getElementById('dirToggle')
  const dirList = document.getElementById('dirList')
  for (const [stage, title] of [['SEOUL', '인문캠퍼스 · 서울'], ['YONGIN', '자연캠퍼스 · 용인']]) {
    const group = document.createElement('div')
    group.className = 'dir__group'
    group.innerHTML = `<h4>${title}</h4>`
    ROUTE.forEach((stop, i) => {
      if (stop.stage !== stage) return
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'dir__item'
      b.dataset.stop = i
      b.innerHTML = `<span>${i === ROUTE.findIndex((r) => r.stage === stage) ? '캠퍼스 전체 보기' : stop.ko}</span>${stop.code ? `<small>${stop.code}</small>` : ''}`
      b.addEventListener('click', () => {
        campus.flyTo(i)
        dir.classList.add('is-exploring')
        if (innerWidth < 760) dir.classList.remove('is-open')
      })
      group.appendChild(b)
    })
    dirList.appendChild(group)
  }
  const dirItems = [...dirList.querySelectorAll('.dir__item')]
  function closeDirectory(returnToTour) {
    if (returnToTour) campus.exitExplore()
    dir.classList.remove('is-exploring')
  }
  dirToggle.addEventListener('click', () => dir.classList.toggle('is-open'))
  document.getElementById('dirBack').addEventListener('click', () => closeDirectory(true))
  const valueEls = [...document.querySelectorAll('.value')]
  const valueIdx = [...document.querySelectorAll('#valuesIndex li')]
  const activeEl = document.getElementById('collegeActive')
  const collegeBar = document.getElementById('collegeProgress')
  let currentValue = -1
  const palette = PALETTES[0].map((c) => [...c])

  rotunda.onActive = (i) => {
    const [ko, en, campus] = COLLEGES[i]
    activeEl.innerHTML = `<b>${ko}</b> ${en} · ${CAMPUS_NAME[campus]}`
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
    campus.progress = cp
    // Scrolling takes the camera back from a directory jump to the tour.
    if (campus.exploreTarget !== null && Math.abs(lenis.velocity) > 3) closeDirectory(true)
    const active = campus.activeStop()
    if (scenes[2].on) {
      // Only the stop the camera is on shows its sign, over its real building.
      const labelScale = innerWidth < 760 ? 0.3 : 0.42
      signEls.forEach((el, i) => {
        const fade = i === active.index ? active.weight : 0
        const s = fade > 0 && campus.labelScreen(i)
        el.style.visibility = s ? 'visible' : 'hidden'
        if (!s) return
        el.style.opacity = fade
        // Keep the whole sign on screen (it is 640px wide before scaling).
        const half = (640 * labelScale) / 2 + 12
        const x = Math.min(innerWidth - half, Math.max(half, s.x))
        // ...and below the nav bar.
        const y = Math.max(s.y, 80 + el.offsetHeight * labelScale)
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${labelScale})`
      })
      // Overview name tags: famous buildings first, and any tag that would
      // overlap one already placed is skipped, so small screens stay legible.
      const ov = campus.overview()
      const placed = []
      tagOrder.forEach((i) => {
        const t = campus.tags[i]
        const el = tagEls[i]
        const s = ov && ov.key === t.key && campus.screen(t.pos)
        const w = el.offsetWidth
        const h = el.offsetHeight
        const box = s && { l: s.x - w / 2 - 3, r: s.x + w / 2 + 3, t: s.y - h - 2, b: s.y + 2 }
        const free = box && !placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)
        el.style.visibility = free ? 'visible' : 'hidden'
        if (!free) return
        placed.push(box)
        el.style.opacity = ov.weight
        el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`
      })
    }
    // The title steps aside once the flight begins.
    campusHead.style.opacity = 1 - Math.min(1, Math.max(0, (cp - 0.01) / 0.03))
    routeFill.style.transform = `scaleX(${campus.stopPosition() / (campus.tour.length - 1)})`
    if (active.index !== currentStop) {
      currentStop = active.index
      routeStage.textContent = STAGE_LABEL[ROUTE[currentStop].stage]
      routePlace.textContent = ROUTE[currentStop].ko
      gsap.fromTo(routePlace, { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.6, ease: 'expo.out', overwrite: true })
      dirItems.forEach((b) => b.classList.toggle('is-active', +b.dataset.stop === currentStop))
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
