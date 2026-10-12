// Create a poll: 2–4 options (text and/or an https image link), how many votes
// decide it, how long it stays open, and who can find it.
import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors } from '../components/theme'
import type { Visibility } from '../lib/api'
import { api } from '../lib/client'
import { MAX_OPTIONS, OPTION_LETTERS } from '../lib/limits'
import { toNewPoll, type Draft } from '../lib/validate'

const VISIBILITY: { value: Visibility; label: string; hint: string }[] = [
  { value: 'unlisted', label: 'Link only', hint: 'Free. Only people you send the link to can vote.' },
  { value: 'public', label: 'Public feed', hint: 'Uses 1 posting credit. Strangers vote too.' },
  { value: 'private', label: 'Private', hint: 'Pro. Only you see the result.' },
]

export default function NewPoll() {
  const [draft, setDraft] = useState<Draft>({
    question: '',
    options: [
      { text: '', imageUrl: '' },
      { text: '', imageUrl: '' },
    ],
    target: '10',
    durationHours: '24',
    visibility: 'unlisted',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setOption = (i: number, field: 'text' | 'imageUrl', value: string) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? { ...o, [field]: value } : o)) }))

  const submit = async () => {
    const parsed = toNewPoll(draft)
    if (!parsed.ok) return setError(parsed.error)
    setBusy(true)
    setError(null)
    try {
      const { id } = await api.create(parsed.value)
      router.replace({ pathname: '/p/[id]', params: { id, created: '1' } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the poll')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Question (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Which one should I pick?"
          value={draft.question}
          onChangeText={(question) => setDraft((d) => ({ ...d, question }))}
          maxLength={140}
        />
        {draft.options.map((o, i) => (
          <View key={i} style={styles.option}>
            <Text style={styles.label}>Option {OPTION_LETTERS[i]}</Text>
            <TextInput style={styles.input} placeholder="Text" value={o.text} onChangeText={(t) => setOption(i, 'text', t)} maxLength={80} />
            <TextInput
              style={styles.input}
              placeholder="Image link (https://…), optional"
              value={o.imageUrl}
              onChangeText={(t) => setOption(i, 'imageUrl', t)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
        ))}
        {draft.options.length < MAX_OPTIONS ? (
          <Pressable onPress={() => setDraft((d) => ({ ...d, options: [...d.options, { text: '', imageUrl: '' }] }))} accessibilityRole="button">
            <Text style={styles.link}>+ Add an option</Text>
          </Pressable>
        ) : null}
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Votes to decide</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={draft.target} onChangeText={(target) => setDraft((d) => ({ ...d, target }))} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Hours open</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={draft.durationHours}
              onChangeText={(durationHours) => setDraft((d) => ({ ...d, durationHours }))}
            />
          </View>
        </View>
        <Text style={styles.label}>Who can vote</Text>
        {VISIBILITY.map((v) => (
          <Pressable
            key={v.value}
            onPress={() => setDraft((d) => ({ ...d, visibility: v.value }))}
            style={[styles.choice, draft.visibility === v.value && styles.choiceOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: draft.visibility === v.value }}
          >
            <Text style={styles.choiceLabel}>{v.label}</Text>
            <Text style={styles.muted}>{v.hint}</Text>
          </Pressable>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={[styles.primary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} accessibilityRole="button">
          <Text style={styles.primaryText}>{busy ? 'Creating…' : 'Create poll'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10 },
  label: { fontWeight: '600', color: colors.text, marginTop: 6 },
  input: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12, fontSize: 16 },
  option: { gap: 6 },
  row: { flexDirection: 'row', gap: 12 },
  link: { color: colors.b, fontWeight: '600', paddingVertical: 6 },
  choice: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 2 },
  choiceOn: { borderColor: colors.text, borderWidth: 2 },
  choiceLabel: { fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  error: { color: colors.danger },
  primary: { backgroundColor: colors.text, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 17 },
})
