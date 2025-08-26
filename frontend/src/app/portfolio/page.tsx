"use client";
import NavBar from '../../components/NavBar';
import { useQuery } from '@tanstack/react-query';
import { fetchPositions, type PositionsResponse } from '../../lib/api';

export default function PortfolioPage() {
  const { data } = useQuery<PositionsResponse>({ queryKey: ['positions'], queryFn: fetchPositions, refetchInterval: 3000 });

  const total = (data?.positions ?? []).reduce(
    (acc, p) => ({ qty: acc.qty + p.quantity, unrealized: acc.unrealized + (p.unrealized_pnl ?? 0) }),
    { qty: 0, unrealized: 0 }
  );

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-sm text-gray-500">Positions, PnL, and exposure</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi label="Total Qty" value={total.qty.toString()} />
          <Kpi label="Unrealized PnL" value={fmt(total.unrealized)} emphasis={total.unrealized >= 0 ? 'green' : 'red'} />
        </div>

        <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
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
                {(data?.positions ?? []).map((p) => (
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

function Kpi({ label, value, emphasis }: { label: string; value: string; emphasis?: 'green' | 'red' }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${emphasis === 'green' ? 'text-green-600' : emphasis === 'red' ? 'text-red-600' : ''}`}>{value}</div>
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

