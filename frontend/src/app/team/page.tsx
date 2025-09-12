"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { teamGet, teamRotateCode, teamUpdateName, teamRemoveMember } from '../../lib/api';

type Member = { id: string; email: string; name: string; role: string };
type TeamSettings = { id: string; name: string; join_code: string; role: string; members: Member[] };

export default function TeamSettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<TeamSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const isOwner = useMemo(() => data?.role === 'admin', [data?.role]);

  const load = async () => {
    try {
      const t = await teamGet();
      setData(t as any);
      setName((t as any).name);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const apiKey = typeof window !== 'undefined' ? localStorage.getItem('apiKey') : null;
    if (!apiKey) router.push('/');
    load();
  }, [router]);

  const rotate = async () => {
    if (!isOwner) return;
    const res = await teamRotateCode();
    setData(prev => (prev ? { ...prev, join_code: (res as any).join_code } : prev));
  };

  const saveName = async () => {
    if (!isOwner || !name.trim()) return;
    await teamUpdateName(name.trim());
    await load();
  };

  const remove = async (userId: string) => {
    if (!isOwner) return;
    await teamRemoveMember(userId);
    await load();
  };

  if (loading) return <div className="p-6 text-gray-300 font-mono">Loading team…</div>;
  if (error) return <div className="p-6 text-red-400 font-mono">{error}</div>;
  if (!data) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black p-6">
      <div className="mx-auto max-w-3xl rounded-xl border border-gray-700/50 bg-gray-900/50 p-6">
        <h1 className="text-2xl font-bold text-white mb-2">Team Settings</h1>
        <p className="text-gray-400 font-mono mb-6">Manage your team and invite members</p>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm text-gray-300 font-mono mb-1">Team name</label>
            {isOwner ? (
              <div className="flex gap-2">
                <input className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" value={name} onChange={e => setName(e.target.value)} />
                <button onClick={saveName} className="px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded font-mono">Save</button>
              </div>
            ) : (
              <div className="text-white font-mono">{data.name}</div>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-300 font-mono mb-1">Join code</label>
            <div className="flex gap-2 items-center">
              <code className="px-2 py-1 bg-gray-800 text-cyan-300 rounded font-mono tracking-wider">{data.join_code}</code>
              {isOwner && (
                <button onClick={rotate} className="px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 rounded font-mono hover:bg-gray-700">Rotate</button>
              )}
              <button onClick={() => navigator.clipboard?.writeText(data.join_code)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 rounded font-mono hover:bg-gray-700">Copy</button>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-xl text-white font-mono mb-3">Members</h2>
          <div className="divide-y divide-gray-800">
            {data.members.map(m => (
              <div key={m.id} className="flex items-center justify-between py-2">
                <div className="text-white font-mono">{m.name} <span className="text-gray-400">({m.email})</span></div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 font-mono">{m.role}</span>
                  {isOwner && (
                    <button onClick={() => remove(m.id)} className="px-2 py-1 bg-red-900/40 border border-red-500/40 text-red-300 rounded font-mono">Remove</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

