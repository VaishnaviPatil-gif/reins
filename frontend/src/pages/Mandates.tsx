/**
 * Mandates page — the core user-facing permission UI.
 * Left: AG Grid table of all mandates.
 * Right: "New Mandate" builder form + Link PayPal button.
 */
import { useEffect, useState, useCallback } from 'react'
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
    active: 'bg-green-100 text-green-700',
    pending_link: 'bg-yellow-100 text-yellow-700',
    revoked: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${styles[value] ?? 'bg-gray-100 text-gray-600'}`}>
      {value}
    </span>
  )
}

// ── Budget bar cell renderer ──────────────────────────────────────────────────
function BudgetBar({ data }: ICellRendererParams) {
  if (!data) return null
  const pct = Math.min((data.budget_spent / data.budget_total) * 100, 100)
  return (
    <div className="flex items-center gap-2 h-full">
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${pct > 80 ? 'bg-red-500' : 'bg-brand-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 whitespace-nowrap">
        ${data.budget_spent.toFixed(2)} / ${data.budget_total.toFixed(2)}
      </span>
    </div>
  )
}

// ── Tag list helper ───────────────────────────────────────────────────────────
function TagList({ value }: ICellRendererParams) {
  if (!value || value.length === 0) return <span className="text-gray-400 text-xs">any</span>
  return (
    <div className="flex flex-wrap gap-1">
      {(value as string[]).map((t: string) => (
        <span key={t} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{t}</span>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Mandates() {
  const [mandates, setMandates] = useState<Mandate[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [linkingId, setLinkingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
      width: 220,
      cellRenderer: (p: ICellRendererParams<Mandate>) => {
        const m = p.data!
        return (
          <div className="flex gap-1 items-center h-full">
            {m.status === 'pending_link' && (
              <button
                onClick={() => handleLinkPayPal(m.id)}
                disabled={linkingId === m.id}
                className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {linkingId === m.id ? '…' : '🔗 Link PayPal'}
              </button>
            )}
            {m.status === 'active' && (
              <button
                onClick={() => handleRevoke(m.id)}
                className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded hover:bg-red-200"
              >
                Revoke
              </button>
            )}
            {m.status === 'active' && (
              <button
                onClick={() => handleLinkPayPal(m.id)}
                className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200"
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mandates</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Scoped, revocable spending permissions you grant to AI agents.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          {showForm ? '✕ Cancel' : '+ New Mandate'}
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm whitespace-pre-wrap">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm whitespace-pre-wrap">
          {success}
          <button onClick={() => setSuccess(null)} className="ml-2 text-green-500 hover:text-green-700">✕</button>
        </div>
      )}

      {/* New Mandate Form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">New Mandate</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* Agent */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Agent</label>
              <select
                value={form.agent_id}
                onChange={(e) => setForm((f) => ({ ...f, agent_id: Number(e.target.value) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {/* Budget Total */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Total Budget ($)</label>
              <input type="number" min="0" step="0.01"
                value={form.budget_total}
                onChange={(e) => setForm((f) => ({ ...f, budget_total: Number(e.target.value) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {/* Per-purchase cap */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Per-Purchase Cap ($)</label>
              <input type="number" min="0" step="0.01"
                value={form.per_purchase_cap}
                onChange={(e) => setForm((f) => ({ ...f, per_purchase_cap: Number(e.target.value) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {/* Escalate above */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Escalate If Above ($) <span className="text-gray-400">optional</span></label>
              <input type="number" min="0" step="0.01"
                value={form.escalate_above ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, escalate_above: e.target.value ? Number(e.target.value) : undefined }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {/* Valid From */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valid From <span className="text-gray-400">optional</span></label>
              <input type="datetime-local"
                onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {/* Valid Until */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valid Until <span className="text-gray-400">optional</span></label>
              <input type="datetime-local"
                onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
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
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <div className="flex gap-2">
                <input
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { addTag(field, state); setState('') } }}
                  placeholder="Type and press Enter"
                  className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
                />
                <button onClick={() => { addTag(field, state); setState('') }}
                  className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">Add</button>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {(form[field] ?? []).map((t) => (
                  <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                    {t}
                    <button onClick={() => removeTag(field, t)} className="text-blue-400 hover:text-blue-600">✕</button>
                  </span>
                ))}
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button onClick={handleCreate} className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
              Create Mandate
            </button>
          </div>
        </div>
      )}

      {/* AG Grid Table */}
      <div className="ag-theme-alpine w-full relative" style={{ height: 420 }}>
        {loading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
            <span className="text-sm font-medium text-gray-500">Loading mandates...</span>
          </div>
        )}
        <AgGridReact<Mandate>
          rowData={mandates}
          columnDefs={colDefs}
          animateRows
          rowHeight={48}
          defaultColDef={{ resizable: true, sortable: true }}
        />
      </div>

      {/* Link PayPal instructions box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">🔗 How "Link PayPal" works</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-700">
          <li>Create a mandate with your spending rules above.</li>
          <li>Click <strong>Link PayPal</strong> — a \$1 authorization opens in a new tab.</li>
          <li>Log in with your <strong>sandbox buyer account</strong> (not your developer account) and approve.</li>
          <li>You'll be redirected back — the \$1 is immediately refunded and the mandate becomes <span className="font-semibold text-green-700">active</span>.</li>
          <li>The agent can now spend through this mandate server-side — no future clicks needed.</li>
          <li>Click <strong>Revoke</strong> at any time to instantly cut off the agent.</li>
        </ol>
      </div>
    </div>
  )
}
