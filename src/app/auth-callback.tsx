import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';

/**
 * Landing route for the OAuth deep-link redirect (`pawpawkomobile://auth-callback`,
 * see src/lib/discord-auth.ts). WebBrowser.openAuthSessionAsync hands the tokens
 * back to the caller, but the system also delivers the redirect deep link to the
 * running app — without this route expo-router shows "Unmatched Route". By the
 * time we render, setSession has run, so route by auth state (mirrors index.tsx).
 * AuthGate in _layout.tsx still owns the real gating.
 */
export default function AuthCallback() {
  const { session, loading } = useAuth();
  if (loading) return null;
  return <Redirect href={session ? '/trades' : '/sign-in'} />;
}
