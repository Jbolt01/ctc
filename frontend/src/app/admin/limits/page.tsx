"use client";
import NavBar from '../../../components/NavBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminListLimits, adminCreateLimit } from '../../../lib/api';
import { useState } from 'react';

export default function AdminLimitsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['limits'], queryFn: adminListLimits });
  const [symbol, setSymbol] = useState('');
  const [maxPos, setMaxPos] = useState<number>(1000);
  const [maxOrder, setMaxOrder] = useState<number>(100);
  const create = useMutation({
    mutationFn: () => adminCreateLimit({ symbol, max_position: maxPos, max_order_size: maxOrder }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['limits'] });
      setSymbol('');
    },
  });

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Admin: Position Limits</h1>
        <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Create/Update Limit</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <input className="rounded-md border px-3 py-2" placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
            <input className="rounded-md border px-3 py-2" type="number" placeholder="Max Position" value={maxPos} onChange={(e) => setMaxPos(parseInt(e.target.value || '0'))} />
            <input className="rounded-md border px-3 py-2" type="number" placeholder="Max Order Size" value={maxOrder} onChange={(e) => setMaxOrder(parseInt(e.target.value || '0'))} />
            <button className="rounded-md bg-brand-600 px-4 py-2 text-white disabled:opacity-50" disabled={!symbol || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Limits</h2>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Max Position</th>
                  <th className="px-3 py-2">Max Order Size</th>
                  <th className="px-3 py-2">Admin Applies</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((r) => (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{r.symbol}</td>
                    <td className="px-3 py-2">{r.max_position}</td>
                    <td className="px-3 py-2">{r.max_order_size}</td>
                    <td className="px-3 py-2">{r.applies_to_admin ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

