/**
 * Central API client + typed fetchers.
 * VITE_API_URL lets us point at the deployed Render backend.
 * In dev, Vite's proxy rewrites /api → http://localhost:8000.
 */
import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL ?? ''

export const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
})

// ── Types ────────────────────────────────────────────────────────────────────

export interface Health {
  status: string
  version: string
  db: string
  paypal: string
}

export interface Agent {
  id: number
  name: string
  api_key: string
  user_id: number
}

export interface Mandate {
  id: number
  user_id: number
  agent_id: number
  version: number
  budget_total: number
  budget_spent: number
  per_purchase_cap: number
  escalate_above: number | null
  allowed_categories: string[]
  allowed_merchants: string[]
  blocked_merchants: string[]
  valid_from: string | null
  valid_until: string | null
  status: 'pending_link' | 'active' | 'revoked'
  token: string | null
  vault_id: string | null
  created_at: string
}

export interface MandateCreate {
  agent_id: number
  budget_total: number
  per_purchase_cap: number
  escalate_above?: number
  allowed_categories: string[]
  allowed_merchants: string[]
  blocked_merchants: string[]
  valid_from?: string
  valid_until?: string
}

export interface LinkStart {
  order_id: string
  approve_url: string
  instructions: string
}

export interface Receipt {
  id: number
  mandate_id: number
  mandate_version: number
  agent_id: number
  item: string
  merchant: string
  amount: number
  currency: string
  category_claimed: string | null
  category_verified: string | null
  agent_plan: string | null
  evidence: Record<string, any>
  decision: 'approved' | 'blocked' | 'escalated' | 'denied'
  reasons: string[]
  injection_flag: boolean
  paypal_order_id: string | null
  paypal_capture_id: string | null
  prev_hash: string | null
  hash: string | null
  created_at: string
}

export interface Escalation {
  id: number
  receipt_id: number
  status: 'pending' | 'approved' | 'denied'
  resolved_at: string | null
  receipt?: Receipt
}

export interface ChainVerification {
  valid: boolean
  total_receipts: number
  broken_at_receipt_id: number | null
  reason: string
}

export interface CatalogItem {
  id: string
  name: string
  merchant: string
  price: number
  currency: string
  category: string
  description: string
  scenario?: string
  expected_decision?: string
  injection_warning?: string
}

export interface ScenarioResult {
  scenario: string
  name: string
  item: string
  merchant: string
  amount: number
  currency: string
  category: string
  expected_decision: string
  actual_decision: string
  passed_expected: boolean
  reasons: string[]
  injection_flag: boolean
  receipt_id: number | null
  escalation_id: number | null
  paypal_capture_id: string | null
  approve_url?: string | null
  message: string
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

export const fetchHealth = () =>
  api.get<Health>('/health').then((r) => r.data)

export const fetchAgents = () =>
  api.get<Agent[]>('/mandates/agents').then((r) => r.data)

export const fetchMandates = () =>
  api.get<Mandate[]>('/mandates/').then((r) => r.data)

export const createMandate = (body: MandateCreate) =>
  api.post<Mandate>('/mandates/', body).then((r) => r.data)

export const linkPaypalStart = (mandateId: number) =>
  api.post<LinkStart>(`/mandates/${mandateId}/link-paypal`).then((r) => r.data)

export const revokeMandate = (mandateId: number) =>
  api.delete(`/mandates/${mandateId}/revoke`).then((r) => r.data)

export const fetchReceipts = () =>
  api.get<Receipt[]>('/purchases/receipts').then((r) => r.data)

export const verifyChain = () =>
  api.get<ChainVerification>('/purchases/receipts/verify-chain').then((r) => r.data)

export const fetchEscalations = () =>
  api.get<Escalation[]>('/purchases/escalations').then((r) => r.data)

export const approveEscalation = (id: number) =>
  api.post(`/purchases/escalations/${id}/approve`).then((r) => r.data)

export const denyEscalation = (id: number) =>
  api.post(`/purchases/escalations/${id}/deny`).then((r) => r.data)

export const fetchCatalog = () =>
  api.get<CatalogItem[]>('/agent/catalog').then((r) => r.data)

export const runAgentScenarios = (mandateId: number, scenarioId?: string) =>
  api.post<ScenarioResult[]>('/agent/run-scenarios', {
    mandate_id: mandateId,
    scenario_id: scenarioId,
  }).then((r) => r.data)

export const simulateTamper = (receiptId?: number) =>
  api.post<{
    message: string
    tampered_receipt_id: number
    original_amount: number
    tampered_amount: number
  }>('/purchases/receipts/simulate-tamper', {}, {
    params: receiptId ? { receipt_id: receiptId } : {},
  }).then((r) => r.data)

export const repairChain = () =>
  api.post<{
    message: string
    receipts_rehashed: number
  }>('/purchases/receipts/repair-chain').then((r) => r.data)
