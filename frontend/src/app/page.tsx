"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import GoogleAuthButton from '../components/GoogleAuthButton';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const apiKey = localStorage.getItem('apiKey');
    const user = localStorage.getItem('user');
    if (apiKey && user) {
      router.push('/trading/equities');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black flex items-center justify-center px-6">
      <div className="w-full max-w-xl text-center space-y-8">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            Cornell Trading Competition
          </span>
        </h1>
        <p className="text-gray-400 font-mono">
          Sign in to access the Systematic Equities trading terminal.
        </p>
        <div className="flex items-center justify-center">
          <GoogleAuthButton onSignedIn={() => router.push('/trading/equities')} />
        </div>
      </div>
    </div>
  );
}
