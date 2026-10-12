import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { colors } from '../components/theme'

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'tiebreak' }} />
        <Stack.Screen name="p/[id]" options={{ title: 'Poll' }} />
        <Stack.Screen name="new" options={{ title: 'New poll', presentation: 'modal' }} />
        <Stack.Screen name="account" options={{ title: 'You' }} />
      </Stack>
    </GestureHandlerRootView>
  )
}
