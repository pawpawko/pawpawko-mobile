import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';

/**
 * Root route for `/` (and the bare `pawpawkomobile:///` deep link). Without it
 * expo-router has no match for `/` and shows "Unmatched Route". AuthGate in
 * _layout.tsx still owns the real redirect rules; this just sends the initial
 * `/` hit to the right place so it never lands on the not-found screen.
 */
export default function Index() {
  const { session, loading } = useAuth();
  // AuthGate renders the DiceLoader while auth is resolving, so hold here.
  if (loading) return null;
  return <Redirect href={session ? '/trades' : '/sign-in'} />;
}
