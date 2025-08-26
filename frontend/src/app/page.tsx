import Link from 'next/link';
import NavBar from '../components/NavBar';

export default function HomePage() {
  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-7xl px-4 py-10">
        <div className="mb-8 rounded-2xl bg-gradient-to-br from-brand-50 to-white p-8 ring-1 ring-gray-200">
          <h1 className="mb-2 text-3xl font-semibold tracking-tight text-gray-900">Cornell Trading Competition</h1>
          <p className="text-gray-600">Welcome. Use the navigation to explore.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: '/dashboard' as const, title: 'Dashboard', desc: 'Competition overview and metrics' },
            { href: '/trading/equities' as const, title: 'Equities Trading', desc: 'Place and manage orders' },
            { href: '/portfolio' as const, title: 'Portfolio', desc: 'Positions, PnL, and risk' },
            { href: '/admin/symbols' as const, title: 'Admin', desc: 'Manage symbols, limits, and hours' },
            { href: '/docs' as const, title: 'Docs', desc: 'API and platform documentation' },
          ].map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="rounded-xl border p-5 ring-1 ring-gray-200 transition hover:shadow-md"
            >
              <div className="mb-2 text-lg font-medium text-gray-900">{c.title}</div>
              <div className="text-sm text-gray-600">{c.desc}</div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}

