import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchHealth,
  fetchMandates,
  fetchReceipts,
  fetchEscalations,
  verifyChain,
  fetchAgents,
  type Health,
  type Mandate,
  type Receipt,
  type Escalation,
  type ChainVerification,
  type Agent,
} from '../lib/api'

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null)
  const [mandates, setMandates] = useState<Mandate[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [chain, setChain] = useState<ChainVerification | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchMandates(),
      fetchReceipts(),
      fetchEscalations(),
      verifyChain(),
      fetchAgents(),
    ])
      .then(([m, r, e, c, a]) => {
        setMandates(m)
        setReceipts(r)
        setEscalations(e)
        setChain(c)
        setAgents(a)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingData(false))

    // Load live PayPal OAuth health ping asynchronously so initial render is instant
    fetchHealth()
      .then(setHealth)
      .catch((e) => setError(e.message))
  }, [])

  const activeMandates = mandates.filter((m) => m.status === 'active')
  const primaryMandate = activeMandates[0] ?? mandates[0]
  const primaryAgent = agents.find((a) => a.id === primaryMandate?.agent_id)

  const totalBudget = mandates.reduce((acc, m) => acc + (m.status === 'active' ? m.budget_total : 0), 0)
  const totalSpent = mandates.reduce((acc, m) => acc + (m.status === 'active' ? m.budget_spent : 0), 0)
  const availableBudget = Math.max(totalBudget - totalSpent, 0)

  const approvedCount = receipts.filter((r) => r.decision === 'approved').length
  const blockedCount = receipts.filter((r) => r.decision === 'blocked').length
  const injectionCount = receipts.filter((r) => r.injection_flag).length

  const statusPill = (val?: string) => {
    if (!val) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-[#5c6a82]">
          Checking…
        </span>
      )
    }
    const ok = val === 'ok'
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
          ok
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
        {ok ? 'Operational' : val}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#003087] tracking-tight">
            Spending Control Overview
          </h1>
          <p className="text-sm text-[#5c6a82] mt-1">
            Real-time enforcement across PayPal Vault mandates, Gemini security screening, and SHA-256 audit receipts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/agent"
            className="px-5 py-2.5 rounded-full bg-[#0070ba] hover:bg-[#005ea6] text-white text-sm font-semibold shadow-sm transition"
          >
            Run AI Agent
          </Link>
          <Link
            to="/mandates"
            className="px-5 py-2.5 rounded-full bg-white border border-[#0070ba] text-[#0070ba] hover:bg-[#f0f7fc] text-sm font-semibold transition"
          >
            Manage Mandates
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-800 text-sm shadow-sm">
          API connection issue: {error}. Verify FastAPI backend is running on port 8000.
        </div>
      )}

      {/* Live Database KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-[#e5e9f0] p-5 shadow-pp-card">
          <div className="text-xs font-bold uppercase tracking-wider text-[#5c6a82]">
            Remaining Allowance
          </div>
          <div className="text-2xl font-extrabold text-[#003087] tabular-nums mt-1.5">
            {loadingData ? '—' : `$${availableBudget.toFixed(2)}`}
          </div>
          <div className="text-xs text-[#5c6a82] mt-1">
            ${totalSpent.toFixed(2)} spent of ${totalBudget.toFixed(2)} active limit
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#e5e9f0] p-5 shadow-pp-card">
          <div className="text-xs font-bold uppercase tracking-wider text-[#5c6a82]">
            PayPal Vault Token
          </div>
          <div className="text-lg font-extrabold text-[#0c1c3e] mt-1.5 truncate">
            {loadingData
              ? '—'
              : primaryMandate?.vault_id
              ? 'Linked & Active'
              : 'Not Linked'}
          </div>
          <div className="text-xs font-mono text-[#0070ba] mt-1 truncate">
            {primaryMandate?.vault_id ? `vault_id: ${primaryMandate.vault_id}` : 'Pending user approval'}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#e5e9f0] p-5 shadow-pp-card">
          <div className="text-xs font-bold uppercase tracking-wider text-[#5c6a82]">
            Policy Decisions
          </div>
          <div className="text-2xl font-extrabold text-[#0c1c3e] tabular-nums mt-1.5">
            {loadingData ? '—' : `${approvedCount} Approved / ${blockedCount} Blocked`}
          </div>
          <div className="text-xs text-[#5c6a82] mt-1">
            {injectionCount} prompt injection attempt{injectionCount === 1 ? '' : 's'} intercepted
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#e5e9f0] p-5 shadow-pp-card">
          <div className="text-xs font-bold uppercase tracking-wider text-[#5c6a82]">
            Audit Chain Integrity
          </div>
          <div
            className={`text-xl font-extrabold mt-1.5 ${
              !chain ? 'text-[#0c1c3e]' : chain.valid ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {!chain ? '—' : chain.valid ? 'SHA-256 Verified' : `Broken at #${chain.broken_at_receipt_id}`}
          </div>
          <div className="text-xs text-[#5c6a82] mt-1">
            {chain ? `${chain.total_receipts} chained reasoning receipts` : 'Checking chain…'}
          </div>
        </div>
      </div>

      {/* Explanatory Architecture Flow */}
      <div className="bg-white rounded-2xl border border-[#e5e9f0] shadow-pp-card p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#003087]">
            How Reins Protects Every Autonomous Purchase
          </h2>
          <span className="text-xs text-[#5c6a82] hidden sm:inline">
            End-to-end execution lifecycle
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[#f5f7fa] rounded-xl p-4 border border-[#e5e9f0]">
            <div className="text-xs font-extrabold text-[#0070ba] mb-1">1. Scoped Mandate</div>
            <p className="text-xs text-[#5c6a82] leading-relaxed">
              The AI agent receives a signed JWT token bounded by budget, cap, category, and expiration — never PayPal credentials.
            </p>
          </div>
          <div className="bg-[#f5f7fa] rounded-xl p-4 border border-[#e5e9f0]">
            <div className="text-xs font-extrabold text-[#0070ba] mb-1">2. Deterministic Caps</div>
            <p className="text-xs text-[#5c6a82] leading-relaxed">
              Hard per-purchase cap (${primaryMandate?.per_purchase_cap?.toFixed(2) ?? '100.00'}) and remaining budget are enforced before escalation (${primaryMandate?.escalate_above?.toFixed(2) ?? '50.00'}).
            </p>
          </div>
          <div className="bg-[#f5f7fa] rounded-xl p-4 border border-[#e5e9f0]">
            <div className="text-xs font-extrabold text-[#0070ba] mb-1">3. Gemini AI Guard</div>
            <p className="text-xs text-[#5c6a82] leading-relaxed">
              Gemini 3.6 Flash verifies semantic category fit and scans product listings for prompt injection. Never approves on failure.
            </p>
          </div>
          <div className="bg-[#f5f7fa] rounded-xl p-4 border border-[#e5e9f0]">
            <div className="text-xs font-extrabold text-[#0070ba] mb-1">4. PayPal Vault & Proof</div>
            <p className="text-xs text-[#5c6a82] leading-relaxed">
              Approved orders charge server-side via <code className="font-mono text-[#003087]">vault_id</code> and every decision appends to the SHA-256 hash chain.
            </p>
          </div>
        </div>
      </div>

      {/* Main 2-Column PayPal Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Mandate Details Card */}
          {primaryMandate && (
            <div className="bg-white rounded-2xl border border-[#e5e9f0] shadow-pp-card p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[#003087]">
                      Mandate #{primaryMandate.id} — {primaryAgent?.name ?? `Agent #${primaryMandate.agent_id}`}
                    </h2>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                        primaryMandate.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {primaryMandate.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#5c6a82] mt-1">
                    Created {new Date(primaryMandate.created_at).toLocaleString()} • Version {primaryMandate.version}
                  </p>
                </div>

                {!primaryMandate.vault_id && (
                  <Link
                    to="/mandates"
                    className="px-4 py-2 rounded-full bg-[#ffc439] hover:bg-[#f2b82b] text-[#003087] text-xs font-bold shadow-sm transition self-start"
                  >
                    Link PayPal Sandbox
                  </Link>
                )}
              </div>

              {/* Spend Bar */}
              <div className="space-y-2">
                <div className="w-full bg-[#eef2f6] rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#003087] to-[#009cde] transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        (primaryMandate.budget_spent / Math.max(primaryMandate.budget_total, 1)) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-[#5c6a82] pt-1">
                  <div>
                    Spent: <strong className="text-[#0c1c3e] tabular-nums">${primaryMandate.budget_spent.toFixed(2)}</strong>
                  </div>
                  <div className="text-center">
                    Cap / Purchase: <strong className="text-[#0c1c3e] tabular-nums">${primaryMandate.per_purchase_cap.toFixed(2)}</strong>
                  </div>
                  <div className="text-right">
                    Escalate &gt; <strong className="text-[#0c1c3e] tabular-nums">{primaryMandate.escalate_above ? `$${primaryMandate.escalate_above.toFixed(2)}` : 'None'}</strong>
                  </div>
                </div>
              </div>

              {primaryMandate.allowed_categories.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#eef2f6]">
                  <span className="text-xs font-semibold text-[#5c6a82] mr-1">Allowed Categories:</span>
                  {primaryMandate.allowed_categories.map((cat) => (
                    <span
                      key={cat}
                      className="px-2.5 py-0.5 rounded-full bg-[#f0f7fc] text-[#003087] border border-[#dceefa] text-[11px] font-medium"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recent Live Activity Feed */}
          <div className="bg-white rounded-2xl border border-[#e5e9f0] shadow-pp-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e5e9f0] flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-[#003087]">Recent Transactions & Decisions</h2>
                <p className="text-xs text-[#5c6a82]">Every attempt recorded in the receipt ledger</p>
              </div>
              <Link to="/activity" className="text-xs font-bold text-[#0070ba] hover:underline">
                Full Audit Ledger →
              </Link>
            </div>

            {receipts.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#5c6a82]">
                No purchase attempts yet. Open the{' '}
                <Link to="/agent" className="text-[#0070ba] font-semibold hover:underline">
                  Agent Playground
                </Link>{' '}
                to execute a live goal or scenario.
              </div>
            ) : (
              <ul className="divide-y divide-[#eef2f6]">
                {receipts.slice(0, 6).map((r) => (
                  <li key={r.id} className="px-6 py-4 flex items-start justify-between gap-4 hover:bg-[#f8fafc] transition">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#0c1c3e]">{r.item}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            r.decision === 'approved'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : r.decision === 'blocked'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {r.injection_flag ? 'Blocked • Injection' : r.decision}
                        </span>
                      </div>
                      <div className="text-xs text-[#5c6a82]">
                        {r.merchant} • {new Date(r.created_at).toLocaleString()}
                      </div>
                      {r.paypal_capture_id ? (
                        <div className="text-[11px] font-mono text-emerald-700">
                          PayPal Capture ID: {r.paypal_capture_id}
                        </div>
                      ) : r.reasons?.length > 0 ? (
                        <div className="text-xs text-[#5c6a82] line-clamp-1">
                          {r.reasons[0]}
                        </div>
                      ) : null}
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`text-sm font-extrabold tabular-nums ${
                          r.decision === 'approved'
                            ? 'text-[#003087]'
                            : r.decision === 'blocked'
                            ? 'text-rose-600 line-through'
                            : 'text-amber-700'
                        }`}
                      >
                        {r.decision === 'approved' ? `-$${r.amount.toFixed(2)}` : `$${r.amount.toFixed(2)}`}
                      </div>
                      <div className="text-[11px] text-[#5c6a82]">{r.currency}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right Utility Column (1/3) */}
        <div className="space-y-6">
          {/* Action Needed: Escalations */}
          <div className={`rounded-2xl p-5 border shadow-pp-card space-y-3 ${
            escalations.length > 0
              ? 'bg-amber-50 border-amber-200'
              : 'bg-white border-[#e5e9f0]'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-extrabold uppercase tracking-wider ${
                escalations.length > 0 ? 'text-amber-900' : 'text-[#003087]'
              }`}>
                Human Approval Queue
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                escalations.length > 0
                  ? 'bg-amber-200 text-amber-950'
                  : 'bg-[#f5f7fa] text-[#5c6a82]'
              }`}>
                {escalations.length} Pending
              </span>
            </div>

            {escalations.length > 0 ? (
              <>
                <p className="text-xs text-amber-900 leading-relaxed">
                  Latest held item: <strong>{escalations[0].receipt?.item ?? `Escalation #${escalations[0].id}`}</strong> (${escalations[0].receipt?.amount.toFixed(2) ?? '—'}). Review before PayPal capture.
                </p>
                <Link
                  to="/activity"
                  className="inline-block w-full text-center px-4 py-2 rounded-full bg-[#ffc439] hover:bg-[#f2b82b] text-[#003087] text-xs font-bold shadow-sm transition"
                >
                  Review & Approve in Activity
                </Link>
              </>
            ) : (
              <p className="text-xs text-[#5c6a82] leading-relaxed">
                No transactions currently held for escalation. Any purchase above ${primaryMandate?.escalate_above?.toFixed(2) ?? '50.00'} or failing AI verification appears here.
              </p>
            )}
          </div>

          {/* Connected Guardrails Health Card */}
          <div className="bg-white rounded-2xl border border-[#e5e9f0] shadow-pp-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#003087] uppercase tracking-wider">
                System Telemetry
              </h2>
              <span className="text-xs font-mono text-[#5c6a82]">
                {health ? `v${health.version}` : '…'}
              </span>
            </div>

            <dl className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <dt className="text-[#5c6a82] font-medium">Policy Engine API</dt>
                <dd>{statusPill(health?.status)}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-[#5c6a82] font-medium">PayPal Sandbox OAuth</dt>
                <dd>{statusPill(health?.paypal)}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-[#5c6a82] font-medium">Receipt Audit DB</dt>
                <dd>{statusPill(health?.db)}</dd>
              </div>
            </dl>

            <div className="pt-3 border-t border-[#eef2f6] text-xs text-[#5c6a82] leading-relaxed">
              Every API decision is written atomically into the cryptographic hash chain; use <strong>Simulate Tamper</strong> in Activity to test detection.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
