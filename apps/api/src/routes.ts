import type { FastifyInstance } from 'fastify'
import { registerAuthRoutes } from './modules/auth'
import { registerPatientsRoutes } from './modules/patients'
import { registerMedicationsRoutes } from './modules/medications'
import { registerPharmacyRoutes } from './modules/pharmacy'
import { registerAdminRoutes } from './modules/admin'
import { registerRemindersRoutes } from './modules/reminders'
import { registerComplianceRoutes } from './modules/compliance'
import { registerEscalationRoutes } from './modules/escalation'
import { registerEmergencyRoutes } from './modules/emergency'
import { registerVitalsRoutes } from './modules/vitals'
import { registerFamilyRoutes } from './modules/family'
import { registerDashboardRoutes } from './modules/dashboard'
import { registerEducationRoutes } from './modules/education'
import { registerFacilitiesRoutes } from './modules/facilities'
import { registerRiskRoutes } from './modules/risk'
import { registerExportRoutes } from './modules/export'
import { registerWebhookRoutes } from './modules/webhook'
import { registerPuskesmasRoutes } from './modules/puskesmas'
import { registerSimulatorRoutes } from './modules/simulator'

export function registerRoutes(app: FastifyInstance): void {
  registerAuthRoutes(app)
  registerPatientsRoutes(app)
  registerMedicationsRoutes(app)
  registerPharmacyRoutes(app)
  registerAdminRoutes(app)
  registerPuskesmasRoutes(app)
  registerRemindersRoutes(app)
  registerComplianceRoutes(app)
  registerEscalationRoutes(app)
  registerEmergencyRoutes(app)
  registerVitalsRoutes(app)
  registerFamilyRoutes(app)
  registerDashboardRoutes(app)
  registerEducationRoutes(app)
  registerFacilitiesRoutes(app)
  registerRiskRoutes(app)
  registerExportRoutes(app)
  registerWebhookRoutes(app)
  // Simulator demo — route-nya sendiri menolak jalan bila SIMULATOR_ENABLED=false.
  registerSimulatorRoutes(app)
}