"use client";
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
// Lazy-load admin API to probe admin status when mounted
// Avoid import cycles at module init

interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

interface Team {
  id: string;
  name: string;
  role: string;
}

const EQUITIES_ROUTE = '/trading/equities' as const;

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    const teamsData = localStorage.getItem('teams');
    
    if (userData) {
      setUser(JSON.parse(userData));
    }
    if (teamsData) {
      setTeams(JSON.parse(teamsData));
    }
  }, []);

  // Probe admin access by calling an admin-protected endpoint
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiKey = localStorage.getItem('apiKey');
        if (!apiKey) return;
        const mod = await import('../lib/api');
        await mod.adminListUsers();
        if (!cancelled) setIsAdmin(true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('teams');
    localStorage.removeItem('apiKey');
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-gray-800/50 bg-gray-900/90 backdrop-blur-md supports-[backdrop-filter]:bg-gray-900/80 shadow-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-bold text-xl font-mono tracking-wide">
          <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            CTC TRADING
          </span>
        </Link>
        
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href={EQUITIES_ROUTE}
              className={clsx(
                'rounded-lg px-4 py-2 font-mono font-medium transition-all duration-200 hover:bg-gray-800/60 hover:text-cyan-400 border border-transparent hover:border-gray-700/50',
                pathname === EQUITIES_ROUTE
                  ? 'bg-cyan-900/30 text-cyan-400 border-cyan-500/50 shadow-lg shadow-cyan-500/10'
                  : 'text-gray-300 hover:shadow-lg hover:shadow-gray-800/20'
              )}
            >
              Equities
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className={clsx(
                  'rounded-lg px-4 py-2 font-mono font-medium transition-all duration-200 hover:bg-gray-800/60 hover:text-amber-300 border border-transparent hover:border-gray-700/50',
                  pathname === '/admin'
                    ? 'bg-amber-900/30 text-amber-300 border-amber-500/50 shadow-lg shadow-amber-500/10'
                    : 'text-gray-300 hover:shadow-lg hover:shadow-gray-800/20'
                )}
                title="Admin Console"
              >
                Admin
              </Link>
            )}
          </nav>

          {user ? (
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center space-x-2 bg-gray-800/60 hover:bg-gray-700/60 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 border border-gray-700/50"
              >
                <span>{user.name}</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {showDropdown && (
                <div className="absolute right-0 mt-2 w-64 bg-gray-800 rounded-lg shadow-xl py-2 z-10 border border-gray-700/50">
                  <div className="px-4 py-3 text-sm text-gray-300 border-b border-gray-700/50">
                    <div className="font-medium text-white">{user.name}</div>
                    <div className="text-xs text-gray-400">{user.email}</div>
                  </div>
                  
                  {teams.length > 0 && (
                    <div className="px-4 py-2 border-b border-gray-700/50">
                      <div className="text-xs text-gray-400 mb-1">Teams:</div>
                      {teams.map((team) => (
                        <div key={team.id} className="text-sm text-gray-300">
                          {team.name} <span className="text-cyan-400">({team.role})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <button
                    onClick={handleLogout}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700/60 hover:text-white transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/"
              className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
