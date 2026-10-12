// One poll: the question and options, voting (swipe for two options, buttons for
// three or four), and the result once the poll has closed.
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Poll } from '../lib/api'
import { OPTION_LETTERS } from '../lib/limits'
import { canSwipe } from '../lib/swipe'
import { SwipeCard } from './SwipeCard'
import { colors } from './theme'

const optionColor = (i: number) => (i === 0 ? colors.a : i === 1 ? colors.b : colors.text)

function OptionView({ poll, index }: { poll: Poll; index: number }) {
  const option = poll.options[index]
  const isWinner = poll.status === 'closed' && poll.winner === index
  return (
    <View style={[styles.option, isWinner && styles.winner]}>
      <Text style={[styles.letter, { color: optionColor(index) }]}>{OPTION_LETTERS[index]}</Text>
      {option.imageUrl ? <Image source={{ uri: option.imageUrl }} style={styles.image} resizeMode="cover" /> : null}
      {option.text ? <Text style={styles.optionText}>{option.text}</Text> : null}
      {poll.tally ? (
        <Text style={styles.count}>
          {poll.tally[index]} vote{poll.tally[index] === 1 ? '' : 's'}
          {isWinner ? ' · winner' : ''}
        </Text>
      ) : null}
      {poll.myVote === index ? <Text style={styles.mine}>your vote</Text> : null}
    </View>
  )
}

export function statusLine(poll: Poll): string {
  if (poll.status === 'no_result') return 'Closed with no votes'
  if (poll.status === 'closed') return poll.winner === null ? `Closed: a tie after ${poll.voteCount} votes` : `Closed after ${poll.voteCount} votes`
  return `${poll.voteCount} of ${poll.target} votes · closes ${new Date(poll.closesAt).toLocaleString()}`
}

export function PollCard({ poll, onVote, busy }: { poll: Poll; onVote: (option: number) => void; busy?: boolean }) {
  const open = poll.status === 'open'
  // Same rule as the web app: anyone who hasn't voted can, creators included
  // (their votes on their own poll just don't earn credits).
  const canVote = open && poll.myVote === null
  const body = (
    <View>
      {poll.question ? <Text style={styles.question}>{poll.question}</Text> : null}
      <View style={styles.options}>
        {poll.options.map((_, i) => (
          <OptionView key={i} poll={poll} index={i} />
        ))}
      </View>
      <Text style={styles.status}>{statusLine(poll)}</Text>
      {open && !canVote ? (
        <Text style={styles.status}>Thanks! The result shows when it closes.</Text>
      ) : null}
    </View>
  )

  if (canVote && canSwipe(poll.options.length)) {
    return (
      <View>
        <SwipeCard onPick={onVote} disabled={busy}>
          {body}
        </SwipeCard>
        <Text style={styles.help}>Swipe left for A, right for B</Text>
      </View>
    )
  }
  return (
    <View style={styles.card}>
      {body}
      {canVote ? (
        <View style={styles.buttons}>
          {poll.options.map((_, i) => (
            <Pressable
              key={i}
              disabled={busy}
              onPress={() => onVote(i)}
              style={({ pressed }) => [styles.button, { backgroundColor: optionColor(i), opacity: pressed || busy ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={`Vote ${OPTION_LETTERS[i]}`}
            >
              <Text style={styles.buttonText}>Vote {OPTION_LETTERS[i]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20 },
  question: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 14 },
  options: { gap: 10 },
  option: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12, gap: 6 },
  winner: { borderColor: colors.win, borderWidth: 2 },
  letter: { fontWeight: '800', fontSize: 16 },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10, backgroundColor: colors.line },
  optionText: { fontSize: 18, color: colors.text },
  count: { color: colors.muted },
  mine: { color: colors.win, fontWeight: '600' },
  status: { marginTop: 14, color: colors.muted },
  help: { textAlign: 'center', color: colors.muted, marginTop: 12 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  button: { flexGrow: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
