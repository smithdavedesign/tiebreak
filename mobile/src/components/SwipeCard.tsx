// A card you drag left (option A) or right (option B). Past the threshold it flies off
// and reports the pick; short of it, it springs back.
import type { ReactNode } from 'react'
import { StyleSheet, Text, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { SWIPE_THRESHOLD, swipeChoice } from '../lib/swipe'
import { colors } from './theme'

export function SwipeCard({
  children,
  onPick,
  disabled = false,
}: {
  children: ReactNode
  onPick: (option: 0 | 1) => void
  disabled?: boolean
}) {
  const { width } = useWindowDimensions()
  const dx = useSharedValue(0)

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-10, 10])
    .onUpdate((e) => {
      dx.value = e.translationX
    })
    .onEnd((e) => {
      const pick = swipeChoice(e.translationX)
      if (pick === null) {
        dx.value = withSpring(0)
        return
      }
      dx.value = withTiming(pick === 0 ? -width * 1.5 : width * 1.5, { duration: 220 }, (finished) => {
        if (finished) scheduleOnRN(onPick, pick)
      })
    })

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { rotate: `${interpolate(dx.value, [-width, width], [-12, 12])}deg` }],
  }))
  const leftHint = useAnimatedStyle(() => ({ opacity: interpolate(-dx.value, [0, SWIPE_THRESHOLD], [0, 1], 'clamp') }))
  const rightHint = useAnimatedStyle(() => ({ opacity: interpolate(dx.value, [0, SWIPE_THRESHOLD], [0, 1], 'clamp') }))

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, cardStyle]} accessibilityHint="Swipe left for A, right for B">
        <Animated.View style={[styles.hint, styles.hintLeft, leftHint]}>
          <Text style={styles.hintText}>A</Text>
        </Animated.View>
        <Animated.View style={[styles.hint, styles.hintRight, rightHint]}>
          <Text style={styles.hintText}>B</Text>
        </Animated.View>
        {children}
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  hint: { position: 'absolute', top: 16, zIndex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  hintLeft: { left: 16, backgroundColor: colors.a },
  hintRight: { right: 16, backgroundColor: colors.b },
  hintText: { color: '#fff', fontWeight: '800', fontSize: 18 },
})
