"use client";
import NavBar from '../../components/NavBar';
import { useQuery } from '@tanstack/react-query';
import { fetchPositions, fetchSymbols, type PositionsResponse } from '../../lib/api';
import { useMarketData } from '../../hooks/useMarketData';

export default function DashboardPage() {
  const { data: positions } = useQuery<PositionsResponse>({ queryKey: ['positions'], queryFn: fetchPositions, refetchInterval: 3000 });
  const { data: symbols } = useQuery({ queryKey: ['symbols'], queryFn: fetchSymbols });
  // Lightweight quote ticker via WebSocket on a default symbol (AAPL)
  const { quote } = useMarketData('AAPL', ['quotes']);

  const totalGross = (positions?.positions ?? []).reduce((acc, p) => acc + (p.unrealized_pnl ?? 0), 0);
  const exposure = (positions?.positions ?? []).reduce((acc, p) => acc + Math.abs(p.quantity * (p.current_price ?? 0)), 0);
  const numSymbols = symbols?.symbols.length ?? 0;

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500">Competition overview and real-time metrics</p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Unrealized PnL" value={fmtCurrency(totalGross)} trend={totalGross >= 0 ? 'up' : 'down'} />
          <KpiCard title="Exposure" value={fmtCurrency(exposure)} />
          <KpiCard title="Symbols" value={numSymbols.toString()} />
          <KpiCard title="Open Positions" value={(positions?.positions ?? []).length.toString()} />
          {quote && <KpiCard title="AAPL L1" value={`${quote.bid.toFixed(2)} / ${quote.ask.toFixed(2)}`} />}
        </section>

        <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Positions Snapshot</h2>
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
        </section>
      </main>
    </div>
  );
}

function KpiCard({ title, value, trend }: { title: string; value: string; trend?: 'up' | 'down' }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {trend && (
        <div className={`mt-1 text-xs ${trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>{trend === 'up' ? '▲' : '▼'} {trend === 'up' ? 'Positive' : 'Negative'}</div>
      )}
    </div>
  );
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

