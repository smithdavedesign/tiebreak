// The app's API client: the deployed API (app.json → expo.extra.apiUrl) with the
// voter id kept in the device's secure storage (Keychain on iOS, Keystore on Android).
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { createApi, type VoterStore } from './api'

export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'https://tiebreak-phi.vercel.app'

const KEY = 'tiebreak.voter'

const secureVoter: VoterStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (id) => SecureStore.setItemAsync(KEY, id),
}

export const api = createApi(API_URL, secureVoter)
