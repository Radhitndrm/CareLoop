import React, { useEffect, useState } from 'react'
import { Linking, SafeAreaView, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { ConfirmScreen } from './src/screens/ConfirmScreen'
import { parseConfirmationUrl } from './src/services/linking'

export default function App() {
  const [activeScheduleId, setActiveScheduleId] = useState<string | undefined>(undefined)
  const [isFromDeepLink, setIsFromDeepLink] = useState<boolean>(false)

  useEffect(() => {
    // 1. Periksa URL deep link saat aplikasi pertama kali dibuka (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) {
        const parsed = parseConfirmationUrl(url)
        if (parsed?.action === 'confirm' && parsed.scheduleId) {
          setActiveScheduleId(parsed.scheduleId)
          setIsFromDeepLink(true)
        }
      }
    })

    // 2. Dengarkan event URL jika aplikasi sudah berjalan di background (warm start)
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const parsed = parseConfirmationUrl(url)
      if (parsed?.action === 'confirm' && parsed.scheduleId) {
        setActiveScheduleId(parsed.scheduleId)
        setIsFromDeepLink(true)
      }
    })

    return () => {
      subscription.remove()
    }
  }, [])

  return (
    <SafeAreaView style={styles.safeArea}>
      <ConfirmScreen
        initialScheduleId={activeScheduleId}
        isFromDeepLink={isFromDeepLink}
      />
      <StatusBar style="dark" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FAFAF9',
  },
})
