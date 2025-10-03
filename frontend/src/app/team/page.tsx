"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { teamGet, teamRotateCode, teamUpdateName, teamRemoveMember, listTeamApiKeys, createTeamApiKey, revokeTeamApiKey, type TeamAPIKey, type TeamAPIKeyCreateOut } from '../../lib/api';

type Member = { id: string; email: string; name: string; role: string };
type TeamSettings = { id: string; name: string; join_code: string; role: string; members: Member[] };

export default function TeamSettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<TeamSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const isOwner = useMemo(() => data?.role === 'admin', [data?.role]);
  const [keys, setKeys] = useState<TeamAPIKey[] | null>(null);
  const [keysLoading, setKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<TeamAPIKeyCreateOut | null>(null);

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

  useEffect(() => {
    const loadKeys = async () => {
      if (!isOwner) return;
      setKeysLoading(true);
      try {
        const k = await listTeamApiKeys();
        setKeys(k);
      } catch (e) {
        // Surface key loading errors in the main error box if team loaded
        setError((e as any)?.message || 'Failed to load API keys');
      } finally {
        setKeysLoading(false);
      }
    };
    void loadKeys();
  }, [isOwner]);

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

  const createKey = async () => {
    if (!isOwner || !newKeyName.trim()) return;
    const res = await createTeamApiKey(newKeyName.trim());
    setCreatedKey(res);
    setNewKeyName('');
    try {
      const k = await listTeamApiKeys();
      setKeys(k);
    } catch {}
  };

  const revokeKey = async (id: string) => {
    if (!isOwner) return;
    await revokeTeamApiKey(id);
    try {
      const k = await listTeamApiKeys();
      setKeys(k);
    } catch {}
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

        {isOwner && (
          <div className="mt-8">
            <h2 className="text-xl text-white font-mono mb-3">API Keys</h2>
            <p className="text-gray-400 font-mono mb-3">Create keys for bots and revoke compromised keys.</p>

            <div className="mb-4 flex gap-2 items-center">
              <input
                aria-label="API key name"
                placeholder="Key name (e.g., Trading Bot)"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
              />
              <button
                onClick={createKey}
                disabled={!newKeyName.trim()}
                className="px-3 py-2 bg-cyan-600 disabled:bg-cyan-900/50 hover:bg-cyan-700 text-white rounded font-mono"
              >Create</button>
            </div>

            {createdKey && (
              <div className="mb-4 rounded border border-yellow-500/40 bg-yellow-900/20 p-3">
                <div className="text-yellow-300 font-mono mb-1">Copy your new API key now. You won&apos;t be able to see it again.</div>
                <div className="flex items-center gap-2">
                  <code className="px-2 py-1 bg-gray-800 text-cyan-300 rounded font-mono break-all">{createdKey.api_key}</code>
                  <button onClick={() => navigator.clipboard?.writeText(createdKey.api_key)} className="px-2 py-1 bg-gray-800 border border-gray-700 text-gray-300 rounded font-mono">Copy</button>
                  <button onClick={() => setCreatedKey(null)} className="px-2 py-1 bg-gray-800 border border-gray-700 text-gray-300 rounded font-mono">Dismiss</button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-gray-300">
                  <tr>
                    <th className="px-2 py-1 font-mono">Name</th>
                    <th className="px-2 py-1 font-mono">Created</th>
                    <th className="px-2 py-1 font-mono">Last used</th>
                    <th className="px-2 py-1 font-mono">Status</th>
                    <th className="px-2 py-1 font-mono">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-white">
                  {keysLoading && (
                    <tr><td className="px-2 py-2 font-mono text-gray-400" colSpan={5}>Loading API keys…</td></tr>
                  )}
                  {!keysLoading && keys && keys.length === 0 && (
                    <tr><td className="px-2 py-2 font-mono text-gray-400" colSpan={5}>No API keys yet.</td></tr>
                  )}
                  {!keysLoading && keys && keys.map(k => (
                    <tr key={k.id} className="border-t border-gray-800">
                      <td className="px-2 py-2 font-mono">{k.name}</td>
                      <td className="px-2 py-2 font-mono">{new Date(k.created_at).toLocaleString()}</td>
                      <td className="px-2 py-2 font-mono">{k.last_used ? new Date(k.last_used).toLocaleString() : '—'}</td>
                      <td className="px-2 py-2 font-mono">{k.is_active ? 'active' : 'revoked'}</td>
                      <td className="px-2 py-2 font-mono">
                        {k.is_active ? (
                          <button onClick={() => revokeKey(k.id)} className="px-2 py-1 bg-red-900/40 border border-red-500/40 text-red-300 rounded">Revoke</button>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

