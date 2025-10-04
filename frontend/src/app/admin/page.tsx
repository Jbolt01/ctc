"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  adminListUsers,
  adminSetUserAdmin,
  adminDisableUser,
  adminEnableUser,
  adminDeleteUser,
  adminListTeams,
  adminCreateTeam,
  adminListAllowedEmails,
  adminAddAllowedEmail,
  adminDeleteAllowedEmail,
  adminCreateSymbol,
  adminDeleteSymbol,
  adminPauseSymbols,
  adminStartSymbols,
  adminSettleSymbol,
  adminListSymbols,
  adminListLimits,
  adminCreateLimit,
  fetchSymbols,
} from '../../lib/api';

type TabKey = 'users' | 'symbols' | 'teams' | 'emails';

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
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                try {
                  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')
                  if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !isJsdom) {
                    if (!window.confirm('Reset exchange? This deletes ALL symbols, orders, trades, positions, limits, hours, and market data.')) return
                  }
                  const { adminResetExchange } = await import('../../lib/api')
                  await adminResetExchange()
                  // reload page state
                  window.location.reload()
                } catch (e) {
                  console.error(e)
                }
              }}
              className="px-3 py-1.5 border border-amber-500/40 text-amber-300 rounded font-mono bg-amber-900/30 hover:bg-amber-900/50"
              title="Delete ALL exchange data"
            >Reset Exchange</button>
            <button
              onClick={async () => {
                try {
                  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')
                  if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !isJsdom) {
                    if (!window.confirm('Reset users? This deletes ALL users, teams, API keys, competitions, and team links.')) return
                  }
                  const { adminResetUsers } = await import('../../lib/api')
                  await adminResetUsers()
                  window.location.reload()
                } catch (e) {
                  console.error(e)
                }
              }}
              className="px-3 py-1.5 border border-red-500/40 text-red-300 rounded font-mono bg-red-900/30 hover:bg-red-900/50"
              title="Delete ALL users/teams"
            >Reset Users</button>
            <Link href="/trading/equities" className="text-cyan-400 font-mono hover:underline">Back to Trading</Link>
          </div>
        </header>

        <nav className="flex gap-2 mb-6">
          {(
            [
              ['users', 'Users'],
              ['symbols', 'Symbols'],
              ['teams', 'Teams'],
              ['emails', 'Emails'],
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
          {active === 'emails' && <EmailsPanel />}
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

function EmailsPanel() {
  const [emails, setEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const e = await adminListAllowedEmails();
      setEmails(e);
    } catch (e: any) {
      setError(e?.message || 'Failed to load emails');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addEmail = async () => {
    if (!newEmail) return;
    try {
      await adminAddAllowedEmail(newEmail);
      setNewEmail('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to add email');
    }
  };

  const removeEmail = async (email: string) => {
    try {
      await adminDeleteAllowedEmail(email);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to remove email');
    }
  };

  const filteredEmails = useMemo(() => {
    return emails.filter(email => email.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [emails, searchTerm]);

  if (loading) return <p className="text-gray-400 font-mono">Loading emails…</p>;
  if (error) return <p className="text-red-400 font-mono">{error}</p>;

  return (
    <div>
      <SectionHeader title="Allowed Emails" subtitle="Manage registration whitelist" />
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono"
          placeholder="Search emails..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono"
          placeholder="new.email@example.com"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
        />
        <button onClick={addEmail} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded font-mono">Add</button>
      </div>
      <div className="divide-y divide-gray-800">
        {filteredEmails.map(email => (
          <div key={email} className="py-3 flex items-center justify-between">
            <div className="text-white font-mono">{email}</div>
            <button onClick={() => removeEmail(email)} className="text-red-400 font-mono hover:underline">Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState<Array<{ id: string; email: string; name: string; is_admin: boolean; team_name: string | null; is_disabled: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const loadUsers = async () => {
    try {
      const u = await adminListUsers();
      setUsers(u);
    } catch (e: any) {
      setError(e?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
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

  const disableUser = async (id: string) => {
    await adminDisableUser(id);
    await loadUsers();
  };

  const enableUser = async (id: string) => {
    await adminEnableUser(id);
    await loadUsers();
  };

  const deleteUser = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      await adminDeleteUser(id);
      await loadUsers();
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter(user =>
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [users, searchTerm]);

  if (loading) return <p className="text-gray-400 font-mono">Loading users…</p>;
  if (error) return <p className="text-red-400 font-mono">{error}</p>;

  return (
    <div>
      <SectionHeader title="Users" subtitle="Toggle admin access for users" />
      <div className="mb-4">
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono"
          placeholder="Search by name or email..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="divide-y divide-gray-800">
        {filteredUsers.map(u => (
          <div key={u.id} className="py-3 flex items-center justify-between">
            <div>
              <div className="text-white font-mono font-bold">{u.name}</div>
              <div className="text-gray-400 font-mono text-sm">{u.email}</div>
              <div className="text-gray-500 font-mono text-xs">{u.team_name}</div>
            </div>
            <div className="flex items-center gap-4">
              {u.is_disabled && <span className="text-red-400 font-mono text-xs">Disabled</span>}
              <button onClick={() => u.is_disabled ? enableUser(u.id) : disableUser(u.id)} className="text-xs font-mono text-yellow-400 hover:underline">
                {u.is_disabled ? 'Enable' : 'Disable'}
              </button>
              <button onClick={() => deleteUser(u.id)} className="text-xs font-mono text-red-400 hover:underline">Delete</button>
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
          </div>
        ))}
      </div>
    </div>
  );
}

function SymbolsPanel() {
  const [symbols, setSymbols] = useState<Array<{ symbol: string; name: string; trading_halted?: boolean; settlement_active?: boolean; settlement_price?: number | null }>>([]);
  const [limits, setLimits] = useState<any[]>([]);
  const [form, setForm] = useState({ symbol: '', name: '', symbol_type: 'equity', tick_size: 0.01, lot_size: 1 });
  const [error, setError] = useState<string | null>(null);

  // State for settlement
  const [settleSymbol, setSettleSymbol] = useState('');
  const [settlePrice, setSettlePrice] = useState<number>(0);

  // State for limits
  const [limitSymbol, setLimitSymbol] = useState('');
  const [maxPos, setMaxPos] = useState<number>(0);
  const [maxOrder, setMaxOrder] = useState<number>(0);

  const load = async () => {
    try {
      const rows = await adminListSymbols();
      setSymbols(rows);
      setLimits(await adminListLimits());
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
          const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
          if (typeof window.confirm === 'function' && !isJsdom) {
            if (!window.confirm(`Delete symbol ${symbol}? This cannot be undone.`)) return;
          }
        } catch {}
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
    if (!settleSymbol || !settlePrice) return;
    try {
      setError(null);
      await adminSettleSymbol(settleSymbol, settlePrice);
      setSettlePrice(0);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to settle');
    }
  };

  const setLimit = async () => {
    if (!limitSymbol || !maxPos) return;
    try {
      setError(null);
      const payload: { symbol: string; max_position: number; max_order_size?: number; applies_to_admin: boolean } = {
        symbol: limitSymbol,
        max_position: maxPos,
        applies_to_admin: false,
      };
      if (maxOrder > 0) {
        payload.max_order_size = maxOrder;
      }
      await adminCreateLimit(payload);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to set limit');
    }
  };

  return (
    <div>
      <SectionHeader title="Symbols" subtitle="Create/delete symbols and manage trading controls" />
      {error && <div className="mb-3 rounded border border-red-500/40 bg-red-900/30 text-red-300 px-3 py-2 font-mono text-sm">{error}</div>}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => pause(undefined)} className="px-3 py-1.5 bg-red-900/50 border border-red-500/40 text-red-300 rounded font-mono">Pause All</button>
        <button onClick={() => start(undefined)} className="px-3 py-1.5 bg-emerald-900/50 border border-emerald-500/40 text-emerald-300 rounded font-mono">Start All</button>
      </div>
      <div className="grid grid-cols-1 gap-4 mb-6 p-4 border border-gray-800 rounded-lg">
        <div className="flex items-center gap-2">
          <select aria-label="Select symbol to settle" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono w-full" value={settleSymbol} onChange={e => setSettleSymbol(e.target.value)}>
            <option value="">Select symbol to settle</option>
            {symbols.map(s => (<option key={s.symbol} value={s.symbol}>{s.symbol}</option>))}
          </select>
          <input type="number" step="0.01" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Settlement price" value={settlePrice || ''} onChange={e => setSettlePrice(Number(e.target.value))} />
          <button onClick={settle} className="px-3 py-1.5 bg-amber-900/50 border border-amber-500/40 text-amber-300 rounded font-mono whitespace-nowrap">Settle</button>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Select symbol to limit" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono w-full" value={limitSymbol} onChange={e => setLimitSymbol(e.target.value)}>
            <option value="">Select symbol to limit</option>
            {symbols.map(s => (<option key={s.symbol} value={s.symbol}>{s.symbol}</option>))}
          </select>
          <input type="number" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Max Position" value={maxPos || ''} onChange={e => setMaxPos(Number(e.target.value))} />
          <input type="number" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Max Order (optional)" value={maxOrder || ''} onChange={e => setMaxOrder(Number(e.target.value))} />
          <button onClick={setLimit} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded font-mono whitespace-nowrap">Set Limit</button>
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
          {symbols.map(s => {
            const limit = limits.find(l => l.symbol === s.symbol);
            return (
              <div key={s.symbol} className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-2 border border-gray-700">
                <div className="text-white font-mono font-bold">{s.symbol}</div>
                <div className="text-gray-400 font-mono flex-1 ml-4">{s.name}</div>
                {limit && <div className="text-gray-500 font-mono text-xs mr-2">Limit: {limit.max_position}</div>}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TeamsPanel() {
  const [teams, setTeams] = useState<Array<{ id: string; name: string; join_code?: string; member_count: number }>>([]);
  const [name, setName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const load = async () => setTeams(await adminListTeams());
  useEffect(() => { load(); }, []);

  const create = async () => {
    await adminCreateTeam({ name });
    setName('');
    await load();
  };

  const filteredTeams = useMemo(() => {
    return teams.filter(team => team.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [teams, searchTerm]);

  return (
    <div>
      <SectionHeader title="Teams" subtitle="Create teams and review existing" />
      <div className="mb-4">
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono"
          placeholder="Search by name..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="flex gap-2 mb-4">
        <input className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono" placeholder="Team name" value={name} onChange={e => setName(e.target.value)} />
        <button onClick={create} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded font-mono">Create</button>
      </div>
      <div className="grid gap-2">
        {filteredTeams.map(t => (
          <div key={t.id} className="bg-gray-800/50 border border-gray-700 rounded px-3 py-2 text-white font-mono flex items-center justify-between">
            <Link href={`/admin/teams/${t.id}`} className="font-bold hover:underline">{t.name}</Link>
            <div className="text-xs text-gray-400">{t.member_count} members</div>
            {t.join_code && (
              <div className="text-xs text-cyan-300">
                Join code: <span className="font-mono tracking-wider">{t.join_code}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
