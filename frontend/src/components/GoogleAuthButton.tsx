"use client";

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';

type GoogleCredentialResponse = { credential?: string };

function decodeJwtPayload(token: string): any {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default function GoogleAuthButton({ onSignedIn }: { onSignedIn: () => void }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const [ready, setReady] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);

  const handleCredential = useCallback(async (resp: GoogleCredentialResponse) => {
    if (!resp.credential) return;
    const payload = decodeJwtPayload(resp.credential);
    if (!payload) return;

    const openid_sub = payload.sub as string;
    const email = (payload.email ?? '') as string;
    const name = (payload.name ?? email.split('@')[0]) as string;

    // Try login first; if not found, register
    const headers = { 'Content-Type': 'application/json' };
    let res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id_token: resp.credential, openid_sub, email, name }),
    });
    if (res.status === 401) {
      res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id_token: resp.credential, openid_sub, email, name }),
      });
    }
    if (!res.ok) return;
    const data = await res.json();

    // Persist session locally like existing app conventions
    localStorage.setItem('apiKey', data.api_key);
    localStorage.setItem('user', JSON.stringify(data.user));
    localStorage.setItem('teams', JSON.stringify(data.teams ?? []));
    onSignedIn();
  }, [onSignedIn]);

  useEffect(() => {
    if (!ready || !clientId || !btnRef.current) return;
    const w = window as any;
    if (!w.google?.accounts?.id) return;
    w.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential });
    w.google.accounts.id.renderButton(btnRef.current, {
      theme: 'outline',
      size: 'large',
      type: 'standard',
      shape: 'pill',
      text: 'signin_with',
      logo_alignment: 'left',
    });
  }, [ready, clientId, handleCredential]);

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" async defer onLoad={() => setReady(true)} />
      <div ref={btnRef} />
    </>
  );
}
