import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URL = Linking.createURL('auth-callback');

export type DiscordSignInResult = 'success' | 'cancelled';

export async function signInWithDiscord(): Promise<DiscordSignInResult> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo: REDIRECT_URL,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('No auth URL returned from Supabase');

  const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
  if (result.type === 'cancel' || result.type === 'dismiss') return 'cancelled';
  if (result.type !== 'success') throw new Error('Discord auth was not completed');

  // Supabase redirects back with tokens in the URL fragment (#access_token=...).
  const fragment = result.url.split('#')[1];
  if (!fragment) throw new Error('No auth fragment in redirect URL');
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) throw new Error('Missing tokens in redirect');

  const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
  if (setErr) throw setErr;
  return 'success';
}
