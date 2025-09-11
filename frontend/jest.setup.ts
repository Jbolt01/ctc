import '@testing-library/jest-dom'
import 'whatwg-fetch'

// Basic WebSocket mock; individual tests can enhance behavior as needed.
class MockWebSocket {
  url: string
  readyState: number = 0
  onopen: ((ev: any) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: any) => void) | null = null
  onclose: ((ev: any) => void) | null = null
  sent: string[] = []

  static instances: MockWebSocket[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    // auto-open next tick
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.({} as any)
    }, 0)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.readyState = 3
    this.onclose?.({ code, reason } as any)
  }
  emitMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

// @ts-ignore
global.WebSocket = MockWebSocket as any

// jsdom doesn't implement confirm; default to 'true' in tests
// @ts-ignore
try {
  // Ensure both global and window confirm are defined to true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = global
  if (typeof g.confirm !== 'function') g.confirm = () => true
  if (typeof g.window !== 'undefined' && typeof g.window.confirm !== 'function') {
    g.window.confirm = () => true
  }
} catch {}
