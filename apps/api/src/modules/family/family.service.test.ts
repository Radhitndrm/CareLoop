// CL-111: Unit tests untuk Kontak Keluarga Aktif per Tier (CRUD, Scoping, Consent, Verifikasi).
import { describe, expect, it, vi } from 'vitest'
import {
  listFamilyContacts,
  createFamilyContact,
  updateFamilyContact,
  deleteFamilyContact,
  verifyFamilyContact,
  type FamilyPrismaClient,
} from './family.service'
import { ApiError, ApiErrorCode } from '../../lib/errors'

interface MockFamilyStore {
  contacts: any[]
  auditLogs: any[]
}

function createMockFamilyPrisma(initialContacts: any[] = []): FamilyPrismaClient & { store: MockFamilyStore } {
  const store: MockFamilyStore = {
    contacts: [...initialContacts],
    auditLogs: [],
  }

  const client: any = {
    store,
    familyContact: {
      findMany: vi.fn(async ({ where }: any) => {
        return store.contacts
          .filter((c) => {
            if (where.patientId && c.patientId !== where.patientId) return false
            return true
          })
          .sort((a, b) => {
            if (a.tier !== b.tier) return a.tier.localeCompare(b.tier)
            return a.priority - b.priority
          })
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return store.contacts.find((c) => c.id === where.id) ?? null
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          store.contacts.find((c) => {
            if (where.patientId && c.patientId !== where.patientId) return false
            if (where.phone && c.phone !== where.phone) return false
            return true
          }) ?? null
        )
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `fc-${store.contacts.length + 1}`
        const record = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        store.contacts.push(record)
        return record
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const index = store.contacts.findIndex((c) => c.id === where.id)
        if (index === -1) throw new Error(`Contact ${where.id} not found`)
        store.contacts[index] = { ...store.contacts[index], ...data, updatedAt: new Date() }
        return store.contacts[index]
      }),
      delete: vi.fn(async ({ where }: any) => {
        const index = store.contacts.findIndex((c) => c.id === where.id)
        if (index === -1) throw new Error(`Contact ${where.id} not found`)
        const [deleted] = store.contacts.splice(index, 1)
        return deleted
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        const log = { id: `audit-${store.auditLogs.length + 1}`, ...data, createdAt: new Date() }
        store.auditLogs.push(log)
        return log
      }),
    },
  }

  return client
}

describe('CL-111: FamilyContactService — Kontak Keluarga Aktif per Tier', () => {
  const PATIENT_1 = 'patient-bu-ratna'
  const PATIENT_2 = 'patient-pak-haji'

  describe('listFamilyContacts', () => {
    it('mengembalikan daftar kontak keluarga terurut berdasarkan tier dan prioritas', async () => {
      const client = createMockFamilyPrisma([
        {
          id: 'fc-1',
          patientId: PATIENT_1,
          name: 'Ari Prasetyo (Tier 2)',
          phone: '081200000002',
          relationship: 'ANAK',
          tier: 'TIER_2',
          priority: 1,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'fc-2',
          patientId: PATIENT_1,
          name: 'Siti (Tier 1 Prio 2)',
          phone: '081200000003',
          relationship: 'SAUDARA',
          tier: 'TIER_1',
          priority: 2,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'fc-3',
          patientId: PATIENT_1,
          name: 'Budi (Tier 1 Prio 1)',
          phone: '081200000004',
          relationship: 'PASANGAN',
          tier: 'TIER_1',
          priority: 1,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      const list = await listFamilyContacts(client, PATIENT_1)

      expect(list).toHaveLength(3)
      // Tier 1 Prio 1 harus paling depan
      expect(list[0].name).toBe('Budi (Tier 1 Prio 1)')
      expect(list[0].tier).toBe('TIER_1')
      expect(list[0].priority).toBe(1)
      // Tier 1 Prio 2
      expect(list[1].name).toBe('Siti (Tier 1 Prio 2)')
      expect(list[1].priority).toBe(2)
      // Tier 2
      expect(list[2].name).toBe('Ari Prasetyo (Tier 2)')
      expect(list[2].tier).toBe('TIER_2')
    })
  })

  describe('createFamilyContact', () => {
    it('membuat kontak keluarga baru dengan status verifikasi PENDING (isActive: false) dan audit log', async () => {
      const client = createMockFamilyPrisma()

      const contact = await createFamilyContact(client, {
        patientId: PATIENT_1,
        input: {
          name: 'Ari Prasetyo',
          phone: '081234567890',
          relationship: 'ANAK',
          tier: 'TIER_1',
          priority: 1,
          isNearby: true,
          canReceiveEmergency: true,
          canViewHealth: true,
          consentGiven: true,
        },
        actorUserId: PATIENT_1,
        actorRole: 'PATIENT',
      })

      expect(contact.id).toBeDefined()
      expect(contact.name).toBe('Ari Prasetyo')
      expect(contact.phone).toBe('081234567890')
      // Belum diverifikasi -> isActive false dan status PENDING
      expect(contact.isActive).toBe(false)
      expect(contact.verificationStatus).toBe('PENDING')

      // Verifikasi AuditLog: penambahan kontak + consent PDP
      expect(client.store.auditLogs).toHaveLength(2)
      expect(client.store.auditLogs[0].action).toBe('family_contact.added')
      expect(client.store.auditLogs[1].action).toBe('patient.consent.given')
    })

    it('menolak nomor HP yang sudah terdaftar untuk pasien yang sama (409 CONFLICT)', async () => {
      const client = createMockFamilyPrisma([
        {
          id: 'fc-exist',
          patientId: PATIENT_1,
          name: 'Ari',
          phone: '081234567890',
          tier: 'TIER_1',
          priority: 1,
        },
      ])

      await expect(
        createFamilyContact(client, {
          patientId: PATIENT_1,
          input: {
            name: 'Ari Kloning',
            phone: '081234567890',
            relationship: 'ANAK',
            tier: 'TIER_1',
          },
        }),
      ).rejects.toThrow(ApiError)

      try {
        await createFamilyContact(client, {
          patientId: PATIENT_1,
          input: {
            name: 'Ari Kloning',
            phone: '081234567890',
            relationship: 'ANAK',
            tier: 'TIER_1',
          },
        })
      } catch (err: any) {
        expect(err.statusCode).toBe(409)
        expect(err.code).toBe(ApiErrorCode.CONFLICT)
      }
    })

    it('menolak nomor HP yang tidak sesuai format Indonesia', async () => {
      const client = createMockFamilyPrisma()

      await expect(
        createFamilyContact(client, {
          patientId: PATIENT_1,
          input: {
            name: 'Kontak Luar Negeri',
            phone: '+123456789', // bukan 08...
            relationship: 'ANAK',
            tier: 'TIER_1',
          },
        }),
      ).rejects.toThrow()
    })
  })

  describe('updateFamilyContact & Scoping', () => {
    it('memperbarui data tier dan prioritas kontak', async () => {
      const client = createMockFamilyPrisma([
        {
          id: 'fc-1',
          patientId: PATIENT_1,
          name: 'Ari Prasetyo',
          phone: '081234567890',
          tier: 'TIER_2',
          priority: 2,
          isActive: false,
        },
      ])

      const updated = await updateFamilyContact(client, {
        contactId: 'fc-1',
        patientId: PATIENT_1,
        input: {
          tier: 'TIER_1',
          priority: 1,
          isNearby: true,
        },
      })

      expect(updated.tier).toBe('TIER_1')
      expect(updated.priority).toBe(1)
      expect(updated.isNearby).toBe(true)

      // Audit log tercatat
      expect(client.store.auditLogs).toHaveLength(1)
      expect(client.store.auditLogs[0].action).toBe('family_contact.updated')
    })

    it('menolak akses silang antar pasien dengan 403 FORBIDDEN (CL-008)', async () => {
      const client = createMockFamilyPrisma([
        {
          id: 'fc-belong-to-patient-1',
          patientId: PATIENT_1,
          name: 'Ari',
          phone: '081234567890',
          tier: 'TIER_1',
        },
      ])

      // Pasien 2 mencoba mengedit kontak milik Pasien 1
      await expect(
        updateFamilyContact(client, {
          contactId: 'fc-belong-to-patient-1',
          patientId: PATIENT_2, // Beda pasien!
          input: { name: 'Hacked Name' },
        }),
      ).rejects.toThrow(ApiError)

      try {
        await updateFamilyContact(client, {
          contactId: 'fc-belong-to-patient-1',
          patientId: PATIENT_2,
          input: { name: 'Hacked Name' },
        })
      } catch (err: any) {
        expect(err.statusCode).toBe(403)
        expect(err.code).toBe(ApiErrorCode.FORBIDDEN)
      }
    })

    it('melempar 404 NOT_FOUND jika kontak tidak ditemukan', async () => {
      const client = createMockFamilyPrisma()

      await expect(
        updateFamilyContact(client, {
          contactId: 'non-existent',
          patientId: PATIENT_1,
          input: { priority: 1 },
        }),
      ).rejects.toThrow(ApiError)
    })
  })

  describe('deleteFamilyContact & Scoping', () => {
    it('menghapus kontak keluarga dan mencatat audit log', async () => {
      const client = createMockFamilyPrisma([
        {
          id: 'fc-delete-me',
          patientId: PATIENT_1,
          name: 'Kontak Lama',
          phone: '081299998888',
          tier: 'TIER_2',
        },
      ])

      const result = await deleteFamilyContact(client, {
        contactId: 'fc-delete-me',
        patientId: PATIENT_1,
      })

      expect(result.success).toBe(true)
      expect(client.store.contacts).toHaveLength(0)

      // Audit log tercatat
      expect(client.store.auditLogs).toHaveLength(1)
      expect(client.store.auditLogs[0].action).toBe('family_contact.removed')
    })

    it('menolak penghapusan kontak milik pasien lain dengan 403 FORBIDDEN', async () => {
      const client = createMockFamilyPrisma([
        {
          id: 'fc-belong-to-patient-1',
          patientId: PATIENT_1,
          name: 'Ari',
          phone: '081234567890',
        },
      ])

      await expect(
        deleteFamilyContact(client, {
          contactId: 'fc-belong-to-patient-1',
          patientId: PATIENT_2, // Beda pasien!
        }),
      ).rejects.toThrow(ApiError)
    })
  })

  describe('verifyFamilyContact', () => {
    it('memverifikasi kontak sehingga isActive menjadi true dan status menjadi VERIFIED', async () => {
      const client = createMockFamilyPrisma([
        {
          id: 'fc-unverified',
          patientId: PATIENT_1,
          name: 'Sari Rahmawati',
          phone: '081234567890',
          tier: 'TIER_1',
          isActive: false,
        },
      ])

      const verified = await verifyFamilyContact(client, {
        contactId: 'fc-unverified',
        patientId: PATIENT_1,
      })

      expect(verified.isActive).toBe(true)
      expect(verified.verificationStatus).toBe('VERIFIED')

      // Audit log tercatat
      expect(client.store.auditLogs).toHaveLength(1)
      expect(client.store.auditLogs[0].action).toBe('family_contact.updated')
    })

    it('menolak verifikasi kontak milik pasien lain dengan 403 FORBIDDEN', async () => {
      const client = createMockFamilyPrisma([
        {
          id: 'fc-unverified',
          patientId: PATIENT_1,
          name: 'Sari',
          phone: '081234567890',
          isActive: false,
        },
      ])

      await expect(
        verifyFamilyContact(client, {
          contactId: 'fc-unverified',
          patientId: PATIENT_2, // Pasien lain!
        }),
      ).rejects.toThrow(ApiError)
    })
  })
})
