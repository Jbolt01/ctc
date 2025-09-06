import { fetchSymbols, fetchPositions, fetchAllOrders, placeOrder, cancelOrder, fetchTrades, fetchMarketTrades } from './api'

describe('api library', () => {
  beforeEach(() => {
    ;(global as any).fetch = jest.fn(async (url: string, init?: any) => {
      return {
        ok: true,
        json: async () => ({ url, init }),
      } as any
    })
    // Provide local apiKey for header
    ;(global as any).localStorage = {
      getItem: (k: string) => (k === 'apiKey' ? 'test-key' : null),
    }
  })

  it('sends X-API-Key header on GET', async () => {
    const res = (await fetchSymbols()) as any
    expect(res.init.headers['X-API-Key']).toBe('test-key')
  })

  it('builds correct paths', async () => {
    const a = (await fetchPositions()) as any
    expect(a.url).toContain('/api/v1/positions')
    const b = (await fetchAllOrders('pending', 'AAPL')) as any
    expect(b.url).toContain('/api/v1/orders?status=pending&symbol=AAPL')
    const c = (await fetchTrades('AAPL')) as any
    expect(c.url).toContain('/api/v1/trades?symbol=AAPL')
    const d = (await fetchMarketTrades('AAPL')) as any
    expect(d.url).toContain('/api/v1/trades/market?symbol=AAPL')
  })

  it('POST includes body and header', async () => {
    const res = (await placeOrder({ symbol: 'AAPL', side: 'buy', order_type: 'limit', quantity: 10, price: 100 })) as any
    expect(res.init.headers['X-API-Key']).toBe('test-key')
    expect(res.init.method).toBe('POST')
    expect(res.init.body).toBeDefined()
  })

  it('DELETE works for cancel', async () => {
    const res = (await cancelOrder('id123')) as any
    expect(res.url).toContain('/api/v1/orders/id123')
    expect(res.init.method).toBe('DELETE')
  })
})
