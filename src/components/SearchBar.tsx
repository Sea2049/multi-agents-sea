import React, { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X } from 'lucide-react'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  resultCount?: number
}

export default function SearchBar({ value, onChange, resultCount }: SearchBarProps): React.ReactElement {
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClear = (): void => {
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <motion.div
      className="relative flex items-center w-full"
      animate={{
        boxShadow: isFocused
          ? '0 0 0 2px rgba(34,211,238,0.22), 0 0 24px rgba(34,211,238,0.14)'
          : '0 0 0 1px transparent',
      }}
      transition={{ duration: 0.2 }}
      style={{ borderRadius: 18 }}
    >
      <div
        className={`
          relative flex items-center w-full gap-2.5 px-3.5 py-2.5
          bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(2,6,23,0.8))] border rounded-[18px] transition-colors duration-200
          ${isFocused ? 'border-cyan-400/40' : 'border-white/10 hover:border-white/16'}
        `}
      >
        {/* 搜索图标 */}
        <Search
          size={15}
          className={`flex-shrink-0 transition-colors duration-200 ${isFocused ? 'text-cyan-300' : 'text-slate-500'}`}
        />

        {/* 输入框 */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="搜索 agents、技能、部门..."
          className="
            flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500
            outline-none border-none focus:ring-0
            min-w-0
          "
          spellCheck={false}
        />

        {/* 右侧区域：结果数 + 清除按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <AnimatePresence>
            {value.length > 0 && resultCount !== undefined && (
              <motion.span
                key="count"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1 text-xs text-slate-400 tabular-nums whitespace-nowrap"
              >
                {resultCount} 个结果
              </motion.span>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {value.length > 0 && (
              <motion.button
                key="clear"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                onClick={handleClear}
                className="
                  flex items-center justify-center w-5 h-5 rounded-full
                  text-slate-500 hover:text-white hover:bg-white/10
                  transition-colors duration-150
                "
                aria-label="清除搜索"
              >
                <X size={11} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
