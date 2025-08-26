const API_BASE = '';

const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? 'test';

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-API-Key': API_KEY },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GET ${path} failed`);
  return res.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
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

