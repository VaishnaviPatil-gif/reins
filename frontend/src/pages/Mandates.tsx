/**
 * Mandates page — the core user-facing permission UI.
 * Left: AG Grid table of all mandates.
 * Right: "New Mandate" builder form + Link PayPal button.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import {
  fetchMandates,
  fetchAgents,
  createMandate,
  linkPaypalStart,
  revokeMandate,
  type Mandate,
  type Agent,
  type MandateCreate,
} from '../lib/api'

// ── Status badge cell renderer ────────────────────────────────────────────────
function StatusBadge({ value }: ICellRendererParams) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    pending_link: 'bg-amber-50 text-amber-800 border border-amber-200',
    revoked: 'bg-rose-50 text-rose-700 border border-rose-200',
  }
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[value] ?? 'bg-gray-100 text-gray-600'}`}>
      {value === 'active' ? 'Active' : value === 'pending_link' ? 'Pending Link' : value === 'revoked' ? 'Revoked' : value}
    </span>
  )
}

// ── Budget bar cell renderer ──────────────────────────────────────────────────
function BudgetBar({ data }: ICellRendererParams) {
  if (!data) return null
  const pct = Math.min((data.budget_spent / data.budget_total) * 100, 100)
  return (
    <div className="flex items-center gap-2.5 h-full">
      <div className="flex-1 bg-[#eef2f6] rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all ${pct > 80 ? 'bg-rose-500' : 'bg-gradient-to-r from-[#003087] to-[#009cde]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-[#0c1c3e] tabular-nums whitespace-nowrap">
        ${data.budget_spent.toFixed(2)} / ${data.budget_total.toFixed(2)}
      </span>
    </div>
  )
}

// ── Tag list helper ───────────────────────────────────────────────────────────
function TagList({ value }: ICellRendererParams) {
  if (!value || value.length === 0) return <span className="text-[#5c6a82] text-xs">any</span>
  return (
    <div className="flex flex-wrap gap-1">
      {(value as string[]).map((t: string) => (
        <span key={t} className="px-2 py-0.5 bg-[#f0f7fc] text-[#003087] border border-[#dceefa] rounded-full text-[11px] font-medium">{t}</span>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
function decodeJwtPayload(token: string | null): Record<string, any> | null {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

export default function Mandates() {
  const gridRef = useRef<AgGridReact<Mandate>>(null)
  const [mandates, setMandates] = useState<Mandate[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [linkingId, setLinkingId] = useState<number | null>(null)
  const [inspectedMandate, setInspectedMandate] = useState<Mandate | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)
  const [quickFilter, setQuickFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const isLinked = searchParams.get('linked') === '1'
  const linkError = searchParams.get('link_error')

  // Form state
  const [form, setForm] = useState<Partial<MandateCreate>>({
    agent_id: 0,
    budget_total: 100,
    per_purchase_cap: 25,
    escalate_above: 20,
    allowed_categories: [],
    allowed_merchants: [],
    blocked_merchants: [],
  })
  const [catInput, setCatInput] = useState('')
  const [allowInput, setAllowInput] = useState('')
  const [blockInput, setBlockInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [m, a] = await Promise.all([fetchMandates(), fetchAgents()])
      setMandates(m)
      setAgents(a)
      if (a.length > 0 && !form.agent_id) setForm((f) => ({ ...f, agent_id: a[0].id }))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setError(null)
    try {
      await createMandate(form as MandateCreate)
      setSuccess('Mandate created. Click "Link PayPal" to activate it.')
      setShowForm(false)
      load()
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message)
    }
  }

  const handleLinkPayPal = async (mandateId: number) => {
    setLinkingId(mandateId)
    setError(null)
    try {
      const { approve_url, instructions } = await linkPaypalStart(mandateId)
      setSuccess(`${instructions}\n\nOpening PayPal approval page...`)
      window.open(approve_url, '_blank')
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message)
    } finally {
      setLinkingId(null)
      setTimeout(load, 3000) // Refresh after a few seconds to pick up vault_id
    }
  }

  const handleRevoke = async (mandateId: number) => {
    if (!confirm('Revoke this mandate? The agent will immediately lose spending permission.')) return
    setError(null)
    try {
      await revokeMandate(mandateId)
      setSuccess('Mandate revoked. PayPal vault token deleted.')
      load()
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message)
    }
  }

  // ── AG Grid column defs ────────────────────────────────────────────────────
  const colDefs: ColDef<Mandate>[] = [
    { field: 'id', headerName: 'ID', width: 60 },
    { field: 'status', headerName: 'Status', width: 130, cellRenderer: StatusBadge },
    {
      headerName: 'Budget Used',
      width: 220,
      cellRenderer: BudgetBar,
    },
    { field: 'per_purchase_cap', headerName: 'Cap / Purchase', width: 130,
      valueFormatter: (p) => `$${p.value?.toFixed(2)}` },
    { field: 'escalate_above', headerName: 'Escalate >', width: 120,
      valueFormatter: (p) => p.value ? `$${p.value.toFixed(2)}` : '—' },
    { field: 'allowed_categories', headerName: 'Categories', width: 180, cellRenderer: TagList },
    { field: 'vault_id', headerName: 'Vault ID', width: 180,
      valueFormatter: (p) => p.value ? `${p.value.slice(0, 12)}…` : '—' },
    {
      headerName: 'Actions',
      width: 270,
      cellRenderer: (p: ICellRendererParams<Mandate>) => {
        const m = p.data!
        return (
          <div className="flex gap-1.5 items-center h-full">
            {m.status === 'pending_link' && (
              <button
                onClick={() => handleLinkPayPal(m.id)}
                disabled={linkingId === m.id}
                className="px-3 py-1 bg-[#ffc439] hover:bg-[#f2b82b] text-[#003087] text-xs font-bold rounded-full shadow-sm disabled:opacity-50 transition"
              >
                {linkingId === m.id ? 'Linking…' : 'Link PayPal'}
              </button>
            )}
            {m.token && (
              <button
                onClick={() => {
                  setCopiedToken(false)
                  setInspectedMandate(m)
                }}
                className="px-3 py-1 bg-[#f0f7fc] text-[#0070ba] border border-[#b6dcf7] text-xs font-semibold rounded-full hover:bg-[#e1f0fb] transition"
                title="Inspect scoped HMAC JWT token"
              >
                Inspect JWT
              </button>
            )}
            {m.status === 'active' && (
              <button
                onClick={() => handleRevoke(m.id)}
                className="px-3 py-1 bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold rounded-full hover:bg-rose-100 transition"
              >
                Revoke
              </button>
            )}
            {m.status === 'active' && (
              <button
                onClick={() => handleLinkPayPal(m.id)}
                className="px-3 py-1 bg-[#f5f7fa] text-[#003087] border border-[#e5e9f0] text-xs font-semibold rounded-full hover:bg-[#e8edf5] transition"
                title="Refresh vault link"
              >
                Re-link
              </button>
            )}
          </div>
        )
      },
    },
  ]

  const addTag = (field: 'allowed_categories' | 'allowed_merchants' | 'blocked_merchants', val: string) => {
    if (!val.trim()) return
    setForm((f) => ({ ...f, [field]: [...(f[field] ?? []), val.trim()] }))
  }
  const removeTag = (field: 'allowed_categories' | 'allowed_merchants' | 'blocked_merchants', val: string) => {
    setForm((f) => ({ ...f, [field]: (f[field] ?? []).filter((t) => t !== val) }))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#003087] tracking-tight">Wallet & Spending Mandates</h1>
          <p className="text-[#5c6a82] mt-1 text-sm">
            Scoped, revocable spending rules linked directly to your PayPal Vault funding source.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className={`px-5 py-2.5 rounded-full text-sm font-semibold shadow-sm transition self-start sm:self-auto ${
            showForm
              ? 'bg-white border border-[#e5e9f0] text-[#0c1c3e] hover:bg-gray-50'
              : 'bg-[#0070ba] hover:bg-[#005ea6] text-white'
          }`}
        >
          {showForm ? '✕ Cancel' : '+ New Mandate'}
        </button>
      </div>

      {/* Link PayPal Redirect Banners */}
      {isLinked && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-2xl flex items-center justify-between shadow-pp-card">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              ✓
            </div>
            <div>
              <div className="font-bold text-sm">PayPal Account Linked Successfully!</div>
              <div className="text-xs text-emerald-800">
                Your payment method is vaulted with PayPal. Mandate is now active and authorized for autonomous agent purchases.
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              searchParams.delete('linked')
              setSearchParams(searchParams)
            }}
            className="text-xs font-bold text-emerald-700 hover:text-emerald-900 px-3 py-1 rounded-full hover:bg-emerald-100 transition"
          >
            Dismiss
          </button>
        </div>
      )}

      {linkError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-900 p-4 rounded-2xl flex items-center justify-between shadow-pp-card">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <div className="font-bold text-sm">PayPal Vault Linking Error ({linkError})</div>
              <div className="text-xs text-rose-700">
                {linkError === 'vault_failed'
                  ? 'PayPal did not return status VAULTED. Ensure Reference Transactions / Vaulting is enabled in your PayPal Developer sandbox account.'
                  : linkError === 'cancelled'
                  ? 'PayPal approval was cancelled by the user. The mandate remains in pending_link state.'
                  : `PayPal approval could not be finalized: ${linkError}`}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              searchParams.delete('link_error')
              setSearchParams(searchParams)
            }}
            className="text-xs font-bold text-rose-600 hover:text-rose-800 px-3 py-1 rounded-full hover:bg-rose-100 transition"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-800 text-sm whitespace-pre-wrap shadow-sm">{error}</div>
      )}
      {success && (
        <div className="bg-[#f0f7fc] border border-[#b6dcf7] rounded-2xl p-4 text-[#003087] text-sm whitespace-pre-wrap flex items-start justify-between gap-3 shadow-sm">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="text-[#0070ba] hover:text-[#003087] font-bold">✕</button>
        </div>
      )}

      {/* New Mandate Form */}
      {showForm && (
        <div className="bg-white border border-[#e5e9f0] rounded-2xl shadow-pp-card p-6 space-y-5">
          <h2 className="font-bold text-[#003087] text-base">Create Spending Mandate</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Agent */}
            <div>
              <label className="block text-xs font-semibold text-[#5c6a82] mb-1">Agent</label>
              <select
                value={form.agent_id}
                onChange={(e) => setForm((f) => ({ ...f, agent_id: Number(e.target.value) }))}
                className="w-full border border-[#d6dce5] rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[#0070ba] focus:outline-none"
              >
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {/* Budget Total */}
            <div>
              <label className="block text-xs font-semibold text-[#5c6a82] mb-1">Total Budget ($)</label>
              <input type="number" min="0" step="0.01"
                value={form.budget_total}
                onChange={(e) => setForm((f) => ({ ...f, budget_total: Number(e.target.value) }))}
                className="w-full border border-[#d6dce5] rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[#0070ba] focus:outline-none"
              />
            </div>
            {/* Per-purchase cap */}
            <div>
              <label className="block text-xs font-semibold text-[#5c6a82] mb-1">Per-Purchase Cap ($)</label>
              <input type="number" min="0" step="0.01"
                value={form.per_purchase_cap}
                onChange={(e) => setForm((f) => ({ ...f, per_purchase_cap: Number(e.target.value) }))}
                className="w-full border border-[#d6dce5] rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[#0070ba] focus:outline-none"
              />
            </div>
            {/* Escalate above */}
            <div>
              <label className="block text-xs font-semibold text-[#5c6a82] mb-1">Escalate If Above ($) <span className="text-gray-400 font-normal">optional</span></label>
              <input type="number" min="0" step="0.01"
                value={form.escalate_above ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, escalate_above: e.target.value ? Number(e.target.value) : undefined }))}
                className="w-full border border-[#d6dce5] rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[#0070ba] focus:outline-none"
              />
            </div>
            {/* Valid From */}
            <div>
              <label className="block text-xs font-semibold text-[#5c6a82] mb-1">Valid From <span className="text-gray-400 font-normal">optional</span></label>
              <input type="datetime-local"
                onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                className="w-full border border-[#d6dce5] rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[#0070ba] focus:outline-none"
              />
            </div>
            {/* Valid Until */}
            <div>
              <label className="block text-xs font-semibold text-[#5c6a82] mb-1">Valid Until <span className="text-gray-400 font-normal">optional</span></label>
              <input type="datetime-local"
                onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                className="w-full border border-[#d6dce5] rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[#0070ba] focus:outline-none"
              />
            </div>
          </div>

          {/* Tag fields */}
          {([
            { label: 'Allowed Categories', field: 'allowed_categories' as const, state: catInput, setState: setCatInput },
            { label: 'Allowed Merchants (empty = all)', field: 'allowed_merchants' as const, state: allowInput, setState: setAllowInput },
            { label: 'Blocked Merchants', field: 'blocked_merchants' as const, state: blockInput, setState: setBlockInput },
          ]).map(({ label, field, state, setState }) => (
            <div key={field}>
              <label className="block text-xs font-semibold text-[#5c6a82] mb-1">{label}</label>
              <div className="flex gap-2">
                <input
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { addTag(field, state); setState('') } }}
                  placeholder="Type and press Enter"
                  className="flex-1 border border-[#d6dce5] rounded-xl px-3.5 py-2 text-sm focus:ring-2 focus:ring-[#0070ba] focus:outline-none"
                />
                <button onClick={() => { addTag(field, state); setState('') }}
                  className="px-4 py-2 bg-[#f5f7fa] hover:bg-[#e8edf5] text-[#003087] font-semibold rounded-full text-xs transition">Add</button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(form[field] ?? []).map((t) => (
                  <span key={t} className="flex items-center gap-1.5 px-2.5 py-0.5 bg-[#f0f7fc] text-[#003087] border border-[#dceefa] rounded-full text-xs font-medium">
                    {t}
                    <button onClick={() => removeTag(field, t)} className="text-[#0070ba] hover:text-[#003087]">✕</button>
                  </span>
                ))}
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowForm(false)} className="px-5 py-2 text-sm font-semibold text-[#5c6a82] hover:text-[#0c1c3e]">Cancel</button>
            <button onClick={handleCreate} className="px-6 py-2 bg-[#0070ba] hover:bg-[#005ea6] text-white text-sm font-semibold rounded-full shadow-sm transition">
              Create Mandate
            </button>
          </div>
        </div>
      )}

      {/* AG Grid Table Card */}
      <div className="bg-white rounded-2xl border border-[#e5e9f0] shadow-pp-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-[#003087] text-sm">Authorized Spending Mandates</h2>
            <p className="text-xs text-[#5c6a82]">{mandates.length} mandate{mandates.length === 1 ? '' : 's'} configured</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              placeholder="Filter mandates..."
              className="px-3.5 py-1.5 bg-[#f5f7fa] border border-[#d6dce5] rounded-full text-xs text-[#0c1c3e] focus:bg-white focus:ring-2 focus:ring-[#0070ba] focus:outline-none w-48"
            />
            <button
              onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: 'reins-mandates.csv' })}
              className="px-4 py-1.5 bg-white hover:bg-[#f0f7fc] text-[#0070ba] border border-[#0070ba] rounded-full text-xs font-bold transition"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="ag-theme-alpine w-full relative" style={{ height: 420 }}>
          {loading && (
            <div className="absolute inset-0 bg-white/75 flex items-center justify-center z-10 rounded-xl">
              <span className="text-sm font-semibold text-[#003087]">Loading mandates...</span>
            </div>
          )}
          <AgGridReact<Mandate>
            ref={gridRef}
            rowData={mandates}
            columnDefs={colDefs}
            quickFilterText={quickFilter}
            animateRows
            rowHeight={50}
            defaultColDef={{ resizable: true, sortable: true, filter: true }}
          />
        </div>
      </div>

      {/* Link PayPal instructions box */}
      <div className="bg-white border border-[#e5e9f0] rounded-2xl p-6 shadow-pp-card text-sm">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="px-2.5 py-0.5 rounded-full bg-[#e8f4fd] text-[#003087] text-xs font-bold">PayPal Vault</span>
          <p className="font-bold text-[#003087]">How "Link PayPal" works</p>
        </div>
        <ol className="list-decimal list-inside space-y-1.5 text-xs sm:text-sm text-[#5c6a82]">
          <li>Create a mandate with your spending rules above.</li>
          <li>Click <strong className="text-[#0c1c3e]">Link PayPal</strong> — a $1.00 authorization opens in a new tab.</li>
          <li>Log in with your <strong className="text-[#0c1c3e]">US Sandbox Personal (Buyer)</strong> account and approve.</li>
          <li>You'll be redirected back — the $1.00 is immediately refunded and the mandate becomes <span className="font-semibold text-emerald-700">Active</span>.</li>
          <li>The agent can now spend through this mandate server-side — no future clicks needed.</li>
          <li>Click <strong className="text-[#0c1c3e]">Revoke</strong> at any time to delete the PayPal Vault token and cut off the agent immediately.</li>
        </ol>
      </div>

      {/* Scoped JWT Mandate Token Inspector Modal */}
      {inspectedMandate && (
        <div className="fixed inset-0 bg-[#001c64]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-7 space-y-5 shadow-2xl border border-[#e5e9f0]">
            <div className="flex justify-between items-start border-b border-[#eef2f6] pb-4">
              <div>
                <h3 className="text-lg font-extrabold text-[#003087]">
                  OAuth for Your Wallet — Mandate #{inspectedMandate.id} Token
                </h3>
                <p className="text-xs text-[#5c6a82] mt-1">
                  This HMAC-SHA256 signed JWT is the only credential the AI agent receives.
                </p>
              </div>
              <button
                onClick={() => setInspectedMandate(null)}
                className="w-8 h-8 rounded-full bg-[#f5f7fa] hover:bg-gray-200 text-[#5c6a82] flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 text-xs">
              <div className="bg-[#f0f7fc] border border-[#b6dcf7] rounded-2xl p-4 space-y-1.5">
                <div className="font-bold text-[#003087]">What the AI Agent Holds</div>
                <p className="text-[#5c6a82]">
                  Scoped, versioned JWT mandate token bound to ${inspectedMandate.per_purchase_cap.toFixed(2)} max/order and ${inspectedMandate.budget_total.toFixed(2)} budget.
                </p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-1.5">
                <div className="font-bold text-emerald-900">Locked Inside Reins Server</div>
                <p className="text-emerald-800 font-mono">
                  vault_id: {inspectedMandate.vault_id ?? 'Not linked yet'}
                </p>
                <p className="text-emerald-700">Never exposed to any LLM prompt or agent memory.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#5c6a82]">Signed Mandate JWT</span>
                <button
                  onClick={() => {
                    if (inspectedMandate.token) {
                      navigator.clipboard?.writeText(inspectedMandate.token)
                      setCopiedToken(true)
                    }
                  }}
                  className="text-xs font-bold text-[#0070ba] hover:underline"
                >
                  {copiedToken ? '✓ Copied to clipboard' : 'Copy Token'}
                </button>
              </div>
              <div className="bg-[#001c64] text-sky-100 rounded-2xl p-4 font-mono text-xs break-all select-all">
                {inspectedMandate.token}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#5c6a82]">Decoded Claims Payload</span>
              <pre className="bg-[#f5f7fa] border border-[#e5e9f0] rounded-2xl p-4 font-mono text-xs text-[#0c1c3e] overflow-x-auto">
                {JSON.stringify(decodeJwtPayload(inspectedMandate.token), null, 2)}
              </pre>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setInspectedMandate(null)}
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
