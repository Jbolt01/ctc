const API_BASE = '';

const getApiKey = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('apiKey') || 'test-key';
  }
  return process.env.NEXT_PUBLIC_API_KEY ?? 'test-key';
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-API-Key': getApiKey() },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GET ${path} failed`);
  return res.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': getApiKey() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed`);
  return res.json();
}

export type SymbolInfo = { symbol: string; name: string };
export type SymbolsResponse = { symbols: SymbolInfo[] };
export function fetchSymbols() {
  return apiGet<SymbolsResponse>(`/api/v1/symbols`);
}

export type OrderbookLevel = { price: number; quantity: number };
export type OrderbookResponse = { symbol: string; bids: OrderbookLevel[]; asks: OrderbookLevel[] };
export function fetchOrderbook(symbol: string, depth = 10) {
  return apiGet<OrderbookResponse>(`/api/v1/orderbook/${symbol}?depth=${depth}`);
}

export type Position = {
  symbol: string;
  quantity: number;
  average_price?: number;
  current_price?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
};
export type PositionsResponse = { positions: Position[] };
export function fetchPositions() {
  return apiGet<PositionsResponse>(`/api/v1/positions`);
}

export type OrderSummary = {
  order_id: string;
  symbol: string;
  side: string;
  order_type: string;
  quantity: number;
  price?: number;
  status: string;
};
export type OrdersResponse = { orders: OrderSummary[] };
export function fetchOpenOrders(symbol?: string) {
  const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  return apiGet<OrdersResponse>(`/api/v1/orders/open${q}`);
}

export type PlaceOrderRequest = {
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  quantity: number;
  price?: number;
};
export type PlaceOrderResponse = { order_id: string; status: string; created_at: string };
export function placeOrder(body: PlaceOrderRequest) {
  return apiPost<PlaceOrderResponse>(`/api/v1/orders`, body);
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': getApiKey() },
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed`);
  return res.json();
}

export function cancelOrder(orderId: string) {
  return apiDelete<{ order_id: string; status: string }>(`/api/v1/orders/${orderId}`);
}

export type TradeRecord = {
  trade_id: string;
  symbol: string;
  quantity: number;
  price: number;
  executed_at: string;
  side?: 'buy' | 'sell' | null;
};
export type TradesResponse = { trades: TradeRecord[] };
export function fetchTrades(symbol?: string) {
  const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  return apiGet<TradesResponse>(`/api/v1/trades${q}`);
}

export function fetchMarketTrades(symbol?: string) {
  const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  return apiGet<TradesResponse>(`/api/v1/trades/market${q}`);
}

export function fetchAllOrders(status?: string, symbol?: string) {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (symbol) params.append('symbol', symbol);
  const q = params.toString() ? `?${params.toString()}` : '';
  return apiGet<OrdersResponse>(`/api/v1/orders${q}`);
}

// Admin
export function adminCreateSymbol(payload: { symbol: string; name: string; symbol_type?: string; tick_size?: number; lot_size?: number }) {
  return apiPost(`/api/v1/admin/symbols`, payload);
}
export function adminListLimits() {
  return apiGet<Array<{ id: string; symbol: string; max_position: number; max_order_size: number; applies_to_admin: boolean }>>(`/api/v1/admin/limits`);
}
export function adminCreateLimit(payload: { symbol: string; max_position: number; max_order_size: number; applies_to_admin?: boolean }) {
  return apiPost(`/api/v1/admin/limits`, payload);
}
export function adminListHours() {
  return apiGet<Array<{ id: string; symbol: string; day_of_week: number; open_time: string; close_time: string; is_active: boolean }>>(`/api/v1/admin/hours`);
}
export function adminCreateHours(payload: { symbol: string; day_of_week: number; open_time: string; close_time: string; is_active?: boolean }) {
  return apiPost(`/api/v1/admin/hours`, payload);
}
export function adminListTeams() {
  return apiGet<Array<{ id: string; name: string }>>(`/api/v1/admin/teams`);
}
export function adminCreateTeam(payload: { name: string }) {
  return apiPost(`/api/v1/admin/teams`, payload);
}
export function adminListCompetitions() {
  return apiGet<Array<{ id: string; name: string; start_time: string; end_time: string; is_active: boolean }>>(`/api/v1/admin/competitions`);
}
export function adminCreateCompetition(payload: { name: string; start_time: string; end_time: string; is_active?: boolean }) {
  return apiPost(`/api/v1/admin/competitions`, payload);
}

// Admin: Users
export type AdminUser = { id: string; email: string; name: string; is_admin: boolean };
export function adminListUsers() {
  return apiGet<AdminUser[]>(`/api/v1/admin/users`);
}
export function adminSetUserAdmin(userId: string, is_admin: boolean) {
  return apiPost(`/api/v1/admin/users/${userId}/admin`, { is_admin });
}

// Admin: Market Data
export function adminUpsertMarketData(payload: { symbol: string; close: number }) {
  return apiPost(`/api/v1/admin/market-data`, payload);
}

// Admin: Trading controls
export function adminPauseSymbols(symbol?: string) {
  return apiPost(`/api/v1/admin/symbols/pause`, { symbol });
}
export function adminStartSymbols(symbol?: string) {
  return apiPost(`/api/v1/admin/symbols/start`, { symbol });
}
export function adminSettleSymbol(symbol: string, price: number) {
  return apiPost(`/api/v1/admin/symbols/settle`, { symbol, price });
}

// Admin: Symbols (delete)
export async function adminDeleteSymbol(symbol: string) {
  const url = `${API_BASE}/api/v1/admin/symbols/${encodeURIComponent(symbol)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'X-API-Key': getApiKey() },
  });
  if (!res.ok) {
    let detail = ''
    try {
      const data = await res.json()
      if (data && typeof data.detail === 'string') detail = `: ${data.detail}`
    } catch {}
    throw new Error(`DELETE /admin/symbols failed (${res.status})${detail}`)
  }
  return res.json();
}
// Admin: list symbols with status
export type AdminSymbol = {
  symbol: string;
  name: string;
  trading_halted: boolean;
  settlement_active: boolean;
  settlement_price?: number | null;
};
export function adminListSymbols() {
  return apiGet<AdminSymbol[]>(`/api/v1/admin/symbols`);
}
