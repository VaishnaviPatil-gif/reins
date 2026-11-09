/**
 * Activity page — Audit trail of all purchases, cryptographic hash chain integrity,
 * and human one-tap escalation actions.
 */
import { useEffect, useState, useCallback } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, RowClickedEvent } from 'ag-grid-community'
import {
  fetchReceipts,
  verifyChain,
  fetchEscalations,
  approveEscalation,
  denyEscalation,
  simulateTamper,
  repairChain,
  type Receipt,
  type Escalation,
  type ChainVerification,
} from '../lib/api'

// ── Decision Badge Cell ──────────────────────────────────────────────────────
function DecisionBadge({ value }: { value?: string }) {
  const styles: Record<string, string> = {
    approved: 'bg-green-100 text-green-700 border-green-300',
    blocked: 'bg-red-100 text-red-700 border-red-300',
    escalated: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    denied: 'bg-gray-100 text-gray-700 border-gray-300',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider border ${styles[value ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
      {value}
    </span>
  )
}

// ── Injection Warning Cell ───────────────────────────────────────────────────
function InjectionCell({ value }: { value?: boolean }) {
  if (!value) return <span className="text-gray-400 text-xs">—</span>
  return (
    <span className="px-2 py-0.5 bg-red-600 text-white rounded text-xs font-bold animate-pulse">
      ⚠️ INJECTION
    </span>
  )
}

// ── Truncated Hash Cell ──────────────────────────────────────────────────────
function HashCell({ value }: { value?: string }) {
  if (!value) return <span className="text-gray-400 text-xs">—</span>
  return (
    <span className="font-mono text-xs text-gray-500 cursor-pointer" title={value}>
      {value.slice(0, 10)}…{value.slice(-6)}
    </span>
  )
}

export default function Activity() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [chainStatus, setChainStatus] = useState<ChainVerification | null>(null)
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState<string | null>(null)
  const [tamperBanner, setTamperBanner] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [r, e, c] = await Promise.all([
        fetchReceipts(),
        fetchEscalations(),
        verifyChain(),
      ])
      setReceipts(r)
      setEscalations(e)
      setChainStatus(c)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSimulateTamper = async () => {
    setActionError(null)
    setTamperBanner(null)
    try {
      const res = await simulateTamper()
      setTamperBanner(res.message)
      await loadData()
    } catch (err: any) {
      setActionError(err.response?.data?.detail ?? err.message)
    }
  }

  const handleRepairChain = async () => {
    setActionError(null)
    setTamperBanner(null)
    try {
      const res = await repairChain()
      setTamperBanner(`${res.message} (${res.receipts_rehashed} receipts re-hashed).`)
      await loadData()
    } catch (err: any) {
      setActionError(err.response?.data?.detail ?? err.message)
    }
  }

  const handleApprove = async (id: number) => {
    setActionError(null)
    try {
      await approveEscalation(id)
      loadData()
    } catch (err: any) {
      setActionError(err.response?.data?.detail ?? err.message)
    }
  }

  const handleDeny = async (id: number) => {
    setActionError(null)
    try {
      await denyEscalation(id)
      loadData()
    } catch (err: any) {
      setActionError(err.response?.data?.detail ?? err.message)
    }
  }

  const colDefs: ColDef<Receipt>[] = [
    { field: 'id', headerName: 'ID', width: 70 },
    { field: 'decision', headerName: 'Decision', width: 130, cellRenderer: DecisionBadge },
    {
      headerName: 'Item & Merchant',
      width: 250,
      valueGetter: (p) => `${p.data?.item} (${p.data?.merchant})`,
    },
    {
      field: 'amount',
      headerName: 'Amount',
      width: 110,
      valueFormatter: (p) => `$${p.value?.toFixed(2)} ${p.data?.currency ?? 'USD'}`,
    },
    {
      headerName: 'Categories',
      width: 190,
      valueGetter: (p) =>
        p.data?.category_verified
          ? `${p.data.category_claimed || 'any'} → ${p.data.category_verified}`
          : p.data?.category_claimed || 'any',
    },
    {
      field: 'injection_flag',
      headerName: 'Prompt Attack',
      width: 140,
      cellRenderer: InjectionCell,
    },
    {
      field: 'paypal_capture_id',
      headerName: 'PayPal Capture ID',
      width: 170,
      valueFormatter: (p) => p.value ?? '—',
    },
    {
      field: 'hash',
      headerName: 'SHA-256 Receipt Hash',
      width: 180,
      cellRenderer: HashCell,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Page Title & Integrity Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activity & Audit Log</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Cryptographically chained reasoning receipts for every purchase attempt.
          </p>
        </div>

        {/* Hash Chain Integrity Indicator & Action Buttons */}
        {chainStatus && (
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm font-medium ${
                chainStatus.valid
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              <span className="text-lg">{chainStatus.valid ? '🛡️' : '🚨'}</span>
              <div>
                <div className="font-semibold">
                  {chainStatus.valid ? 'Hash Chain Verified' : 'Chain Tampering Detected!'}
                </div>
                <div className="text-xs opacity-80">
                  {chainStatus.total_receipts} receipts chained via SHA-256
                  {!chainStatus.valid && ` (broken at #${chainStatus.broken_at_receipt_id})`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={loadData}
                className="px-3 py-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold border shadow-sm transition flex items-center gap-1.5"
                title="Verify cryptographic SHA-256 chain across all receipts"
              >
                <span>🔍</span> Verify Chain
              </button>

              <button
                onClick={handleSimulateTamper}
                className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1.5"
                title="Simulate direct database tampering by altering a receipt amount"
              >
                <span>💥</span> Simulate Tamper
              </button>

              {!chainStatus.valid && (
                <button
                  onClick={handleRepairChain}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1.5"
                  title="Recalculate hashes to restore valid chain"
                >
                  <span>🔧</span> Restore Chain
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {tamperBanner && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 p-3.5 rounded-xl text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>ℹ️</span>
            <span>{tamperBanner}</span>
          </div>
          <button
            onClick={() => setTamperBanner(null)}
            className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
          {actionError}
        </div>
      )}

      {/* Escalation Queue (One-Tap Human Decision) */}
      {escalations.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <h2 className="font-bold text-amber-900">
              Pending Human Approval ({escalations.length})
            </h2>
          </div>
          <p className="text-xs text-amber-800">
            The policy engine identified purchases requiring human authorization.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {escalations.map((esc) => (
              <div
                key={esc.id}
                className="bg-white border border-amber-200 rounded-lg p-4 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <div className="font-bold text-gray-900">{esc.receipt?.item}</div>
                    <span className="font-mono font-bold text-sm text-gray-800">
                      ${esc.receipt?.amount.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Merchant: <span className="font-medium text-gray-700">{esc.receipt?.merchant}</span>
                  </div>
                  <div className="mt-2 text-xs bg-amber-100/60 p-2 rounded text-amber-900">
                    <strong>Reason:</strong> {esc.receipt?.reasons?.join(', ')}
                  </div>
                </div>

                <div className="flex gap-2 mt-4 pt-2 border-t">
                  <button
                    onClick={() => handleApprove(esc.id)}
                    className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition shadow-sm"
                  >
                    ✓ One-Tap Approve
                  </button>
                  <button
                    onClick={() => handleDeny(esc.id)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-medium transition"
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AG Grid Table */}
      <div className="bg-white border rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-gray-800 text-sm">Receipt Audit Chain (Click row for details)</h2>
          <span className="text-xs text-gray-400">Total: {receipts.length} attempts</span>
        </div>

        <div className="ag-theme-alpine w-full relative" style={{ height: 420 }}>
          {loading && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
              <span className="text-sm font-medium text-gray-500">Loading audit trail...</span>
            </div>
          )}
          <AgGridReact<Receipt>
            rowData={receipts}
            columnDefs={colDefs}
            animateRows
            rowHeight={46}
            onRowClicked={(e: RowClickedEvent<Receipt>) => setSelectedReceipt(e.data ?? null)}
            defaultColDef={{ resizable: true, sortable: true, filter: true }}
          />
        </div>
      </div>

      {/* Detail Modal / Drawer for Clicked Receipt */}
      {selectedReceipt && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
            <div className="flex justify-between items-start border-b pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900">
                    Receipt #{selectedReceipt.id}
                  </h3>
                  <DecisionBadge value={selectedReceipt.decision} />
                  {selectedReceipt.injection_flag && <InjectionCell value={true} />}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Created at: {new Date(selectedReceipt.created_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500 text-xs">Item</span>
                <div className="font-semibold text-gray-800">{selectedReceipt.item}</div>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Merchant</span>
                <div className="font-semibold text-gray-800">{selectedReceipt.merchant}</div>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Amount</span>
                <div className="font-semibold text-gray-800">
                  ${selectedReceipt.amount.toFixed(2)} {selectedReceipt.currency}
                </div>
              </div>
              <div>
                <span className="text-gray-500 text-xs">PayPal Capture ID</span>
                <div className="font-mono text-xs text-gray-800">
                  {selectedReceipt.paypal_capture_id ?? 'None'}
                </div>
              </div>
            </div>

            {selectedReceipt.agent_plan && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs">
                <span className="font-bold text-blue-900 block mb-1">Agent Stated Plan:</span>
                <p className="text-blue-800">{selectedReceipt.agent_plan}</p>
              </div>
            )}

            <div>
              <span className="text-gray-500 text-xs block mb-1 font-semibold">
                Policy Reasons & Rationale:
              </span>
              <ul className="list-disc list-inside space-y-1 text-xs text-gray-700 bg-gray-50 p-3 rounded-lg border">
                {selectedReceipt.reasons?.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>

            {selectedReceipt.evidence?.approve_url && (
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl space-y-2">
                <div className="font-semibold text-xs text-blue-900 uppercase">
                  PayPal Vault Fallback — Buyer Approval Required
                </div>
                <p className="text-xs text-blue-700">
                  This purchase was policy-approved in fallback mode without an automated server-side vault token.
                </p>
                <a
                  href={selectedReceipt.evidence.approve_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow transition"
                >
                  <span>💳</span> Approve in PayPal →
                </a>
              </div>
            )}

            <div className="bg-slate-900 text-slate-100 rounded-xl p-4 space-y-2 text-xs font-mono">
              <div className="text-slate-400 text-[10px] uppercase tracking-wider font-sans font-bold">
                Cryptographic Chaining
              </div>
              <div>
                <span className="text-slate-400">Previous Hash:</span>
                <div className="break-all text-slate-300">{selectedReceipt.prev_hash}</div>
              </div>
              <div>
                <span className="text-emerald-400">Current Hash:</span>
                <div className="break-all text-emerald-300 font-bold">{selectedReceipt.hash}</div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedReceipt(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
