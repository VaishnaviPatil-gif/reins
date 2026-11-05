import { useEffect, useState } from 'react'
import { fetchHealth } from '../lib/api'

interface Health {
  status: string
  version: string
  db: string
  paypal: string
}

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((e) => setError(e.message))
  }, [])

  const badge = (val: string) => (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold ${
        val === 'ok' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {val}
    </span>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">System status at a glance.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          Could not reach API: {error}. Make sure the backend is running on port 8000.
        </div>
      )}

      {health && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 max-w-md">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
            API Health
          </h2>
          <dl className="space-y-3">
            <div className="flex justify-between items-center">
              <dt className="text-sm text-gray-600">Status</dt>
              <dd>{badge(health.status)}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-sm text-gray-600">Version</dt>
              <dd className="text-sm font-mono text-gray-700">{health.version}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-sm text-gray-600">Database</dt>
              <dd>{badge(health.db)}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-sm text-gray-600">PayPal Sandbox</dt>
              <dd>{badge(health.paypal)}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}
