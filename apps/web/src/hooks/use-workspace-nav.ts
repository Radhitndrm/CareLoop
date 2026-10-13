'use client'

import { useMemo } from 'react'
import { useAuth } from '@/lib/auth'
import type { NavItem } from '@/components/nav-links'
import { accountRoleLabel } from '@/lib/nakes-role'

export function useWorkspaceNav(): { nav: NavItem[]; roleLabel: string } {
  const { user } = useAuth()

  return useMemo(() => {
    // Cerminan gate server `requireCareTeamRole` / `requirePharmacyRole`.
    // Apotek (FARMASI) hanya boleh menyentuh antrean & permintaan obat;
    // dashboard, pasien, dan resep ditolak `403` sehingga tidak ditampilkan.
    const isPharmacist = user?.role !== 'ADMIN' && user?.nakesRole === 'FARMASI'
    const canUsePharmacy = user?.role === 'ADMIN' || user?.nakesRole === 'FARMASI'
    const canDecideMedication =
      user?.role === 'ADMIN' || user?.nakesRole === 'DOKTER' || user?.nakesRole === 'BIDAN'

    const nav: NavItem[] = []

    // Pengunjung yang belum login tetap butuh arah: dua tautan monitoring
    // ditampilkan, dan halaman terkait yang menampilkan ajakan masuk.
    if (!user) {
      return {
        nav: [
          { href: '/dashboard', label: 'Ringkasan', icon: 'dashboard', exact: true },
          { href: '/patients', label: 'Data Pasien', icon: 'patients' },
        ],
        roleLabel: 'Nakes',
      }
    }

    if (!isPharmacist) {
      nav.push(
        { href: '/dashboard', label: 'Ringkasan', icon: 'dashboard', exact: true, group: 'Monitoring' },
        { href: '/patients', label: 'Data Pasien', icon: 'patients', group: 'Monitoring' },
      )
    }
    if (canDecideMedication) {
      nav.push({ href: '/requests', label: 'Permintaan Obat', icon: 'requests', group: 'Obat' })
    }
    if (canUsePharmacy) {
      nav.push(
        { href: '/pharmacy/queue', label: 'Antrean Obat', icon: 'pharmacy', group: 'Obat' },
        { href: '/pharmacy/dispensing', label: 'Penyerahan', icon: 'pharmacy', group: 'Obat' },
      )
    }
    if (user?.role === 'ADMIN') {
      nav.push(
        { href: '/admin/nakes', label: 'Kelola Nakes', icon: 'nakes', group: 'Sistem' },
        { href: '/admin/puskesmas', label: 'Data Puskesmas', icon: 'clinics', group: 'Sistem' },
      )
    }

    const roleLabel = user ? accountRoleLabel(user) : 'Nakes'

    return { nav, roleLabel }
  }, [user])
}