import { Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Mandates from './pages/Mandates'
import Activity from './pages/Activity'
import AgentPlayground from './pages/AgentPlayground'

export default function App() {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150 whitespace-nowrap ${
      isActive
        ? 'bg-white/15 text-white shadow-inner ring-1 ring-white/25'
        : 'text-blue-100/85 hover:text-white hover:bg-white/10'
    }`

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f7fa] text-[#0c1c3e]">
      {/* PayPal-style Deep Navy Top Header */}
      <header className="bg-gradient-to-r from-[#001c64] via-[#003087] to-[#003087] text-white sticky top-0 z-20 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 min-h-16 py-2 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6 flex-wrap">
            {/* Brand Logo */}
            <NavLink to="/" className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm">
                {/* Interlocking PayPal-inspired Reins Shield Monogram */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M7.5 4h6.8c2.9 0 4.7 1.5 4.2 4.3-.4 2.5-2.2 3.9-4.9 3.9H11l-.9 5.3H6.7L9 4z"
                    fill="#003087"
                  />
                  <path
                    d="M10.2 7.5h6.1c2.4 0 3.9 1.3 3.5 3.7-.4 2.1-1.9 3.3-4.2 3.3h-2.3l-.8 4.5H9.6l1.8-11.5z"
                    fill="#009cde"
                    fillOpacity="0.88"
                  />
                </svg>
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-lg font-extrabold tracking-tight text-white">Reins</span>
                <span className="text-[10px] font-medium tracking-wider text-sky-200 uppercase">
                  Policy Layer for PayPal
                </span>
              </div>
            </NavLink>

            {/* Primary Nav Pills */}
            <nav className="flex items-center gap-1 flex-wrap">
              <NavLink to="/" end className={navClass}>Overview</NavLink>
              <NavLink to="/mandates" className={navClass}>Wallet & Mandates</NavLink>
              <NavLink to="/activity" className={navClass}>Activity & Audit</NavLink>
              <NavLink to="/agent" className={navClass}>Agent Playground</NavLink>
            </nav>
          </div>

          {/* Right Sandbox Indicator */}
          <div className="hidden lg:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs font-medium text-sky-100 shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#ffc439]" />
            <span>PayPal Sandbox Mode</span>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/mandates" element={<Mandates />} />
          <Route path="/mandates/:id" element={<Mandates />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/agent" element={<AgentPlayground />} />
        </Routes>
      </main>

      {/* Subtle PayPal-style Footer */}
      <footer className="border-t border-[#e5e9f0] bg-white/80 py-5 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#5c6a82]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#003087]">Reins</span>
            <span>•</span>
            <span>OAuth & Policy Guardrails for Autonomous AI Commerce</span>
          </div>
          <div className="flex items-center gap-4">
            <span>PayPal Orders v2 + Vault</span>
            <span>•</span>
            <span>Gemini 3.6 Flash Guard</span>
            <span>•</span>
            <span>SHA-256 Audit Chain</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
