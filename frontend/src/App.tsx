import { Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Mandates from './pages/Mandates'
import Activity from './pages/Activity'
import Disputes from './pages/Disputes'
import AgentPlayground from './pages/AgentPlayground'

export default function App() {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-brand-600 text-white'
        : 'text-gray-600 hover:bg-gray-100'
    }`

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-6">
          <div className="flex items-center gap-2 mr-6">
            <span className="text-xl font-bold text-brand-700">🔐 Reins</span>
            <span className="text-xs text-gray-400 hidden sm:block">OAuth for your wallet</span>
          </div>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>Dashboard</NavLink>
            <NavLink to="/mandates" className={navClass}>Mandates</NavLink>
            <NavLink to="/activity" className={navClass}>Activity</NavLink>
            <NavLink to="/disputes" className={navClass}>Disputes</NavLink>
            <NavLink to="/agent" className={navClass}>Agent Playground</NavLink>
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/mandates" element={<Mandates />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/disputes" element={<Disputes />} />
          <Route path="/agent" element={<AgentPlayground />} />
        </Routes>
      </main>
    </div>
  )
}
