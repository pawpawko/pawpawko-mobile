import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

import { supabase } from './supabase';

const WEB_CLIENT_ID = '132449239636-bhjt27oc0229fch8ba7shbbha8lkhcuf.apps.googleusercontent.com';
const IOS_CLIENT_ID = '132449239636-prjaaehu0und1bpts6btsml7akujp4nr.apps.googleusercontent.com';

let configured = false;

function ensureConfigured() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
  });
  configured = true;
}

export type GoogleSignInResult = 'success' | 'cancelled' | 'in-progress' | 'play-services-unavailable';

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  ensureConfigured();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();
    const idToken = result.data?.idToken;
    if (!idToken) throw new Error('No id_token returned from Google');
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error) throw error;
    return 'success';
  } catch (e: any) {
    if (e?.code === statusCodes.SIGN_IN_CANCELLED) return 'cancelled';
    if (e?.code === statusCodes.IN_PROGRESS) return 'in-progress';
    if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return 'play-services-unavailable';
    throw e;
  }
}
