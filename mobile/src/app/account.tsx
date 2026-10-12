// Your anonymous account: posting credits and plan. Pro is bought on the website
// (Stripe Checkout) in the system browser; see mobile/README.md for the store rules.
import { useFocusEffect } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../components/theme'
import type { Account } from '../lib/api'
import { API_URL, api } from '../lib/client'
import { VOTES_PER_CREDIT } from '../lib/limits'

export default function AccountScreen() {
  const [me, setMe] = useState<{ account: Account; plan: 'free' | 'pro' } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      api.account().then(setMe, (e) => setError(e instanceof Error ? e.message : 'Could not load your account'))
    }, []),
  )

  return (
    <View style={styles.page}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {me ? (
        <View style={styles.card}>
          <Text style={styles.big}>{me.account.credits}</Text>
          <Text style={styles.muted}>public poll credit{me.account.credits === 1 ? '' : 's'}</Text>
          <Text style={styles.line}>
            {me.account.countedVotes} votes cast · {me.account.publicPolls} public polls posted
          </Text>
          <Text style={styles.muted}>
            Every {VOTES_PER_CREDIT} votes on other people's polls earn one public poll. {me.account.votesToNextCredit} to go.
          </Text>
          <Text style={styles.line}>Plan: {me.plan === 'pro' ? 'Pro' : 'Free'}</Text>
        </View>
      ) : null}
      {me && me.plan !== 'pro' ? (
        <Pressable style={styles.primary} onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/pro`)} accessibilityRole="button">
          <Text style={styles.primaryText}>Get Pro on the website</Text>
        </Pressable>
      ) : null}
      <Text style={styles.small}>
        Your account lives on this device with no sign-up. Deleting the app starts a new one.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20, gap: 6, alignItems: 'center' },
  big: { fontSize: 48, fontWeight: '800', color: colors.text },
  line: { color: colors.text, marginTop: 8 },
  muted: { color: colors.muted, textAlign: 'center' },
  small: { color: colors.muted, textAlign: 'center', fontSize: 13 },
  error: { color: colors.danger },
  primary: { backgroundColor: colors.text, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 17 },
})
