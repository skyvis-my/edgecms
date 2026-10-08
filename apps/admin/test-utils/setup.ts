import { afterEach, expect } from 'bun:test'
import 'fake-indexeddb/auto'
import { JSDOM } from 'jsdom'

if (typeof document === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
  })

  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.document = dom.window.document
  globalThis.navigator = dom.window.navigator

  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.HTMLInputElement = dom.window.HTMLInputElement
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement
  globalThis.HTMLFormElement = dom.window.HTMLFormElement

  globalThis.Element = dom.window.Element
  globalThis.DocumentFragment = dom.window.DocumentFragment
  globalThis.Node = dom.window.Node
  globalThis.Event = dom.window.Event
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.NodeFilter = dom.window.NodeFilter
  globalThis.MutationObserver = dom.window.MutationObserver

  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  globalThis.localStorage = dom.window.localStorage
  globalThis.sessionStorage = dom.window.sessionStorage

  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id)
  globalThis.window.requestAnimationFrame = globalThis.requestAnimationFrame
  globalThis.window.cancelAnimationFrame = globalThis.cancelAnimationFrame
}

if (typeof globalThis.NodeFilter === 'undefined' && typeof globalThis.window !== 'undefined') {
  globalThis.NodeFilter = globalThis.window.NodeFilter
}

if (typeof globalThis.window.matchMedia !== 'function') {
  globalThis.window.matchMedia = (() => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.window.matchMedia
}

const htmlElementPrototype = globalThis.window.HTMLElement.prototype as HTMLElement & {
  attachEvent?: () => void
  detachEvent?: () => void
}

htmlElementPrototype.attachEvent ??= () => {}
htmlElementPrototype.detachEvent ??= () => {}

const matchers = await import('@testing-library/jest-dom/matchers')
expect.extend(matchers)
const { cleanup } = await import('@testing-library/react')

afterEach(() => {
  cleanup()

  if (globalThis.document?.head) {
    globalThis.document.head.querySelectorAll('style').forEach((styleEl) => {
      styleEl.parentElement?.removeChild(styleEl)
    })
  }

  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.removeAttribute('style')
    globalThis.document.documentElement.removeAttribute('class')
    globalThis.document.documentElement.removeAttribute('data-scroll-locked')
  }

  if (globalThis.document?.body) {
    globalThis.document.body.removeAttribute('style')
    globalThis.document.body.removeAttribute('class')
    globalThis.document.body.removeAttribute('data-scroll-locked')
  }

  globalThis.localStorage?.clear()
  globalThis.sessionStorage?.clear()
})

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
