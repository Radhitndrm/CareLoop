'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  getStoredToken,
  getDashboardAlerts,
  respondEscalation,
  type ActiveAlerts,
} from '../lib/api'

export interface EmergencyAlertItem {
  id: string
  patientId: string
  patientName: string
  livingSituation?: string | null
  triggerType: string
  hrBpm?: number | null
  status: string
  triggeredAt: string
  location?: { lat: number | null; lng: number | null } | null
  escalationRunId?: string | null
  puskesmasId?: string | null
  districtCode?: string | null
  isHandled?: boolean
}

interface PriorityEmergencyPayload {
  event?: string
  data?: {
    emergencyId: string
    patient?: {
      id?: string
      fullName?: string
      livingSituation?: string | null
    }
    patientId?: string
    triggerType?: string
    hrBpm?: number | null
    triggeredAt?: string
    location?: { lat: number; lng: number } | null
    escalationRunId?: string | null
    puskesmasId?: string | null
    districtCode?: string | null
  }
}

interface EmergencyAckPayload {
  emergencyId?: string
  ackByUserId?: string
  ackAt?: string
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export function useEmergencyAlerts() {
  const [alerts, setAlerts] = useState<EmergencyAlertItem[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [handlingAlertId, setHandlingAlertId] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)

  // 1. Fetch data lewat REST API (/v1/dashboard/alerts)
  const loadAlertsFromRest = useCallback(async () => {
    try {
      const data: ActiveAlerts = await getDashboardAlerts()
      const mapped: EmergencyAlertItem[] = (data.emergencies || []).map((e) => {
        const matchingEsc = (data.escalations || []).find(
          (esc) => esc.patientId === e.patientId && esc.context === 'EMERGENCY',
        )
        return {
          id: e.id,
          patientId: e.patientId,
          patientName: e.patientName,
          livingSituation: e.livingSituation,
          triggerType: e.triggerType,
          hrBpm: e.hrBpm,
          status: e.status,
          triggeredAt: e.triggeredAt,
          location: e.location,
          escalationRunId: matchingEsc?.id || null,
          puskesmasId: e.puskesmasId,
          districtCode: e.districtCode,
          isHandled: e.status === 'HANDLED' || e.status === 'RESOLVED_SAFE',
        }
      })
      setAlerts(mapped)
    } catch (err) {
      console.warn('Gagal memuat alert via REST:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 2. Hubungkan ke WebSocket Server (CL-208) + Fallback Polling
  useEffect(() => {
    let isCancelled = false

    async function initialFetch() {
      try {
        const data: ActiveAlerts = await getDashboardAlerts()
        if (isCancelled) return
        const mapped: EmergencyAlertItem[] = (data.emergencies || []).map((e) => {
          const matchingEsc = (data.escalations || []).find(
            (esc) => esc.patientId === e.patientId && esc.context === 'EMERGENCY',
          )
          return {
            id: e.id,
            patientId: e.patientId,
            patientName: e.patientName,
            livingSituation: e.livingSituation,
            triggerType: e.triggerType,
            hrBpm: e.hrBpm,
            status: e.status,
            triggeredAt: e.triggeredAt,
            location: e.location,
            escalationRunId: matchingEsc?.id || null,
            puskesmasId: e.puskesmasId,
            districtCode: e.districtCode,
            isHandled: e.status === 'HANDLED' || e.status === 'RESOLVED_SAFE',
          }
        })
        setAlerts(mapped)
      } catch (err) {
        if (!isCancelled) {
          console.warn('Gagal memuat alert via REST:', err)
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void initialFetch()

    // Polling berkala setiap 30s sebagai fallback jika WS diskonek (CL-212)
    const pollInterval = setInterval(() => {
      void initialFetch()
    }, 30000)

    const token = getStoredToken()
    if (token) {
      const socket: Socket = io(API_BASE_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      })

      socketRef.current = socket

      socket.on('connect', () => {
        setIsConnected(true)
      })

      socket.on('disconnect', () => {
        setIsConnected(false)
      })

      // Menerima event darurat prioritas real-time (CL-208)
      socket.on('emergency.priority', (payload: PriorityEmergencyPayload | undefined) => {
        const data = payload?.data
        if (!data || !data.emergencyId) return

        setAlerts((prev) => {
          // Cek duplikasi ID
          const exists = prev.some((a) => a.id === data.emergencyId)
          if (exists) return prev

          const newAlert: EmergencyAlertItem = {
            id: data.emergencyId,
            patientId: data.patient?.id || data.patientId || '',
            patientName: data.patient?.fullName || 'Pasien Darurat',
            livingSituation: data.patient?.livingSituation,
            triggerType: data.triggerType || 'ANOMALY_HR',
            hrBpm: data.hrBpm,
            status: 'ESCALATING',
            triggeredAt: data.triggeredAt || new Date().toISOString(),
            location: data.location,
            escalationRunId: data.escalationRunId,
            puskesmasId: data.puskesmasId,
            districtCode: data.districtCode,
            isHandled: false,
          }

          return [newAlert, ...prev]
        })
      })

      // Menerima konfirmasi penanganan darurat (emergency.ack)
      socket.on('emergency.ack', (payload: EmergencyAckPayload | undefined) => {
        const emergencyId = payload?.emergencyId
        if (emergencyId) {
          setAlerts((prev) =>
            prev.map((a) =>
              a.id === emergencyId ? { ...a, isHandled: true, status: 'HANDLED' } : a,
            ),
          )
        }
      })
    }

    return () => {
      isCancelled = true
      clearInterval(pollInterval)
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [])

  // 3. Aksi "Saya Tangani" (AC-4.5, CL-207, CL-212)
  const handleEmergency = async (alert: EmergencyAlertItem, note?: string) => {
    setHandlingAlertId(alert.id)
    try {
      // Jika memiliki escalationRunId, panggil respond escalation (CL-207)
      if (alert.escalationRunId) {
        await respondEscalation(alert.escalationRunId, 'HANDLE', note || 'Ditangani oleh nakes')
      }

      // Emit ack lewat WebSocket jika terkoneksi
      if (socketRef.current?.connected) {
        socketRef.current.emit('emergency.ack', { emergencyId: alert.id })
      }

      // Update state lokal secara optimistik
      setAlerts((prev) =>
        prev.map((a) => (a.id === alert.id ? { ...a, isHandled: true, status: 'HANDLED' } : a)),
      )
    } catch (err) {
      console.error('Gagal menangani eskalasi darurat:', err)
      throw err
    } finally {
      setHandlingAlertId(null)
    }
  }

  return {
    alerts,
    activeAlerts: alerts.filter((a) => !a.isHandled),
    isConnected,
    isLoading,
    handlingAlertId,
    handleEmergency,
    refreshAlerts: loadAlertsFromRest,
  }
}
