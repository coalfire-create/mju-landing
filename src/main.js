import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { Stage, SHAPE } from './gl.js'

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

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp01 = gsap.utils.clamp(0, 1)

/* ---------- helpers ---------- */

// Splits text nodes into .char spans, leaving <br> and <em> structure intact.
function splitChars(el) {
  el.setAttribute('aria-label', el.textContent)
  for (const node of [...el.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) {
      const frag = document.createDocumentFragment()
      for (const ch of node.textContent) {
        if (ch === '\n') continue
        const s = document.createElement('span')
        s.className = 'char'
        s.setAttribute('aria-hidden', 'true')
        s.textContent = ch === ' ' ? ' ' : ch
        frag.appendChild(s)
      }
      node.replaceWith(frag)
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
      splitChars(node)
    }
  }
}

/* ---------- colleges carousel ---------- */

function buildCarousel() {
  const ring = document.getElementById('ring')
  const n = COLLEGES.length
  ring.parentElement.style.setProperty('--step', `${360 / n}deg`)
  COLLEGES.forEach(([ko, en, campus], i) => {
    const card = document.createElement('article')
    card.className = 'card'
    card.dataset.campus = campus
    card.style.setProperty('--i', i)
    card.style.setProperty('--hue', campus === 'SEOUL' ? 205 + i * 6 : 160 + (i - 6) * 8)
    card.innerHTML = `
      <span class="card__idx">${String(i + 1).padStart(2, '0')} / ${n}</span>
      <span class="card__campus">${campus === 'SEOUL' ? '인문캠퍼스' : '자연캠퍼스'}</span>
      <div class="card__orb"></div>
      <h3 class="card__ko">${ko}</h3>
      <p class="card__en">${en}</p>`
    ring.appendChild(card)
  })
  return [...ring.children]
}

/* ---------- cursor ---------- */

function initCursor() {
  if (window.matchMedia('(pointer: coarse)').matches) return
  const dot = document.querySelector('.cursor__dot')
  const ring = document.querySelector('.cursor__ring')
  const pos = { x: innerWidth / 2, y: innerHeight / 2 }
  const ringPos = { ...pos }
  window.addEventListener('pointermove', (e) => {
    pos.x = e.clientX
    pos.y = e.clientY
    dot.style.transform = `translate(${pos.x}px, ${pos.y}px)`
  })
  gsap.ticker.add(() => {
    ringPos.x += (pos.x - ringPos.x) * 0.16
    ringPos.y += (pos.y - ringPos.y) * 0.16
    ring.style.transform = `translate(${ringPos.x}px, ${ringPos.y}px)`
  })
  document.querySelectorAll('a, button, .card').forEach((el) => {
    el.addEventListener('pointerenter', () => document.body.classList.add('cursor-hover'))
    el.addEventListener('pointerleave', () => document.body.classList.remove('cursor-hover'))
  })
}

function initMagnetic() {
  document.querySelectorAll('.magnetic').forEach((el) => {
    const inner = el.querySelector('span')
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left - r.width / 2
      const y = e.clientY - r.top - r.height / 2
      gsap.to(el, { x: x * 0.3, y: y * 0.4, duration: 0.4, ease: 'power3.out' })
      gsap.to(inner, { x: x * 0.15, y: y * 0.2, duration: 0.4, ease: 'power3.out' })
    })
    el.addEventListener('pointerleave', () => {
      gsap.to([el, inner], { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1, 0.4)' })
    })
  })
}

/* ---------- scroll → 3D state ---------- */

function sceneTargets() {
  const mid = innerHeight / 2
  const secs = [...document.querySelectorAll('[data-shape]')].map((el) => {
    const r = el.getBoundingClientRect()
    // Tall sticky sections hold their shape for their whole scroll span.
    return {
      shape: +el.dataset.shape,
      tint: el.dataset.tint,
      top: r.top + Math.min(r.height, innerHeight) / 2,
      bottom: r.bottom - Math.min(r.height, innerHeight) / 2,
    }
  })

  if (mid <= secs[0].bottom) return { morph: secs[0].shape, tint: secs[0].tint }
  for (let i = 0; i < secs.length - 1; i++) {
    const a = secs[i]
    const b = secs[i + 1]
    if (mid >= a.top && mid <= a.bottom) return { morph: a.shape, tint: a.tint }
    if (mid > a.bottom && mid < b.top) {
      let f = (mid - a.bottom) / (b.top - a.bottom)
      f = f * f * (3 - 2 * f)
      return { morph: a.shape + (b.shape - a.shape) * f, tint: f < 0.5 ? a.tint : b.tint }
    }
  }
  const last = secs[secs.length - 1]
  return { morph: last.shape, tint: last.tint }
}

/* ---------- boot ---------- */

async function boot() {
  const countEl = document.getElementById('loaderCount')
  const barEl = document.getElementById('loaderBar')
  const counter = { v: 0 }
  const paint = () => {
    countEl.textContent = Math.round(counter.v)
    barEl.style.transform = `scaleX(${counter.v / 100})`
  }
  const countTween = gsap.to(counter, { v: 90, duration: 1.6, ease: 'power2.out', onUpdate: paint })

  // Particle text and the knot texture need their fonts rasterized first.
  await Promise.race([
    Promise.all([
      document.fonts.load('900 100px "Playfair Display"', 'MJU'),
      document.fonts.load('italic 900 100px "Playfair Display"', 'MYONGJI'),
      document.fonts.load('900 100px "Noto Serif KR"', '명지明知'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ])

  const stage = new Stage(document.getElementById('gl'))
  const cards = buildCarousel()

  document.querySelectorAll('.split').forEach(splitChars)

  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
  lenis.stop()
  document.querySelectorAll('a[href^="#"]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      lenis.scrollTo(a.getAttribute('href'), { duration: 2.2 })
    }),
  )

  await countTween
  await gsap.to(counter, { v: 100, duration: 0.4, onUpdate: paint })

  /* intro */
  gsap
    .timeline({ onComplete: () => lenis.start() })
    .to('#loader', { yPercent: -100, duration: 1.1, ease: 'expo.inOut' })
    .to(stage.state, { intro: 1, duration: reduceMotion ? 0.1 : 3, ease: 'power3.out' }, '-=0.6')
    .from('.nav', { y: -40, opacity: 0, duration: 1, ease: 'power3.out' }, '-=2.4')
    .from('.hero .char', { yPercent: 120, rotate: 8, opacity: 0, stagger: 0.05, duration: 1.2, ease: 'expo.out' }, '-=2.2')
    .from('.hero .eyebrow, .hero .reveal, .scroll-hint', { y: 24, opacity: 0, stagger: 0.1, duration: 1, ease: 'power3.out' }, '-=1.6')

  /* section reveals */
  document.querySelectorAll('section:not(.hero) .split').forEach((el) => {
    gsap.from(el.querySelectorAll('.char'), {
      yPercent: 110,
      opacity: 0,
      stagger: 0.04,
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 82%' },
    })
  })
  document.querySelectorAll('section:not(.hero) .reveal').forEach((el) => {
    gsap.from(el, { y: 40, opacity: 0, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } })
  })
  document.querySelectorAll('.value').forEach((el, i) => {
    gsap.from(el, {
      xPercent: i % 2 ? 12 : -12,
      opacity: 0,
      duration: 1.3,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 85%' },
    })
  })
  gsap.to('.marquee__track', {
    xPercent: -25,
    ease: 'none',
    scrollTrigger: { trigger: '.marquee', start: 'top bottom', end: 'bottom top', scrub: true },
  })

  /* per-frame: scroll → 3D, carousel, campus labels */
  const colleges = document.getElementById('colleges')
  const progressEl = document.getElementById('collegeProgress')
  const ringEl = document.getElementById('ring')
  const labels = [document.getElementById('labelSeoul'), document.getElementById('labelYongin')]
  const n = cards.length
  const step = 360 / n

  gsap.ticker.add(() => {
    const target = sceneTargets()
    stage.state.morphTarget = target.morph
    stage.setTint(target.tint)

    const r = colleges.getBoundingClientRect()
    const p = clamp01(-r.top / (r.height - innerHeight))
    const angle = (-p * 360 * (n - 1)) / n
    ringEl.style.transform = `translateZ(calc(var(--radius) * -1)) rotateY(${angle}deg)`
    progressEl.style.transform = `scaleX(${p})`
    stage.state.ringRot = (angle * Math.PI) / 180
    cards.forEach((c, i) => {
      const a = ((((i * step + angle) % 360) + 540) % 360) - 180 // 0 = front
      const front = 1 - Math.min(Math.abs(a) / 180, 1)
      c.style.opacity = 0.12 + Math.pow(front, 2.2) * 0.88
      c.classList.toggle('is-active', Math.abs(a) < step / 2)
    })

    const cv = stage.visibility(SHAPE.CAMPUS)
    stage.campusScreens().forEach((s, i) => {
      labels[i].style.opacity = cv
      labels[i].style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, 0)`
    })

    stage.update(lenis.velocity)
  })

  initCursor()
  initMagnetic()
}

boot()
