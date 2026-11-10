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
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blocked: 'bg-rose-50 text-rose-700 border-rose-200',
    escalated: 'bg-amber-50 text-amber-800 border-amber-200',
    denied: 'bg-gray-100 text-gray-700 border-gray-200',
  }
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide border ${styles[value ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
      {value}
    </span>
  )
}

// ── Injection Warning Cell ───────────────────────────────────────────────────
function InjectionCell({ value }: { value?: boolean }) {
  if (!value) return <span className="text-[#5c6a82] text-xs">—</span>
  return (
    <span className="px-2.5 py-0.5 bg-rose-600 text-white rounded-full text-[11px] font-bold">
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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#003087] tracking-tight">Activity & Audit Ledger</h1>
          <p className="text-[#5c6a82] mt-1 text-sm">
            Cryptographically chained reasoning receipts for every agent purchase attempt.
          </p>
        </div>

        {/* Hash Chain Integrity Indicator & Action Buttons */}
        {chainStatus && (
          <div className="flex flex-wrap items-center gap-2.5">
            <div
              className={`flex items-center gap-3 px-4 py-2 rounded-full border text-xs font-medium shadow-sm ${
                chainStatus.valid
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <span className="text-base">{chainStatus.valid ? '🛡️' : '🚨'}</span>
              <div>
                <span className="font-bold">
                  {chainStatus.valid ? 'Hash Chain Verified' : 'Chain Tampering Detected!'}
                </span>
                <span className="mx-1.5 opacity-40">•</span>
                <span className="opacity-85">
                  {chainStatus.total_receipts} receipts
                  {!chainStatus.valid && ` (broken at #${chainStatus.broken_at_receipt_id})`}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={loadData}
                className="px-4 py-2 bg-white hover:bg-[#f0f7fc] text-[#0070ba] rounded-full text-xs font-bold border border-[#0070ba] shadow-sm transition flex items-center gap-1.5"
                title="Verify cryptographic SHA-256 chain across all receipts"
              >
                Verify Chain
              </button>

              <button
                onClick={handleSimulateTamper}
                className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-full text-xs font-bold shadow-sm transition flex items-center gap-1.5"
                title="Simulate direct database tampering by altering a receipt amount"
              >
                Simulate Tamper
              </button>

              {!chainStatus.valid && (
                <button
                  onClick={handleRepairChain}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-xs font-bold shadow-sm transition flex items-center gap-1.5"
                  title="Restore exact pre-tamper payload snapshot"
                >
                  Restore Chain
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {tamperBanner && (
        <div className="bg-[#f0f7fc] border border-[#b6dcf7] text-[#003087] p-4 rounded-2xl text-sm flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2.5">
            <span>ℹ️</span>
            <span className="font-medium">{tamperBanner}</span>
          </div>
          <button
            onClick={() => setTamperBanner(null)}
            className="text-xs text-[#0070ba] hover:text-[#003087] font-bold px-2 py-1 rounded-full"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-2xl text-sm shadow-sm">
          {actionError}
        </div>
      )}

      {/* Escalation Queue (One-Tap Human Decision) */}
      {escalations.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-6 space-y-4 shadow-pp-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-amber-950 text-base">
                Pending Your Authorization ({escalations.length})
              </h2>
              <p className="text-xs text-amber-800 mt-0.5">
                Purchases above your escalation threshold or flagged during fallback require one-tap approval before PayPal captures funds.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {escalations.map((esc) => (
              <div
                key={esc.id}
                className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <div className="font-bold text-[#0c1c3e] text-sm">{esc.receipt?.item}</div>
                    <span className="font-extrabold text-sm text-[#003087] tabular-nums shrink-0">
                      ${esc.receipt?.amount.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-[#5c6a82] mt-1">
                    Merchant: <span className="font-semibold text-[#0c1c3e]">{esc.receipt?.merchant}</span>
                  </div>
                  <div className="mt-3 text-xs bg-amber-50 border border-amber-100 p-2.5 rounded-xl text-amber-950">
                    <strong>Hold Reason:</strong> {esc.receipt?.reasons?.join(', ')}
                  </div>
                </div>

                <div className="flex gap-2.5 mt-4 pt-3 border-t border-[#eef2f6]">
                  <button
                    onClick={() => handleApprove(esc.id)}
                    className="flex-1 py-2 bg-[#ffc439] hover:bg-[#f2b82b] text-[#003087] rounded-full text-xs font-bold transition shadow-sm"
                  >
                    Approve & Charge PayPal
                  </button>
                  <button
                    onClick={() => handleDeny(esc.id)}
                    className="px-4 py-2 bg-[#f5f7fa] hover:bg-gray-200 text-[#0c1c3e] rounded-full text-xs font-semibold transition"
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
      <div className="bg-white border border-[#e5e9f0] rounded-2xl p-5 shadow-pp-card space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-[#003087] text-sm">Transaction & Reasoning Audit Chain (Click row for receipt)</h2>
          <span className="text-xs font-medium text-[#5c6a82]">{receipts.length} total attempts</span>
        </div>

        <div className="ag-theme-alpine w-full relative" style={{ height: 420 }}>
          {loading && (
            <div className="absolute inset-0 bg-white/75 flex items-center justify-center z-10 rounded-xl">
              <span className="text-sm font-semibold text-[#003087]">Loading activity ledger...</span>
            </div>
          )}
          <AgGridReact<Receipt>
            rowData={receipts}
            columnDefs={colDefs}
            animateRows
            rowHeight={48}
            onRowClicked={(e: RowClickedEvent<Receipt>) => setSelectedReceipt(e.data ?? null)}
            defaultColDef={{ resizable: true, sortable: true, filter: true }}
          />
        </div>
      </div>

      {/* Detail Modal / Drawer for Clicked Receipt */}
      {selectedReceipt && (
        <div className="fixed inset-0 bg-[#001c64]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-7 space-y-5 shadow-2xl border border-[#e5e9f0]">
            <div className="flex justify-between items-start border-b border-[#eef2f6] pb-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-lg font-extrabold text-[#003087]">
                    Transaction Receipt #{selectedReceipt.id}
                  </h3>
                  <DecisionBadge value={selectedReceipt.decision} />
                  {selectedReceipt.injection_flag && <InjectionCell value={true} />}
                </div>
                <div className="text-xs text-[#5c6a82] mt-1">
                  Recorded: {new Date(selectedReceipt.created_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="w-8 h-8 rounded-full bg-[#f5f7fa] hover:bg-gray-200 text-[#5c6a82] flex items-center justify-center text-sm font-bold transition"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm bg-[#f5f7fa] p-4 rounded-2xl border border-[#e5e9f0]">
              <div>
                <span className="text-[#5c6a82] text-xs font-semibold">Item</span>
                <div className="font-bold text-[#0c1c3e] mt-0.5">{selectedReceipt.item}</div>
              </div>
              <div>
                <span className="text-[#5c6a82] text-xs font-semibold">Merchant</span>
                <div className="font-bold text-[#0c1c3e] mt-0.5">{selectedReceipt.merchant}</div>
              </div>
              <div>
                <span className="text-[#5c6a82] text-xs font-semibold">Amount</span>
                <div className="font-extrabold text-[#003087] tabular-nums mt-0.5">
                  ${selectedReceipt.amount.toFixed(2)} {selectedReceipt.currency}
                </div>
              </div>
              <div>
                <span className="text-[#5c6a82] text-xs font-semibold">PayPal Capture ID</span>
                <div className="font-mono text-xs text-[#0070ba] font-semibold mt-0.5">
                  {selectedReceipt.paypal_capture_id ?? 'None'}
                </div>
              </div>
            </div>

            {selectedReceipt.agent_plan && (
              <div className="bg-[#f0f7fc] border border-[#b6dcf7] rounded-2xl p-4 text-xs">
                <span className="font-bold text-[#003087] block mb-1">Agent Stated Plan</span>
                <p className="text-[#0c1c3e]">{selectedReceipt.agent_plan}</p>
              </div>
            )}

            <div>
              <span className="text-[#5c6a82] text-xs block mb-1.5 font-bold uppercase tracking-wider">
                Policy Reasons & Rationale
              </span>
              <ul className="list-disc list-inside space-y-1 text-xs text-[#0c1c3e] bg-[#f5f7fa] p-3.5 rounded-2xl border border-[#e5e9f0]">
                {selectedReceipt.reasons?.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>

            {selectedReceipt.evidence?.approve_url && (
              <div className="bg-[#f0f7fc] border border-[#b6dcf7] p-4 rounded-2xl space-y-2.5">
                <div className="font-bold text-xs text-[#003087] uppercase tracking-wider">
                  PayPal Vault Fallback — Buyer Approval Required
                </div>
                <p className="text-xs text-[#5c6a82]">
                  This purchase was policy-approved in fallback mode without an automated server-side vault token.
                </p>
                <a
                  href={selectedReceipt.evidence.approve_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2 bg-[#ffc439] hover:bg-[#f2b82b] text-[#003087] rounded-full text-xs font-bold shadow-sm transition"
                >
                  Approve in PayPal →
                </a>
              </div>
            )}

            <div className="bg-[#001c64] text-sky-100 rounded-2xl p-4 space-y-2 text-xs font-mono">
              <div className="text-sky-300 text-[10px] uppercase tracking-wider font-sans font-bold">
                SHA-256 Cryptographic Chaining
              </div>
              <div>
                <span className="text-sky-300/80">Previous Hash:</span>
                <div className="break-all text-sky-100">{selectedReceipt.prev_hash}</div>
              </div>
              <div>
                <span className="text-emerald-300 font-semibold">Current Hash:</span>
                <div className="break-all text-emerald-300 font-bold">{selectedReceipt.hash}</div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedReceipt(null)}
                className="px-6 py-2 bg-[#0070ba] hover:bg-[#005ea6] text-white rounded-full text-sm font-semibold transition"
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
