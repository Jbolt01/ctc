'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Check if user is authenticated
    const apiKey = localStorage.getItem('apiKey');
    const user = localStorage.getItem('user');
    
    if (apiKey && user) {
      // Redirect to trading if authenticated
      router.push('/trading/equities');
    } else {
      // Redirect to register if not authenticated
      router.push('/register');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto"></div>
        <p className="text-slate-400 mt-4">Loading...</p>
      </div>
    </div>
  );
}