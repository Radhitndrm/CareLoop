import React, { useEffect, useState } from 'react'
import {
  Linking,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { ConfirmScreen } from './src/screens/ConfirmScreen'
import { EmergencyScreen } from './src/screens/EmergencyScreen'
import { parseConfirmationUrl } from './src/services/linking'

export default function App() {
  const [activeTab, setActiveTab] = useState<'CONFIRM' | 'EMERGENCY'>('CONFIRM')
  const [activeScheduleId, setActiveScheduleId] = useState<string | undefined>(undefined)
  const [activeEmergencyId, setActiveEmergencyId] = useState<string | undefined>(undefined)
  const [isFromDeepLink, setIsFromDeepLink] = useState<boolean>(false)

  const handleIncomingUrl = (url: string | null) => {
    if (!url) return
    const parsed = parseConfirmationUrl(url)
    if (!parsed) return

    if (parsed.action === 'emergency') {
      setActiveTab('EMERGENCY')
      if (parsed.emergencyId) {
        setActiveEmergencyId(parsed.emergencyId)
      }
      setIsFromDeepLink(true)
    } else if (parsed.action === 'confirm') {
      setActiveTab('CONFIRM')
      if (parsed.scheduleId) {
        setActiveScheduleId(parsed.scheduleId)
      }
      setIsFromDeepLink(true)
    }
  }

  useEffect(() => {
    // 1. Periksa URL deep link saat aplikasi pertama kali dibuka (cold start)
    Linking.getInitialURL().then(handleIncomingUrl)

    // 2. Dengarkan event URL jika aplikasi sudah berjalan di background (warm start)
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleIncomingUrl(url)
    })

    return () => {
      subscription.remove()
    }
  }, [])

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Navigation Switcher for Demo & Multi-screen Support */}
      <View style={styles.topTabBar}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'CONFIRM' && styles.tabButtonActive]}
          onPress={() => setActiveTab('CONFIRM')}
          accessibilityRole="button"
          accessibilityLabel="Layar Jadwal Obat"
        >
          <Text
            style={[styles.tabButtonText, activeTab === 'CONFIRM' && styles.tabButtonTextActive]}
          >
            💊 Jadwal Obat
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'EMERGENCY' && styles.tabButtonEmergencyActive,
          ]}
          onPress={() => setActiveTab('EMERGENCY')}
          accessibilityRole="button"
          accessibilityLabel="Layar Darurat Medis 112"
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'EMERGENCY' && styles.tabButtonTextEmergencyActive,
            ]}
          >
            🚨 Darurat (112)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Konten Layar Aktif */}
      <View style={styles.content}>
        {activeTab === 'CONFIRM' ? (
          <ConfirmScreen
            initialScheduleId={activeScheduleId}
            isFromDeepLink={isFromDeepLink}
          />
        ) : (
          <EmergencyScreen
            initialEmergencyId={activeEmergencyId}
            isFromDeepLink={isFromDeepLink}
          />
        )}
      </View>

      <StatusBar style="dark" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FAFAF9',
  },
  topTabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E7E5E4',
    gap: 10,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F5F5F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#16A34A',
  },
  tabButtonEmergencyActive: {
    backgroundColor: '#DC2626',
  },
  tabButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#57534E',
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
  },
  tabButtonTextEmergencyActive: {
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
  },
})
