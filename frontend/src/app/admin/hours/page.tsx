"use client";
import NavBar from '../../../components/NavBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminListHours, adminCreateHours } from '../../../lib/api';
import { useState } from 'react';

export default function AdminHoursPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['hours'], queryFn: adminListHours });
  const [form, setForm] = useState({ symbol: '', day_of_week: 1, open_time: '09:30', close_time: '16:00', is_active: true });
  const create = useMutation({
    mutationFn: () => adminCreateHours(form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hours'] }),
  });

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Admin: Trading Hours</h1>
        <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Add Trading Hours</h2>
          <div className="grid gap-3 sm:grid-cols-6">
            <input className="rounded-md border px-3 py-2 sm:col-span-2" placeholder="Symbol" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
            <input className="rounded-md border px-3 py-2" type="number" min={0} max={6} placeholder="Day (0-6)" value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: parseInt(e.target.value || '0') })} />
            <input className="rounded-md border px-3 py-2" placeholder="Open (HH:MM)" value={form.open_time} onChange={(e) => setForm({ ...form, open_time: e.target.value })} />
            <input className="rounded-md border px-3 py-2" placeholder="Close (HH:MM)" value={form.close_time} onChange={(e) => setForm({ ...form, close_time: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
            <button className="rounded-md bg-brand-600 px-4 py-2 text-white disabled:opacity-50" disabled={!form.symbol || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Hours</h2>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Open</th>
                  <th className="px-3 py-2">Close</th>
                  <th className="px-3 py-2">Active</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((r) => (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{r.symbol}</td>
                    <td className="px-3 py-2">{r.day_of_week}</td>
                    <td className="px-3 py-2">{r.open_time}</td>
                    <td className="px-3 py-2">{r.close_time}</td>
                    <td className="px-3 py-2">{r.is_active ? 'Yes' : 'No'}</td>
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

