/**
 * Agent Playground — Interactive simulation of an autonomous AI purchasing agent.
 *
 * Persona: Small Online Seller restocking packaging and shipping supplies
 * within a strict monthly budget mandate.
 */
import { useEffect, useState, useCallback } from 'react'
import {
  fetchMandates,
  fetchCatalog,
  runAgentScenarios,
  fetchEscalations,
  approveEscalation,
  denyEscalation,
  createMandate,
  type Mandate,
  type CatalogItem,
  type ScenarioResult,
  type Escalation,
} from '../lib/api'

export default function AgentPlayground() {
  const [mandates, setMandates] = useState<Mandate[]>([])
  const [selectedMandateId, setSelectedMandateId] = useState<number | null>(null)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [results, setResults] = useState<ScenarioResult[]>([])
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [mList, cat, esc] = await Promise.all([
        fetchMandates(),
        fetchCatalog(),
        fetchEscalations(),
      ])
      setMandates(mList)
      setCatalog(cat)
      setEscalations(esc)

      if (mList.length > 0 && selectedMandateId === null) {
        // Auto-select first active mandate or first mandate
        const activeOne = mList.find((m) => m.status === 'active') ?? mList[0]
        setSelectedMandateId(activeOne.id)
      }
    } catch (err: any) {
      console.error(err)
    }
  }, [selectedMandateId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const selectedMandate = mandates.find((m) => m.id === selectedMandateId)

  // 1-Click quick setup for the seller persona mandate
  const handleQuickCreateMandate = async () => {
    setError(null)
    setSuccessMsg(null)
    try {
      const newM = await createMandate({
        agent_id: 1,
        budget_total: 250.0,
        per_purchase_cap: 50.0,
        escalate_above: 30.0,
        allowed_categories: ['shipping_supplies', 'packaging', 'office_supplies'],
        allowed_merchants: [],
        blocked_merchants: ['scamseller.com'],
      })
      await loadData()
      setSelectedMandateId(newM.id)
      setSuccessMsg(
        `Created new Restock Mandate #${newM.id} ($250 Budget, $50 Cap, $30 Escalate Threshold). Complete Link PayPal or use sandbox to activate!`
      )
    } catch (err: any) {
      setError(err.response?.data?.detail ?? err.message)
    }
  }

  const handleRunAgent = async (scenarioId?: string) => {
    if (!selectedMandateId) {
      setError('Please select a mandate first.')
      return
    }

    setError(null)
    setSuccessMsg(null)
    setIsRunning(true)

    try {
      const runResults = await runAgentScenarios(selectedMandateId, scenarioId)
      setResults(runResults)
      // Refresh escalations and mandates to show updated spent budget
      await loadData()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? err.message)
    } finally {
      setIsRunning(false)
    }
  }

  const handleApproveEscalation = async (escId: number) => {
    setError(null)
    try {
      await approveEscalation(escId)
      setSuccessMsg(`Escalation #${escId} approved! Payment charged via PayPal Vault.`)
      await loadData()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? err.message)
    }
  }

  const handleDenyEscalation = async (escId: number) => {
    setError(null)
    try {
      await denyEscalation(escId)
      setSuccessMsg(`Escalation #${escId} denied by user.`)
      await loadData()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? err.message)
    }
  }

  return (
    <div className="space-y-8">
      {/* Persona Header */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-2xl p-6 sm:p-8 text-white shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full text-xs font-semibold tracking-wide text-blue-200 uppercase">
              <span>🤖 Demo Agent Persona</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Small Online Seller — Supply Restock Agent
            </h1>
            <p className="text-blue-100 text-sm leading-relaxed">
              This autonomous AI agent monitors packaging supplies and attempts replenishment purchases.
              Every purchase attempt is intercepted by Reins: deterministic rules enforce budget & caps,
              and Gemini screens descriptions for malicious prompt injection.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur border border-white/20 rounded-xl p-4 text-xs space-y-2 min-w-[240px]">
            <div className="font-semibold text-white uppercase tracking-wider text-[11px]">
              Policy Enforcement Matrix
            </div>
            <div className="flex justify-between text-blue-200">
              <span>Clean Order:</span>
              <span className="font-bold text-emerald-400">Approved & Charged</span>
            </div>
            <div className="flex justify-between text-blue-200">
              <span>Over Cap (&gt;$50):</span>
              <span className="font-bold text-rose-400">Blocked</span>
            </div>
            <div className="flex justify-between text-blue-200">
              <span>Prompt Injection:</span>
              <span className="font-bold text-rose-400">Blocked (Gemini Guard)</span>
            </div>
            <div className="flex justify-between text-blue-200">
              <span>High Value (&gt;$30):</span>
              <span className="font-bold text-amber-300">Escalated to Human</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mandate Selection & Quick Actions */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Select Mandate for Agent</h2>
            <p className="text-xs text-gray-500">
              The agent presents this mandate's HMAC-signed JWT token on each purchase attempt.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedMandateId ?? ''}
              onChange={(e) => setSelectedMandateId(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {mandates.map((m) => (
                <option key={m.id} value={m.id}>
                  Mandate #{m.id} ({m.status}) — Cap: ${m.per_purchase_cap} | Escalate: ${m.escalate_above ?? 'None'}
                </option>
              ))}
            </select>

            <button
              onClick={handleQuickCreateMandate}
              className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-xs font-semibold transition"
            >
              + Quick Restock Mandate
            </button>
          </div>
        </div>

        {selectedMandate && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-gray-100 text-xs">
            <div>
              <span className="text-gray-400 block">Status:</span>
              <span
                className={`font-semibold capitalize px-2 py-0.5 rounded text-[11px] inline-block mt-0.5 ${
                  selectedMandate.status === 'active'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {selectedMandate.status}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block">Budget Total:</span>
              <span className="font-bold text-gray-800">${selectedMandate.budget_total.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-gray-400 block">Spent:</span>
              <span className="font-bold text-indigo-600">${selectedMandate.budget_spent.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-gray-400 block">Per-Purchase Cap:</span>
              <span className="font-bold text-gray-800">${selectedMandate.per_purchase_cap.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-gray-400 block">Escalate Threshold:</span>
              <span className="font-bold text-amber-700">
                {selectedMandate.escalate_above ? `$${selectedMandate.escalate_above.toFixed(2)}` : 'None'}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700 font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {/* Catalog Preview */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Supplier Restock Catalog</h2>
            <p className="text-xs text-gray-500">Items the agent evaluates during its restocking cycle.</p>
          </div>
          <button
            onClick={() => handleRunAgent()}
            disabled={isRunning || !selectedMandate}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-md transition flex items-center gap-2"
          >
            <span>{isRunning ? '⏳' : '▶'}</span>
            <span>{isRunning ? 'Running Scenarios…' : 'Run Agent (All 4 Scenarios)'}</span>
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {catalog.map((item) => {
            const isMalicious = Boolean(item.injection_warning)
            return (
              <div
                key={item.id}
                className={`bg-white rounded-xl border p-4 shadow-sm flex flex-col justify-between transition ${
                  isMalicious ? 'border-rose-300 ring-1 ring-rose-200' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-700 uppercase tracking-wider">
                      {item.category.replace('_', ' ')}
                    </span>
                    <span className="font-extrabold text-sm text-gray-900">
                      ${item.price.toFixed(2)}
                    </span>
                  </div>

                  <h3 className="font-bold text-gray-900 text-sm leading-snug">{item.name}</h3>
                  <div className="text-xs text-gray-500">Supplier: <span className="font-medium text-gray-700">{item.merchant}</span></div>

                  <p className="text-xs text-gray-600 line-clamp-3" title={item.description}>
                    {item.description}
                  </p>

                  {isMalicious && (
                    <div className="bg-rose-50 border border-rose-200 rounded-lg p-2 text-[11px] text-rose-800 font-medium">
                      ⚠️ {item.injection_warning}
                    </div>
                  )}
                </div>

                <div className="pt-3 mt-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 capitalize">
                    Expected: <strong className="text-gray-800">{item.expected_decision}</strong>
                  </span>
                  <button
                    onClick={() => handleRunAgent(item.scenario)}
                    disabled={isRunning}
                    className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
                  >
                    Run item →
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Live Decision Feed */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Agent Decision Feed</h2>
              <p className="text-xs text-gray-500">
                Live output from policy engine, Gemini semantic checks, and PayPal Vault charges.
              </p>
            </div>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              {results.filter((r) => r.passed_expected).length} / {results.length} Scenarios Matched Expectation
            </span>
          </div>

          <div className="space-y-3">
            {results.map((r, idx) => {
              const badgeColors: Record<string, string> = {
                approved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
                blocked: 'bg-rose-100 text-rose-800 border-rose-200',
                escalated: 'bg-amber-100 text-amber-900 border-amber-200',
              }

              return (
                <div
                  key={idx}
                  className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-sm text-gray-900">{r.name}</span>
                      <span
                        className={`text-xs uppercase font-extrabold px-2.5 py-0.5 rounded-full border ${
                          badgeColors[r.actual_decision] ?? 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {r.actual_decision}
                      </span>
                      {r.injection_flag && (
                        <span className="text-xs font-bold px-2 py-0.5 bg-rose-600 text-white rounded">
                          🚨 INJECTION INTERCEPTED
                        </span>
                      )}
                    </div>

                    <div className="text-sm font-semibold text-gray-800">
                      ${r.amount.toFixed(2)} USD • <span className="text-gray-500">{r.merchant}</span>
                    </div>
                  </div>

                  <div className="text-xs text-gray-700 bg-gray-50 rounded-lg p-3 space-y-1">
                    <div>
                      <span className="font-semibold text-gray-900">Item:</span> {r.item} ({r.category})
                    </div>
                    <div>
                      <span className="font-semibold text-gray-900">Policy Rationale:</span>{' '}
                      {r.reasons.length > 0 ? r.reasons.join(' • ') : r.message}
                    </div>
                    {r.paypal_capture_id && (
                      <div className="text-emerald-700 font-mono">
                        <span className="font-semibold">PayPal Capture ID:</span> {r.paypal_capture_id}
                      </div>
                    )}
                    {r.receipt_id && (
                      <div className="text-gray-500 font-mono">
                        <span className="font-semibold">Receipt Hash Chained:</span> #{r.receipt_id}
                      </div>
                    )}
                    {r.approve_url && (
                      <div className="pt-2">
                        <a
                          href={r.approve_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow transition"
                        >
                          <span>💳</span> Approve in PayPal (Fallback Mode) →
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Escalations Inbox */}
      {escalations.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📬</span>
              <div>
                <h2 className="text-lg font-bold text-amber-950">Escalations Inbox ({escalations.length})</h2>
                <p className="text-xs text-amber-800">
                  Agent purchases held for one-tap human authorization before PayPal execution.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {escalations.map((esc) => (
              <div
                key={esc.id}
                className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm flex flex-col justify-between space-y-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-gray-900">
                      Escalation #{esc.id}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 uppercase">
                      {esc.status}
                    </span>
                  </div>

                  {esc.receipt && (
                    <div className="text-xs text-gray-600 space-y-1">
                      <div className="font-medium text-gray-900">
                        {esc.receipt.item} (${esc.receipt.amount.toFixed(2)})
                      </div>
                      <div>Merchant: {esc.receipt.merchant}</div>
                      <div className="text-amber-800 bg-amber-50 p-2 rounded">
                        {esc.receipt.reasons.join(', ')}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => handleApproveEscalation(esc.id)}
                    className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm transition"
                  >
                    ✓ Approve & Charge
                  </button>
                  <button
                    onClick={() => handleDenyEscalation(esc.id)}
                    className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-lg transition"
                  >
                    ✕ Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
