// The browser build of client.ts (Metro picks .web.ts on web), for previewing the app
// without a phone: `npx expo start --web`. The voter id lives in localStorage, and in
// development requests go through the dev server's /live-api proxy (metro.config.js),
// because the live API doesn't send CORS headers to other origins.
import Constants from 'expo-constants'
import { createApi, type VoterStore } from './api'

export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'https://tiebreak-phi.vercel.app'

const KEY = 'tiebreak.voter'

const browserVoter: VoterStore = {
  get: async () => {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  },
  set: async (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Private windows can refuse storage; the next write mints a new id.
    }
  },
}

export const api = createApi(__DEV__ ? `${window.location.origin}/live-api` : API_URL, browserVoter)
