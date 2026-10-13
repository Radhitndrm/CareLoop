import React, { useEffect, useState } from 'react'
import { SafeAreaView, StyleSheet, Text, View, Linking, Pressable } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { AuthScreen } from './src/screens/AuthScreen'
import { ConfirmScreen } from './src/screens/ConfirmScreen'
import { EmergencyScreen } from './src/screens/EmergencyScreen'
import { RequestMedicationScreen } from './src/screens/RequestMedicationScreen'
import {
  MedicationRequestsScreen,
  loadMyRequests,
} from './src/screens/MedicationRequestsScreen'
import {
  getMyMedications,
  type MedicationOption,
  type MedicationRequestItem,
} from './src/services/api'
import { parseConfirmationUrl } from './src/services/linking'
import { clearStoredToken, getStoredToken } from './src/services/auth'
import { TopTabs, type TabKey } from './src/components/TopTabs'
import { colors, spacing, typography } from './src/theme/tokens'

export default function App() {
  // Gate auth: tanpa token di secure store, seluruh layar hanya menampilkan login OTP.
  // hanya menghasilkan 401 yang membingungkan pasien.
  const [authState, setAuthState] = useState<'CHECKING' | 'AUTHED' | 'ANONYMOUS'>('CHECKING')

  useEffect(() => {
    let cancelled = false
    void getStoredToken().then((token) => {
      if (!cancelled) setAuthState(token ? 'AUTHED' : 'ANONYMOUS')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Aplikasi pasien punya empat tab. Tiga pertama adalah tindakan harian pasien;
  // yang keempat adalah farmasi — patients request drugs here, and the request
  // goes to the doctor's web dashboard for approval.
  const [activeTab, setActiveTab] = useState<TabKey>('CONFIRM')
  const [activeScheduleId, setActiveScheduleId] = useState<string | undefined>(undefined)
  const [activeEmergencyId, setActiveEmergencyId] = useState<string | undefined>(undefined)
  const [isFromDeepLink, setIsFromDeepLink] = useState<boolean>(false)
  const [medications, setMedications] = useState<MedicationOption[]>([])
  const [requests, setRequests] = useState<MedicationRequestItem[]>([])
  const [isPharmacyLoading, setIsPharmacyLoading] = useState(false)
  const [pharmacyError, setPharmacyError] = useState<string | null>(null)

  const refreshPharmacy = async () => {
    if (!token) return
    setIsPharmacyLoading(true)
    setPharmacyError(null)
    try {
      const [meds, reqs] = await Promise.all([getMyMedications(), loadMyRequests()])
      setMedications(meds)
      setRequests(reqs)
    } catch (err: unknown) {
      setPharmacyError(err instanceof Error ? err.message : 'Gagal memuat data obat')
    } finally {
      setIsPharmacyLoading(false)
    }
  }

  const isPharmacyTab = activeTab === 'REQUEST_MED' || activeTab === 'MY_REQUESTS'
  const token = authState === 'AUTHED'

  useEffect(() => {
    if (isPharmacyTab) {
      void refreshPharmacy()
    }
  }, [isPharmacyTab])

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

  if (authState !== 'AUTHED') {
    return (
      <SafeAreaView style={styles.safeArea}>
        {authState === 'ANONYMOUS' ? (
          <AuthScreen
            onAuthenticated={() => {
              setAuthState('AUTHED')
              void refreshPharmacy()
            }}
          />
        ) : null}
        <StatusBar style="dark" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Perangkat sering dipakai bersama di ruang tunggu puskesmas, jadi ada jalan
          keluar eksplisit — tokenPasien tidak boleh tertinggal untuk orang berikutnya. */}
      <View style={styles.headerBar}>
        <Text style={styles.headerText}>CareLoop</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keluar"
          onPress={() => {
            void clearStoredToken().then(() => setAuthState('ANONYMOUS'))
          }}
        >
          <Text style={styles.headerAction}>Keluar</Text>
        </Pressable>
      </View>

      <TopTabs activeTab={activeTab} onChange={setActiveTab} />

      <View style={styles.content}>
        {activeTab === 'CONFIRM' ? (
          <ConfirmScreen
            initialScheduleId={activeScheduleId}
            isFromDeepLink={isFromDeepLink}
          />
        ) : activeTab === 'EMERGENCY' ? (
          <EmergencyScreen
            initialEmergencyId={activeEmergencyId}
            isFromDeepLink={isFromDeepLink}
          />
        ) : activeTab === 'REQUEST_MED' ? (
          <RequestMedicationScreen
            medications={medications}
            onSubmitted={() => void refreshPharmacy()}
          />
        ) : (
          <MedicationRequestsScreen
            requests={requests}
            isLoading={isPharmacyLoading}
            errorMessage={pharmacyError}
            onRefresh={() => void refreshPharmacy()}
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
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  headerText: { ...typography.h2, color: colors.text },
  headerAction: { ...typography.label, color: colors.primary },
})