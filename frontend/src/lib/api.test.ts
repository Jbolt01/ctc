import { fetchSymbols, fetchPositions, fetchAllOrders, placeOrder, cancelOrder, fetchTrades, fetchMarketTrades, adminListAllowedEmails, adminAddAllowedEmail, adminDeleteAllowedEmail, adminDisableUser, adminEnableUser, adminDeleteUser, adminGetTeam, adminDisableTeamApiKey, adminEnableTeamApiKey } from './api'

describe('api library', () => {
  beforeEach(() => {
    ;(global as any).fetch = jest.fn(async (url: string, init?: any) => {
      return {
        ok: true,
        json: async () => ({ url, init }),
      } as any
    })
    // Provide local apiKey for header via real jsdom localStorage
    try {
      window.localStorage.setItem('apiKey', 'test-key')
    } catch {
      // Fallback mock if jsdom localStorage is unavailable
      ;(global as any).localStorage = {
        getItem: (k: string) => (k === 'apiKey' ? 'test-key' : null),
      }
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

  it('handles admin email functions', async () => {
    const list = (await adminListAllowedEmails()) as any;
    expect(list.url).toContain('/api/v1/admin/allowed-emails');

    const add = (await adminAddAllowedEmail('test@example.com')) as any;
    expect(add.url).toContain('/api/v1/admin/allowed-emails');
    expect(add.init.method).toBe('POST');
    expect(add.init.body).toBe(JSON.stringify({ email: 'test@example.com' }));

    const del = (await adminDeleteAllowedEmail('test@example.com')) as any;
    expect(del.url).toContain('/api/v1/admin/allowed-emails/test%40example.com');
    expect(del.init.method).toBe('DELETE');
  });

  it('handles new admin user and team functions', async () => {
    const disableUser = (await adminDisableUser('user1')) as any;
    expect(disableUser.url).toContain('/api/v1/admin/users/user1/disable');
    expect(disableUser.init.method).toBe('POST');

    const enableUser = (await adminEnableUser('user1')) as any;
    expect(enableUser.url).toContain('/api/v1/admin/users/user1/enable');
    expect(enableUser.init.method).toBe('POST');

    const deleteUser = (await adminDeleteUser('user1')) as any;
    expect(deleteUser.url).toContain('/api/v1/admin/users/user1');
    expect(deleteUser.init.method).toBe('DELETE');

    const getTeam = (await adminGetTeam('team1')) as any;
    expect(getTeam.url).toContain('/api/v1/admin/teams/team1');

    const disableKey = (await adminDisableTeamApiKey('key1')) as any;
    expect(disableKey.url).toContain('/api/v1/admin/teams/api-keys/key1/disable');
    expect(disableKey.init.method).toBe('POST');

    const enableKey = (await adminEnableTeamApiKey('key1')) as any;
    expect(enableKey.url).toContain('/api/v1/admin/teams/api-keys/key1/enable');
    expect(enableKey.init.method).toBe('POST');
  });
});
