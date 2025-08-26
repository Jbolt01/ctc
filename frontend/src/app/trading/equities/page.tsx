"use client";
import { useEffect, useMemo, useState } from 'react';
import NavBar from '../../../components/NavBar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { fetchSymbols, fetchPositions, fetchOpenOrders, placeOrder as apiPlaceOrder, type PositionsResponse, type OrdersResponse } from '../../../lib/api';
import { useMarketData, useSyntheticCandles } from '../../../hooks/useMarketData';
import MiniCandleChart from '../../../components/MiniCandleChart';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

function useSymbols() {
  return useQuery({ queryKey: ['symbols'], queryFn: fetchSymbols });
}

function usePositions() {
  return useQuery({ queryKey: ['positions'], queryFn: fetchPositions, refetchInterval: 2000 });
}

export default function EquitiesTradingPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'market' | 'limit'>('limit');
  const [qty, setQty] = useState(100);
  const [price, setPrice] = useState<number | ''>('');
  const qc = useQueryClient();
  const { data: symbols } = useSymbols();
  const { quote, orderbook: ob, lastTrade } = useMarketData(symbol, ['quotes', 'orderbook', 'trades']);
  const candles = useSyntheticCandles(lastTrade);
  const { data: positions } = usePositions();

  useEffect(() => {
    if (ob?.bids?.[0]?.price && type === 'limit') setPrice(ob.bids[0].price);
  }, [ob?.bids, type]);

  const chartData = useMemo(() => {
    const bids = (ob?.bids ?? []).slice().reverse();
    const asks = ob?.asks ?? [];
    const labels = [...bids.map((b) => b.price.toFixed(2)), ...asks.map((a) => a.price.toFixed(2))];
    return {
      labels,
      datasets: [
        {
          label: 'Bid Size',
          data: bids.map((b) => b.quantity),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.25)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Ask Size',
          data: asks.map((a) => a.quantity),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.25)',
          tension: 0.35,
          fill: true,
        },
      ],
    };
  }, [ob]);

  async function placeOrder() {
    await apiPlaceOrder({ symbol, side, order_type: type, quantity: qty, ...(type === 'limit' ? { price: Number(price) } : {}) });
    qc.invalidateQueries({ queryKey: ['orderbook', symbol] });
    qc.invalidateQueries({ queryKey: ['positions'] });
    qc.invalidateQueries({ queryKey: ['orders', 'open'] });
  }

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Equities Trading</h1>
            <p className="text-sm text-gray-500">Professional order entry with live depth and positions</p>
          </div>
          <select className="rounded-md border px-3 py-2" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {(symbols?.symbols ?? [{ symbol: 'AAPL', name: 'Apple Inc.' }]).map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol} — {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="space-y-4 lg:col-span-2">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium">Order Book Depth</h2>
                <span className="text-xs text-gray-500">{quote ? `L1 ${quote.bid.toFixed(2)} x ${quote.ask.toFixed(2)}` : 'Aggregated by price'}</span>
              </div>
              <Line data={chartData} options={{ responsive: true, plugins: { legend: { position: 'bottom' } } }} />
            </div>

            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium">Price (Synthetic Candles)</h2>
                <span className="text-xs text-gray-500">Last trade bucketed</span>
              </div>
              <MiniCandleChart candles={candles} />
            </div>

            <LiveOrders symbol={symbol} />
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-lg font-medium">Order Entry</h2>
              <div className="grid gap-3">
                <div className="flex gap-2">
                  <button className={`flex-1 rounded-md border px-3 py-2 ${side === 'buy' ? 'border-green-500 bg-green-50' : ''}`} onClick={() => setSide('buy')}>
                    Buy
                  </button>
                  <button className={`flex-1 rounded-md border px-3 py-2 ${side === 'sell' ? 'border-red-500 bg-red-50' : ''}`} onClick={() => setSide('sell')}>
                    Sell
                  </button>
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <label className="text-sm text-gray-600">Type</label>
                  <select className="col-span-2 rounded-md border px-3 py-2" value={type} onChange={(e) => setType(e.target.value as any)}>
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <label className="text-sm text-gray-600">Qty</label>
                  <input type="number" className="col-span-2 rounded-md border px-3 py-2" value={qty} onChange={(e) => setQty(parseInt(e.target.value || '0'))} />
                </div>
                {type === 'limit' && (
                  <div className="grid grid-cols-3 items-center gap-2">
                    <label className="text-sm text-gray-600">Price</label>
                    <input type="number" step="0.01" className="col-span-2 rounded-md border px-3 py-2" value={price} onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))} />
                  </div>
                )}
                <button className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700" onClick={placeOrder}>
                  Place Order
                </button>
              </div>
            </div>
            <PositionsPanel positions={positions} />
          </aside>
        </div>
      </main>
    </div>
  );
}

function LiveOrders({ symbol }: { symbol: string }) {
  const { data } = useQuery<OrdersResponse>({
    queryKey: ['orders', 'open', symbol],
    queryFn: () => fetchOpenOrders(symbol),
    refetchInterval: 1500,
  });

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium">Open Orders</h2>
        <span className="text-xs text-gray-500">Auto-refreshing</span>
      </div>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.orders ?? []).map((o) => (
              <tr key={o.order_id} className="odd:bg-white even:bg-gray-50">
                <td className="px-3 py-2 font-medium">
                  <span className={o.side === 'buy' ? 'text-green-600' : 'text-red-600'}>{o.side.toUpperCase()}</span>
                </td>
                <td className="px-3 py-2">{o.symbol}</td>
                <td className="px-3 py-2">{o.order_type.toUpperCase()}</td>
                <td className="px-3 py-2">{o.quantity}</td>
                <td className="px-3 py-2">{o.price ?? 'MKT'}</td>
                <td className="px-3 py-2 text-gray-600">{o.status}</td>
              </tr>
            ))}
            {(!data || data.orders.length === 0) && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={6}>
                  No open orders
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PositionsPanel({ positions }: { positions?: PositionsResponse }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-medium">Positions</h2>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Avg</th>
              <th className="px-3 py-2">Last</th>
              <th className="px-3 py-2">Unrealized</th>
            </tr>
          </thead>
          <tbody>
            {(positions?.positions ?? []).map((p) => (
              <tr key={p.symbol} className="odd:bg-white even:bg-gray-50">
                <td className="px-3 py-2 font-medium">{p.symbol}</td>
                <td className={`px-3 py-2 ${p.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>{p.quantity}</td>
                <td className="px-3 py-2">{p.average_price != null ? p.average_price.toFixed(2) : '-'}</td>
                <td className="px-3 py-2">{p.current_price != null ? p.current_price.toFixed(2) : '-'}</td>
                <td className={`px-3 py-2 ${p.unrealized_pnl != null && p.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {p.unrealized_pnl != null ? p.unrealized_pnl.toFixed(2) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

