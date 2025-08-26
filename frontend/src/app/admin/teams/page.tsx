"use client";
import NavBar from '../../../components/NavBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminListTeams, adminCreateTeam } from '../../../lib/api';
import { useState } from 'react';

export default function AdminTeamsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['teams'], queryFn: adminListTeams });
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => adminCreateTeam({ name }),
    onSuccess: () => {
      setName('');
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Admin: Teams</h1>
        <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Create Team</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <input className="rounded-md border px-3 py-2 sm:col-span-3" placeholder="Team Name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="rounded-md bg-brand-600 px-4 py-2 text-white disabled:opacity-50" disabled={!name || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Teams</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(data ?? []).map((t) => (
              <li key={t.id} className="rounded-md border px-3 py-2">
                {t.name}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}

