"use client";
import NavBar from '../../../components/NavBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminListCompetitions, adminCreateCompetition } from '../../../lib/api';
import { useState } from 'react';

export default function AdminCompetitionsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['competitions'], queryFn: adminListCompetitions });
  const [form, setForm] = useState({ name: '', start_time: '', end_time: '', is_active: false });
  const create = useMutation({
    mutationFn: () => adminCreateCompetition(form),
    onSuccess: () => {
      setForm({ name: '', start_time: '', end_time: '', is_active: false });
      qc.invalidateQueries({ queryKey: ['competitions'] });
    },
  });

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Admin: Competitions</h1>
        <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Create Competition</h2>
          <div className="grid gap-3 sm:grid-cols-5">
            <input className="rounded-md border px-3 py-2 sm:col-span-2" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="rounded-md border px-3 py-2" type="datetime-local" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
            <input className="rounded-md border px-3 py-2" type="datetime-local" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
            <button className="rounded-md bg-brand-600 px-4 py-2 text-white disabled:opacity-50" disabled={!form.name || !form.start_time || !form.end_time || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Competitions</h2>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Start</th>
                  <th className="px-3 py-2">End</th>
                  <th className="px-3 py-2">Active</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((r) => (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">{new Date(r.start_time).toLocaleString()}</td>
                    <td className="px-3 py-2">{new Date(r.end_time).toLocaleString()}</td>
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

