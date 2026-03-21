import React from 'react'
import { motion } from 'framer-motion'
import { divisions } from '../data/agents'

interface SidebarProps {
  selectedDivision: string | null
  onSelectDivision: (id: string | null) => void
  teamCount: number
  activePanel: 'browse' | 'team' | 'detail'
  onPanelChange: (panel: 'browse' | 'team') => void
}

export default function Sidebar({
  selectedDivision,
  onSelectDivision,
  teamCount,
  activePanel,
  onPanelChange,
}: SidebarProps): React.ReactElement {
  return (
    <aside
      className="flex flex-col h-full w-60 bg-gray-950 border-r border-gray-800 select-none"
      style={{ minWidth: 240, maxWidth: 240 }}
    >
      {/* Logo 区域 */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
        <span className="text-2xl leading-none">🎭</span>
        <div className="flex flex-col">
          <span className="text-white font-bold text-base leading-tight tracking-wide">agent-sea</span>
          <span className="text-gray-500 text-xs leading-tight mt-0.5">AI Specialist Team</span>
        </div>
      </div>

      {/* 导航区域 */}
      <div className="flex flex-col gap-0.5 px-2 py-3 border-b border-gray-800">
        <NavItem
          label="浏览 Agents"
          icon="🔍"
          active={activePanel === 'browse' || activePanel === 'detail'}
          onClick={() => onPanelChange('browse')}
        />
        <NavItem
          label="我的团队"
          icon="👥"
          active={activePanel === 'team'}
          onClick={() => onPanelChange('team')}
          badge={teamCount > 0 ? teamCount : undefined}
          badgeColor="#10b981"
        />
      </div>

      {/* 部门列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5 scrollbar-thin">
        <div className="px-3 pb-2">
          <span className="text-gray-600 text-xs font-semibold uppercase tracking-widest">部门</span>
        </div>

        {/* 全部选项 */}
        <DivisionItem
          id={null}
          emoji="🌐"
          label="全部 Agents"
          count={divisions.reduce((acc, d) => acc + d.agents.length, 0)}
          color="#6b7280"
          selected={selectedDivision === null && (activePanel === 'browse' || activePanel === 'detail')}
          onSelect={() => onSelectDivision(null)}
        />

        {divisions.map((division) => (
          <DivisionItem
            key={division.id}
            id={division.id}
            emoji={division.emoji}
            label={division.nameZh}
            count={division.agents.length}
            color={division.color}
            selected={selectedDivision === division.id}
            onSelect={() => onSelectDivision(division.id)}
          />
        ))}
      </div>
    </aside>
  )
}

interface NavItemProps {
  label: string
  icon: string
  active: boolean
  onClick: () => void
  badge?: number
  badgeColor?: string
}

function NavItem({ label, icon, active, onClick, badge, badgeColor }: NavItemProps): React.ReactElement {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150
        ${active
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
        }
      `}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {badge !== undefined && (
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
          style={{ backgroundColor: badgeColor ? `${badgeColor}33` : '#374151', color: badgeColor ?? '#9ca3af' }}
        >
          {badge}
        </span>
      )}
    </motion.button>
  )
}

interface DivisionItemProps {
  id: string | null
  emoji: string
  label: string
  count: number
  color: string
  selected: boolean
  onSelect: () => void
}

function DivisionItem({ emoji, label, count, color, selected, onSelect }: DivisionItemProps): React.ReactElement {
  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      className={`
        relative w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors duration-150
        ${selected
          ? 'bg-gray-800/80 text-white'
          : 'text-gray-400 hover:bg-gray-900 hover:text-gray-300'
        }
      `}
    >
      {/* 左侧高亮竖条 */}
      {selected && (
        <motion.div
          layoutId="sidebar-active-bar"
          className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
          style={{ backgroundColor: color }}
          initial={false}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        />
      )}

      <span className="text-sm leading-none ml-1">{emoji}</span>
      <span className="flex-1 text-xs font-medium truncate">{label}</span>
      <span
        className="text-xs px-1.5 py-0.5 rounded-md font-medium tabular-nums"
        style={{
          backgroundColor: selected ? `${color}22` : '#1f2937',
          color: selected ? color : '#6b7280',
        }}
      >
        {count}
      </span>
    </motion.button>
  )
}
