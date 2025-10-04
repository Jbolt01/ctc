"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminGetTeam, adminDisableUser, adminEnableUser, adminDisableTeamApiKey, adminEnableTeamApiKey, AdminTeamDetails } from '../../../../lib/api';

export default function TeamDetailsPage({ params }: { params: { teamId: string } }) {
  const [team, setTeam] = useState<AdminTeamDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTeam = async () => {
    try {
      setLoading(true);
      const t = await adminGetTeam(params.teamId);
      setTeam(t);
    } catch (e: any) {
      setError(e?.message || 'Failed to load team details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeam();
  }, [params.teamId]);

  const toggleUser = async (userId: string, isDisabled: boolean) => {
    if (isDisabled) {
      await adminEnableUser(userId);
    } else {
      await adminDisableUser(userId);
    }
    await loadTeam();
  };

  const toggleApiKey = async (keyId: string, isActive: boolean) => {
    if (isActive) {
      await adminDisableTeamApiKey(keyId);
    } else {
      await adminEnableTeamApiKey(keyId);
    }
    await loadTeam();
  };

  if (loading) return <p className="text-gray-400 font-mono">Loading team details…</p>;
  if (error) return <p className="text-red-400 font-mono">{error}</p>;
  if (!team) return <p className="text-gray-400 font-mono">Team not found.</p>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black text-white">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-8">
          <Link href="/admin" className="text-cyan-400 font-mono hover:underline">← Back to Admin</Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2">{team.name}</h1>
          <p className="text-gray-400 font-mono">Join Code: {team.join_code}</p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-bold font-mono mb-4">Members</h2>
            <div className="divide-y divide-gray-800">
              {team.members.map(m => (
                <div key={m.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-bold">{m.name}</div>
                    <div className="text-sm text-gray-400">{m.email} ({m.role})</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.is_disabled && <span className="text-red-400 font-mono text-xs">Disabled</span>}
                    <button onClick={() => toggleUser(m.id, m.is_disabled)} className="text-xs font-mono text-yellow-400 hover:underline">
                      {m.is_disabled ? 'Enable' : 'Disable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold font-mono mb-4">API Keys</h2>
            <div className="divide-y divide-gray-800">
              {team.api_keys.map(k => (
                <div key={k.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold">{k.name}</div>
                    <button onClick={() => toggleApiKey(k.id, k.is_active)} className="text-xs font-mono text-yellow-400 hover:underline">
                      {k.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                  <div className="text-sm text-gray-400">Created: {new Date(k.created_at).toLocaleString()}</div>
                  {k.last_used && <div className="text-sm text-gray-500">Last used: {new Date(k.last_used).toLocaleString()}</div>}
                  {!k.is_active && <div className="text-sm text-red-400">Inactive</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
