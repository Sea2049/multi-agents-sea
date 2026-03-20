import { AnimatePresence, motion } from 'framer-motion'
import { Users, Search } from 'lucide-react'
import { useMemo } from 'react'
import { Agent, Division } from '../data/agents'
import AgentCard from './AgentCard'

interface DivisionViewProps {
  divisions: Division[]
  selectedDivision: string | null
  searchQuery: string
  teamAgents: Agent[]
  onAgentSelect: (agent: Agent) => void
  onTeamToggle: (agent: Agent) => void
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}) {
  return (
    <div
      className="flex items-center gap-3 px-5 py-4 rounded-xl bg-gray-900 border border-gray-800"
      style={{ borderColor: `${color}33` }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: `${color}22` }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-white leading-none">{value}</p>
        <p className="text-gray-400 text-xs mt-0.5">{label}</p>
      </div>
    </div>
  )
}

export default function DivisionView({
  divisions,
  selectedDivision,
  searchQuery,
  teamAgents,
  onAgentSelect,
  onTeamToggle,
}: DivisionViewProps) {
  const teamAgentIds = useMemo(
    () => new Set(teamAgents.map((a) => a.id)),
    [teamAgents]
  )

  const getDivisionColor = (divisionId: string) => {
    return divisions.find((d) => d.id === divisionId)?.color ?? '#6366f1'
  }

  // 过滤逻辑
  const filteredData = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()

    if (selectedDivision) {
      const div = divisions.find((d) => d.id === selectedDivision)
      if (!div) return []
      const agents = q
        ? div.agents.filter(
            (a) =>
              a.name.toLowerCase().includes(q) ||
              a.vibe.toLowerCase().includes(q) ||
              a.description.toLowerCase().includes(q)
          )
        : div.agents
      return [{ ...div, agents }]
    }

    // 全部模式
    return divisions
      .map((div) => ({
        ...div,
        agents: q
          ? div.agents.filter(
              (a) =>
                a.name.toLowerCase().includes(q) ||
                a.vibe.toLowerCase().includes(q) ||
                a.description.toLowerCase().includes(q)
            )
          : div.agents,
      }))
      .filter((div) => div.agents.length > 0)
  }, [divisions, selectedDivision, searchQuery])

  const totalAgents = useMemo(
    () => divisions.reduce((sum, d) => sum + d.agents.length, 0),
    [divisions]
  )

  const isEmpty =
    filteredData.length === 0 ||
    filteredData.every((d) => d.agents.length === 0)

  // 单个部门视图
  if (selectedDivision) {
    const div = filteredData[0]
    if (!div) return null

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* 部门标题 */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4">
          <div className="flex items-center gap-4">
            <span className="text-5xl">{div.emoji}</span>
            <div>
              <h1 className="text-2xl font-bold text-white">{div.name}</h1>
              <p className="text-gray-400 text-sm mt-0.5">
                {div.nameZh} · {div.agents.length} 个 Agent
              </p>
            </div>
            <div
              className="ml-auto px-3 py-1 rounded-full text-sm font-medium"
              style={{
                backgroundColor: `${div.color}22`,
                color: div.color,
                border: `1px solid ${div.color}44`,
              }}
            >
              {div.agents.length} agents
            </div>
          </div>
        </div>

        {/* 分割线 */}
        <div className="flex-shrink-0 mx-6 border-t border-gray-800" />

        {/* Grid 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <AnimatePresence mode="wait">
            {isEmpty ? (
              <EmptyState query={searchQuery} key="empty" />
            ) : (
              <motion.div
                key="grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="grid gap-4"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                }}
              >
                {div.agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isInTeam={teamAgentIds.has(agent.id)}
                    onSelect={onAgentSelect}
                    onToggleTeam={onTeamToggle}
                    divisionColor={div.color}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // 全部 Agents 视图
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 标题 */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-white">全部 Agents</h1>
        <p className="text-gray-400 text-sm mt-1">
          {divisions.length} 个部门 · {totalAgents} 个 Agent
        </p>
      </div>

      {/* 统计卡片行 */}
      {!searchQuery && (
        <div className="flex-shrink-0 px-6 pb-5 flex gap-3 overflow-x-auto scrollbar-hide">
          <StatCard
            icon={<Users className="w-4 h-4" />}
            label="全部 Agents"
            value={totalAgents}
            color="#6366f1"
          />
          <StatCard
            icon={<span className="text-sm font-bold">#</span>}
            label="部门数量"
            value={divisions.length}
            color="#0ea5e9"
          />
          <StatCard
            icon={<Users className="w-4 h-4" />}
            label="已入团队"
            value={teamAgents.length}
            color="#10b981"
          />
        </div>
      )}

      {/* 分割线 */}
      <div className="flex-shrink-0 mx-6 border-t border-gray-800" />

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
        <AnimatePresence mode="wait">
          {isEmpty ? (
            <EmptyState query={searchQuery} key="empty" />
          ) : (
            <motion.div
              key="content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {filteredData.map((div) => (
                <motion.section
                  key={div.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="mb-8"
                >
                  {/* 部门小标题 */}
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xl">{div.emoji}</span>
                    <h2 className="text-white font-semibold text-base">
                      {div.name}
                    </h2>
                    <span className="text-gray-500 text-sm">·</span>
                    <span className="text-gray-400 text-sm">
                      {div.nameZh}
                    </span>
                    <span
                      className="ml-auto text-xs px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${div.color}22`,
                        color: div.color,
                      }}
                    >
                      {div.agents.length}
                    </span>
                  </div>

                  {/* 横向滚动卡片列 */}
                  <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                    {div.agents.map((agent) => (
                      <div key={agent.id} className="flex-shrink-0 w-56">
                        <AgentCard
                          agent={agent}
                          isInTeam={teamAgentIds.has(agent.id)}
                          onSelect={onAgentSelect}
                          onToggleTeam={onTeamToggle}
                          divisionColor={getDivisionColor(agent.division)}
                        />
                      </div>
                    ))}
                  </div>
                </motion.section>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function EmptyState({ query }: { query: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="flex flex-col items-center justify-center py-24 gap-4"
    >
      <Search className="w-12 h-12 text-gray-700" />
      <p className="text-gray-400 text-base">
        {query ? `没有找到与 "${query}" 相关的 Agent` : '暂无 Agent'}
      </p>
      {query && (
        <p className="text-gray-600 text-sm">试试其他关键词</p>
      )}
    </motion.div>
  )
}
