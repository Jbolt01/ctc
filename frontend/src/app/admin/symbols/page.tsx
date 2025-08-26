"use client";
import NavBar from '../../../components/NavBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchSymbols, adminCreateSymbol } from '../../../lib/api';
import { useState } from 'react';

export default function AdminSymbolsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['symbols'], queryFn: fetchSymbols });
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => adminCreateSymbol({ symbol, name }),
    onSuccess: () => {
      setSymbol('');
      setName('');
      qc.invalidateQueries({ queryKey: ['symbols'] });
    },
  });

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Admin: Symbols</h1>
        <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Create Symbol</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <input className="rounded-md border px-3 py-2" placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
            <input className="rounded-md border px-3 py-2 sm:col-span-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="rounded-md bg-brand-600 px-4 py-2 text-white disabled:opacity-50" disabled={!symbol || !name || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Symbols</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(data?.symbols ?? []).map((s) => (
              <li key={s.symbol} className="rounded-md border px-3 py-2">
                <div className="font-medium">{s.symbol}</div>
                <div className="text-sm text-gray-600">{s.name}</div>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}

