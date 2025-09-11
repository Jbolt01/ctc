"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type PendingRegistration = {
  id_token?: string;
  openid_sub?: string;
  email?: string;
  name?: string;
};

export default function SetupPage() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [teamName, setTeamName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('pendingRegistration');
      if (!raw) {
        router.push('/');
        return;
      }
      const data = JSON.parse(raw) as PendingRegistration;
      setPending(data);
    } catch {
      router.push('/');
    }
  }, [router]);

  const canSubmit = useMemo(() => {
    if (!pending) return false;
    if (mode === 'create') return teamName.trim().length >= 2;
    return joinCode.trim().length >= 4;
  }, [pending, mode, teamName, joinCode]);

  const submit = async () => {
    if (!pending) return;
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const body: any = {
        ...pending,
        team_action: mode,
      };
      if (mode === 'create') body.team_name = teamName.trim();
      else body.join_code = joinCode.trim();
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = '';
        try {
          const data = await res.json();
          if (data && typeof data.detail === 'string') detail = `: ${data.detail}`;
        } catch {}
        throw new Error(`Registration failed (${res.status})${detail}`);
      }
      const data = await res.json();
      localStorage.setItem('apiKey', data.api_key);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('teams', JSON.stringify(data.teams ?? []));
      localStorage.removeItem('pendingRegistration');
      router.push('/trading/equities');
    } catch (e: any) {
      setError(e?.message || 'Failed to complete setup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black flex items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-6 shadow-xl">
          <h1 className="text-2xl font-bold text-white mb-2">Team Setup</h1>
          <p className="text-gray-400 font-mono mb-4">Create a new team or join an existing one.</p>
          {error && (
            <div className="mb-3 rounded border border-red-500/40 bg-red-900/30 text-red-300 px-3 py-2 font-mono text-sm">
              {error}
            </div>
          )}
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => setMode('create')}
              className={`px-4 py-2 rounded-lg font-mono border ${mode === 'create' ? 'text-cyan-400 border-cyan-500/50 bg-cyan-500/10' : 'text-gray-300 border-gray-700 hover:text-cyan-300 hover:border-cyan-500/40'}`}
            >
              Create Team
            </button>
            <button
              onClick={() => setMode('join')}
              className={`px-4 py-2 rounded-lg font-mono border ${mode === 'join' ? 'text-cyan-400 border-cyan-500/50 bg-cyan-500/10' : 'text-gray-300 border-gray-700 hover:text-cyan-300 hover:border-cyan-500/40'}`}
            >
              Join Team
            </button>
          </div>
          {mode === 'create' ? (
            <div className="space-y-2">
              <label className="block text-sm text-gray-300 font-mono">Team name</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono"
                placeholder="e.g., Alpha"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm text-gray-300 font-mono">Join code</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono uppercase"
                placeholder="e.g., 1A2B3C4D"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              />
              <p className="text-xs text-gray-500 font-mono">Ask your team admin for the join code.</p>
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={submit}
              disabled={!canSubmit || loading || !pending}
              className={`px-4 py-2 rounded-lg font-mono ${canSubmit && !loading && pending ? 'bg-cyan-600 hover:bg-cyan-700 text-white' : 'bg-gray-700 text-gray-400 cursor-not-allowed'}`}
            >
              {loading ? 'Submitting…' : (mode === 'create' ? 'Create & Continue' : 'Join & Continue')}
            </button>
            <button onClick={() => router.push('/')} className="text-gray-400 font-mono hover:underline">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
