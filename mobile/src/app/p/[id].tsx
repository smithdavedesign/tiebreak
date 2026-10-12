// One poll, opened from the feed, a share link (tiebreak://p/<id>) or right after
// creating it. Vote, see the result once it closes, share it or report it.
import { Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text } from 'react-native'
import { PollCard } from '../../components/PollCard'
import { colors } from '../../components/theme'
import type { Poll } from '../../lib/api'
import { API_URL, api } from '../../lib/client'
import { shareUrl } from '../../lib/links'

export default function PollScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>()
  const [poll, setPoll] = useState<Poll | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setPoll(await api.poll(id))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this poll')
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const vote = async (option: number) => {
    setBusy(true)
    try {
      setPoll((await api.vote(id, option)).poll)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vote failed')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const share = () => Share.share({ message: `${poll?.question || 'Help me decide'} ${shareUrl(API_URL, id)}` })

  const report = () =>
    Alert.alert('Report this poll?', 'Polls reported by 3 people are hidden from the feed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.report(id)
            Alert.alert('Reported', 'Thanks for flagging it.')
          } catch (e) {
            Alert.alert('Could not report', e instanceof Error ? e.message : '')
          }
        },
      },
    ])

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: poll?.mine ? 'Your poll' : 'Poll' }} />
      {created ? <Text style={styles.created}>Poll created. Share it so people can vote.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!poll && !error ? <ActivityIndicator style={{ marginTop: 40 }} /> : null}
      {poll ? <PollCard poll={poll} busy={busy} onVote={vote} /> : null}
      {poll ? (
        <Pressable style={styles.primary} onPress={share} accessibilityRole="button">
          <Text style={styles.primaryText}>Share link</Text>
        </Pressable>
      ) : null}
      {poll && !poll.mine ? (
        <Pressable onPress={report} accessibilityRole="button">
          <Text style={styles.report}>Report</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  created: { color: colors.win, fontWeight: '600' },
  error: { color: colors.danger },
  primary: { backgroundColor: colors.text, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  report: { color: colors.muted, textAlign: 'center', textDecorationLine: 'underline' },
})
