"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  adminListUsers,
  adminSetUserAdmin,
  adminListTeams,
  adminCreateTeam,
  adminListHours,
  adminListCompetitions,
  adminCreateCompetition,
  adminCreateSymbol,
  adminDeleteSymbol,
  adminUpsertMarketData,
  adminPauseSymbols,
  adminStartSymbols,
  adminSettleSymbol,
  adminListSymbols,
  fetchSymbols,
} from '../../lib/api';

type TabKey = 'users' | 'symbols' | 'teams' | 'hours' | 'competitions' | 'marketdata';

export default function AdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [active, setActive] = useState<TabKey>('users');

  useEffect(() => {
    // Probe admin by calling a protected endpoint
    (async () => {
      try {
        await adminListUsers();
        setAuthorized(true);
      } catch {
        setAuthorized(false);
        router.push('/');
      }
    })();
  }, [router]);

  if (authorized === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto" />
          <p className="text-slate-400 mt-4 font-mono">Checking admin access…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-8 flex items-center justify-between border-b border-gray-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">ADMIN CONSOLE</span>
            </h1>
            <p className="mt-2 text-gray-400 font-mono">Full control over your exchange</p>
          </div>
          <Link href="/trading/equities" className="text-cyan-400 font-mono hover:underline">Back to Trading</Link>
        </header>

        <nav className="flex gap-2 mb-6">
          {(
            [
              ['users', 'Users'],
              ['symbols', 'Symbols'],
              ['teams', 'Teams'],
              ['hours', 'Trading Hours'],
              ['competitions', 'Competitions'],
              ['marketdata', 'Market Data'],
            ] as Array<[TabKey, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setActive(k)}
              className={clsx(
                'px-4 py-2 rounded-lg font-mono text-sm border bg-gray-900/50 transition-all',
                active === k
                  ? 'text-cyan-400 border-cyan-500/50 shadow shadow-cyan-500/10'
                  : 'text-gray-300 border-gray-700 hover:text-cyan-300 hover:border-cyan-500/40'
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-6">
          {active === 'users' && <UsersPanel />}
          {active === 'symbols' && <SymbolsPanel />}
          {active === 'teams' && <TeamsPanel />}
          {active === 'hours' && <HoursPanel />}
          {active === 'competitions' && <CompetitionsPanel />}
          {active === 'marketdata' && <MarketDataPanel />}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold text-white font-mono tracking-wide">{title}</h2>
      {subtitle && <p className="text-sm text-gray-400 font-mono">{subtitle}</p>}
    </div>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState<Array<{ id: string; email: string; name: string; is_admin: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await adminListUsers();
        setUsers(u);
      } catch (e: any) {
        setError(e?.message || 'Failed to load users');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleAdmin = async (id: string, checked: boolean) => {
    const prev = users;
    setUsers(users.map(u => (u.id === id ? { ...u, is_admin: checked } : u)));
    try {
      await adminSetUserAdmin(id, checked);
    } catch {
      setUsers(prev);
    }
  };

  if (loading) return <p className="text-gray-400 font-mono">Loading users…</p>;
  if (error) return <p className="text-red-400 font-mono">{error}</p>;

  return (
    <div>
      <SectionHeader title="Users" subtitle="Toggle admin access for users" />
      <div className="divide-y divide-gray-800">
        {users.map(u => (
          <div key={u.id} className="py-3 flex items-center justify-between">
            <div>
              <div className="text-white font-mono font-bold">{u.name}</div>
              <div className="text-gray-400 font-mono text-sm">{u.email}</div>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={u.is_admin}
                onChange={e => toggleAdmin(u.id, e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:bg-cyan-600 transition-all" />
              <span className="ml-3 text-sm font-mono text-gray-300">Admin</span>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function SymbolsPanel() {
  const [symbols, setSymbols] = useState<Array<{ symbol: string; name: string; trading_halted?: boolean; settlement_active?: boolean; settlement_price?: number | null }>>([]);
  const [form, setForm] = useState({ symbol: '', name: '', symbol_type: 'equity', tick_size: 0.01, lot_size: 1 });
  const [settlePrice, setSettlePrice] = useState<number>(0);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    // Prefer admin list for status, fallback to public list
    try {
      const rows = await adminListSymbols();
      setSymbols(rows);
      setError(null);
    } catch (e: any) {
      const s = await fetchSymbols();
      setSymbols(s.symbols);
      setError('Limited view: not authorized for admin symbol status');
    }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    try {
      setError(null);
      await adminCreateSymbol(form);
      setForm({ symbol: '', name: '', symbol_type: 'equity', tick_size: 0.01, lot_size: 1 });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to create symbol');
    }
  };
  const remove = async (symbol: string) => {
    try {
      setError(null);
      if (typeof window !== 'undefined') {
        try {
          // Only prompt if confirm is available; jsdom may not implement it
          const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')
          if (typeof window.confirm === 'function' && !isJsdom) {
            const ok = window.confirm(`Delete symbol ${symbol}? This cannot be undone.`);
            if (!ok) return;
          }
        } catch {
          // Ignore confirm errors in non-browser environments
        }
      }
      await adminDeleteSymbol(symbol);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete symbol');
    }
  };

  const pause = async (symbol?: string) => {
    try {
      setError(null);
      await adminPauseSymbols(symbol);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to pause');
    }
  };
  const start = async (symbol?: string) => {
    try {
      setError(null);
      await adminStartSymbols(symbol);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to start');
    }
  };
  const settle = async () => {
    if (!selectedSymbol || !settlePrice) return;
    try {
      setError(null);
      await adminSettleSymbol(selectedSymbol, settlePrice);
      setSettlePrice(0);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to settle');
    }
  };

  return (
    <div>
      <SectionHeader title="Symbols" subtitle="Create and delete tradable symbols" />
      {error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-900/30 text-red-300 px-3 py-2 font-mono text-sm">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => pause(undefined)} className="px-3 py-1.5 bg-red-900/50 border border-red-500/40 text-red-300 rounded font-mono">Pause All</button>
        <button onClick={() => start(undefined)} className="px-3 py-1.5 bg-emerald-900/50 border border-emerald-500/40 text-emerald-300 rounded font-mono">Start All</button>
        <div className="ml-auto flex items-center gap-2">
          <select className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" value={selectedSymbol} onChange={e => setSelectedSymbol(e.target.value)}>
            <option value="">Select symbol</option>
            {symbols.map(s => (<option key={s.symbol} value={s.symbol}>{s.symbol}</option>))}
          </select>
          <input type="number" step="0.01" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Settlement price" value={settlePrice || ''} onChange={e => setSettlePrice(Number(e.target.value))} />
          <button onClick={settle} className="px-3 py-1.5 bg-amber-900/50 border border-amber-500/40 text-amber-300 rounded font-mono">Settle</button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <input className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Symbol (e.g., AAPL)" value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
          <input className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="flex gap-2">
            <select className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" value={form.symbol_type} onChange={e => setForm({ ...form, symbol_type: e.target.value })}>
              <option value="equity">Equity</option>
              <option value="etf">ETF</option>
              <option value="option">Option</option>
            </select>
            <input type="number" step="0.01" className="w-32 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Tick" value={form.tick_size} onChange={e => setForm({ ...form, tick_size: Number(e.target.value) })} />
            <input type="number" className="w-24 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Lot" value={form.lot_size} onChange={e => setForm({ ...form, lot_size: Number(e.target.value) })} />
          </div>
          <button onClick={create} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded font-mono">Create Symbol</button>
        </div>
        <div className="space-y-2">
          {symbols.map(s => (
            <div key={s.symbol} className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-2 border border-gray-700">
              <div className="text-white font-mono font-bold">{s.symbol}</div>
              <div className="text-gray-400 font-mono flex-1 ml-4">{s.name}</div>
              <div className="flex items-center gap-2">
                {s.settlement_active ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-amber-900/50 border border-amber-500/40 text-amber-300">Settled @ {s.settlement_price?.toFixed(2)}</span>
                ) : s.trading_halted ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-red-900/50 border border-red-500/40 text-red-300">Paused</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-emerald-900/50 border border-emerald-500/40 text-emerald-300">Live</span>
                )}
                <button onClick={() => pause(s.symbol)} className="px-2 py-1 bg-red-900/50 border border-red-500/40 text-red-300 rounded font-mono text-xs">Pause</button>
                <button onClick={() => start(s.symbol)} className="px-2 py-1 bg-emerald-900/50 border border-emerald-500/40 text-emerald-300 rounded font-mono text-xs">Start</button>
                <button onClick={() => remove(s.symbol)} className="text-red-400 font-mono hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamsPanel() {
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState('');
  const load = async () => setTeams(await adminListTeams());
  useEffect(() => { load(); }, []);

  const create = async () => {
    await adminCreateTeam({ name });
    setName('');
    await load();
  };

  return (
    <div>
      <SectionHeader title="Teams" subtitle="Create teams and review existing" />
      <div className="flex gap-2 mb-4">
        <input className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Team name" value={name} onChange={e => setName(e.target.value)} />
        <button onClick={create} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded font-mono">Create</button>
      </div>
      <div className="grid gap-2">
        {teams.map(t => (
          <div key={t.id} className="bg-gray-800/50 border border-gray-700 rounded px-3 py-2 text-white font-mono">{t.name}</div>
        ))}
      </div>
    </div>
  );
}

function HoursPanel() {
  const [rows, setRows] = useState<Array<{ id: string; symbol: string; day_of_week: number; open_time: string; close_time: string; is_active: boolean }>>([]);
  useEffect(() => { (async () => setRows(await adminListHours()))(); }, []);

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div>
      <SectionHeader title="Trading Hours" subtitle="Review configured market hours" />
      <div className="overflow-x-auto">
        <table className="min-w-full text-left font-mono text-sm">
          <thead className="text-gray-400">
            <tr>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Day</th>
              <th className="px-3 py-2">Open</th>
              <th className="px-3 py-2">Close</th>
              <th className="px-3 py-2">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 text-white">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.symbol}</td>
                <td className="px-3 py-2">{days[(r.day_of_week - 1 + 7) % 7]}</td>
                <td className="px-3 py-2">{r.open_time}</td>
                <td className="px-3 py-2">{r.close_time}</td>
                <td className="px-3 py-2">{r.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompetitionsPanel() {
  const [rows, setRows] = useState<Array<{ id: string; name: string; start_time: string; end_time: string; is_active: boolean }>>([]);
  const [form, setForm] = useState({ name: '', start_time: '', end_time: '', is_active: false });
  const load = async () => setRows(await adminListCompetitions());
  useEffect(() => { load(); }, []);

  const create = async () => {
    await adminCreateCompetition(form);
    setForm({ name: '', start_time: '', end_time: '', is_active: false });
    await load();
  };

  return (
    <div>
      <SectionHeader title="Competitions" subtitle="Create and review competitions" />
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <input className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input type="datetime-local" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
          <input type="datetime-local" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} />
          <label className="inline-flex items-center gap-2 text-gray-300 font-mono">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> Active
          </label>
          <button onClick={create} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded font-mono">Create Competition</button>
        </div>
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="bg-gray-800/50 border border-gray-700 rounded px-3 py-2 text-white font-mono">
              <div className="font-bold text-cyan-400">{r.name}</div>
              <div className="text-gray-400 text-sm">{new Date(r.start_time).toLocaleString()} → {new Date(r.end_time).toLocaleString()}</div>
              <div className="text-sm">{r.is_active ? 'Active' : 'Inactive'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MarketDataPanel() {
  const [symbols, setSymbols] = useState<Array<{ symbol: string; name: string }>>([]);
  const [symbol, setSymbol] = useState('');
  const [close, setClose] = useState<number>(0);
  useEffect(() => { (async () => setSymbols((await fetchSymbols()).symbols))(); }, []);

  const upsert = async () => {
    await adminUpsertMarketData({ symbol, close });
    setClose(0);
  };

  return (
    <div>
      <SectionHeader title="Market Data" subtitle="Seed or update close price for charts" />
      <div className="flex gap-2 items-center">
        <select className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" value={symbol} onChange={e => setSymbol(e.target.value)}>
          <option value="">Select symbol</option>
          {symbols.map(s => (<option key={s.symbol} value={s.symbol}>{s.symbol}</option>))}
        </select>
        <input type="number" step="0.01" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Close price" value={close || ''} onChange={e => setClose(Number(e.target.value))} />
        <button onClick={upsert} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded font-mono">Upsert</button>
      </div>
    </div>
  );
}
