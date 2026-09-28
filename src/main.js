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
  const yongin = document.getElementById('placeYongin')
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
    highway.boost += (cp * 5 + Math.min(Math.abs(lenis.velocity), 40) * 0.12 - highway.boost) * Math.min(1, dt * 3)
    speedEl.textContent = Math.round(60 + highway.boost * 34)
    if (scenes[2].on) {
      const h = highway.horizonPoint()
      yongin.style.transform = `translate(${h.x}px, ${h.y}px) translate(-50%, -140%)`
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
