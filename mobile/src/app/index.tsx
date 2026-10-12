// The feed: public polls you haven't voted on, one card at a time. Swipe (or tap) to
// vote and the next one comes up. Votes on other people's polls earn posting credits.
import { Link, Stack, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { PollCard } from '../components/PollCard'
import { colors } from '../components/theme'
import { ApiError, type Account, type Poll } from '../lib/api'
import { api } from '../lib/client'

export default function Feed() {
  const [polls, setPolls] = useState<Poll[] | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [feed, me] = await Promise.all([api.feed(), api.account()])
      setPolls(feed.filter((p) => p.status === 'open' && p.myVote === null && !p.mine))
      setAccount(me.account)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the feed')
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const vote = async (poll: Poll, option: number) => {
    setBusy(true)
    try {
      const result = await api.vote(poll.id, option)
      setAccount(result.account)
    } catch (e) {
      // 409 (already voted) or 410 (just closed): either way, move on
      if (!(e instanceof ApiError && (e.status === 409 || e.status === 410))) setError(e instanceof Error ? e.message : 'Vote failed')
    } finally {
      setPolls((list) => (list ? list.filter((p) => p.id !== poll.id) : list))
      setBusy(false)
    }
  }

  const current = polls?.[0]
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true)
            await load()
            setRefreshing(false)
          }}
        />
      }
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/account" asChild>
              <Pressable accessibilityRole="button">
                <Text style={styles.headerLink}>{account ? `${account.credits} credit${account.credits === 1 ? '' : 's'}` : 'You'}</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {polls === null && !error ? <ActivityIndicator style={{ marginTop: 40 }} /> : null}
      {current ? (
        <PollCard key={current.id} poll={current} busy={busy} onVote={(option) => vote(current, option)} />
      ) : polls ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.muted}>Pull down to check for new polls, or post your own.</Text>
        </View>
      ) : null}
      {account ? (
        <Text style={styles.muted}>
          {account.credits > 0
            ? `You can post ${account.credits} public poll${account.credits === 1 ? '' : 's'}.`
            : `Vote on ${account.votesToNextCredit} more to post a public poll.`}
        </Text>
      ) : null}
      <Link href="/new" asChild>
        <Pressable style={styles.primary} accessibilityRole="button">
          <Text style={styles.primaryText}>Ask a question</Text>
        </Pressable>
      </Link>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, flexGrow: 1 },
  headerLink: { color: colors.b, fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger },
  empty: { backgroundColor: colors.card, borderRadius: 20, padding: 24, gap: 6 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, textAlign: 'center' },
  primary: { backgroundColor: colors.text, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 17 },
})
