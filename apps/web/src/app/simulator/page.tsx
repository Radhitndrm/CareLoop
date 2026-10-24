'use client'

import { useEffect, useState } from 'react'
import { ShieldAlertIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { WhatsAppSimulatorPanel } from '@/components/simulator/whatsapp-simulator-panel'
import { Alert } from '@/components/ui/feedback'
import { getSimulatorInfo, type SimulatorInfo } from '@/lib/api'

export default function SimulatorPage() {
  const [info, setInfo] = useState<SimulatorInfo | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)

  useEffect(() => {
    getSimulatorInfo()
      .then(setInfo)
      .catch((err: unknown) => {
        setUnavailable(
          err instanceof Error ? err.message : 'Simulator tidak dapat dihubungi',
        )
      })
  }, [])

  if (unavailable) {
    return (
      <>
        <PageHeader
          kicker="Simulasi demo"
          title="WhatsApp Simulator"
          description="Panel untuk menjalankan alur WhatsApp tanpa nomor nyata."
        />
        <Alert variant="warning" icon={<ShieldAlertIcon />}>
          <p className="font-medium">Simulator tidak aktif di instance ini</p>
          <p className="mt-0.5">
            {unavailable} — pastikan backend berjalan dengan <code>SIMULATOR_ENABLED=true</code> dan{' '}
            <code>PROVIDER_MODE=mock</code>.
          </p>
        </Alert>
      </>
    )
  }

  return (
    <>
      <PageHeader
        kicker="Simulasi demo"
        title="WhatsApp Simulator"
        description="Perankan sisi pasien dan keluarga. Balasan yang ditekan diproses service bisnis yang sama dengan produksi."
        actions={
          info ? (
            <span className="text-xs text-muted-foreground">
              provider: {info.providerMode} · env: {info.nodeEnv}
            </span>
          ) : null
        }
      />
      <WhatsAppSimulatorPanel />
    </>
  )
}
