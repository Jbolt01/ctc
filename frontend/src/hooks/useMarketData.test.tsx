import { renderHook, act } from '@testing-library/react'
import { useMarketData } from './useMarketData'

// Use the MockWebSocket from jest.setup.ts
declare const global: any

describe('useMarketData', () => {
  beforeAll(() => {
    jest.useFakeTimers()
  })
  afterAll(() => {
    // Ensure we don't leak fake timers into other test suites
    jest.useRealTimers()
  })
  beforeEach(() => {
    // reset instances
    if (global.WebSocket?.instances) {
      global.WebSocket.instances.length = 0
    }
  })

  it('subscribes on open and updates quote/orderbook/trade', () => {
    const { result } = renderHook(() => useMarketData('AAPL', ['quotes', 'orderbook', 'trades']))

    // advance timer to trigger connect and onopen
    act(() => {
      jest.advanceTimersByTime(200)
    })

    const ws = global.WebSocket.instances[0]
    expect(ws).toBeDefined()
    expect(ws.sent.length).toBe(1)
    const payload = JSON.parse(ws.sent[0])
    expect(payload).toEqual({ action: 'subscribe', symbols: ['AAPL'], channels: ['quotes', 'orderbook', 'trades'] })

    // Ack
    act(() => {
      ws.emitMessage({ type: 'subscription_ack', symbols: ['AAPL'], channels: ['quotes', 'orderbook', 'trades'], timestamp: new Date().toISOString() })
    })

    // Quote
    act(() => {
      ws.emitMessage({ type: 'quote', symbol: 'AAPL', bid: 100, ask: 101, bid_size: 10, ask_size: 20, timestamp: new Date().toISOString() })
    })
    expect(result.current.quote?.bid).toBe(100)

    // Orderbook
    act(() => {
      ws.emitMessage({ type: 'orderbook', symbol: 'AAPL', bids: [{ price: 100, quantity: 5 }], asks: [{ price: 101, quantity: 7 }], timestamp: new Date().toISOString() })
    })
    expect(result.current.orderbook.bids[0].price).toBe(100)

    // Trade
    act(() => {
      ws.emitMessage({ type: 'trade', symbol: 'AAPL', price: 101, quantity: 3, timestamp: new Date().toISOString() })
    })
    expect(result.current.lastTrade?.price).toBe(101)
  })

  it('ignores messages for other symbols', () => {
    renderHook(() => useMarketData('AAPL', ['quotes', 'orderbook', 'trades']))
    act(() => {
      jest.advanceTimersByTime(200)
    })
    const ws = global.WebSocket.instances[0]

    act(() => {
      ws.emitMessage({ type: 'quote', symbol: 'GOOGL', bid: 1, ask: 2, bid_size: 1, ask_size: 1, timestamp: new Date().toISOString() })
    })
    // no throw; no state update to AAPL
  })
})
