"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const links = [
  { href: '/' as const, label: 'Home' },
  { href: '/dashboard' as const, label: 'Dashboard' },
  { href: '/trading/equities' as const, label: 'Equities' },
  { href: '/portfolio' as const, label: 'Portfolio' },
  { href: '/admin/symbols' as const, label: 'Admin' },
  { href: '/docs' as const, label: 'Docs' },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-50 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold text-brand-700">
          Cornell Trading Competition
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'rounded-md px-3 py-2 transition-all hover:bg-gray-100 hover:text-brand-700',
                pathname === href && 'bg-gray-100 text-brand-700'
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

