import React from 'react'

interface LayoutProps {
  children: React.ReactNode
  sidebar: React.ReactNode
  header: React.ReactNode
}

export default function Layout({ children, sidebar, header }: LayoutProps): React.ReactElement {
  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: '#030712' }}
    >
      {/* 侧边栏 */}
      <div className="flex-shrink-0 h-full" style={{ width: 240 }}>
        {sidebar}
      </div>

      {/* 主内容区 */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        {/* 标题栏（Electron 拖拽区域） */}
        <div
          className="flex-shrink-0 h-8"
          style={{
            WebkitAppRegion: 'drag',
            backgroundColor: '#030712',
          } as React.CSSProperties}
        />

        {/* Header 区域（含 SearchBar） */}
        <div
          className="flex-shrink-0 px-6 pb-4"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {header}
        </div>

        {/* 内容区 */}
        <main
          className="flex-1 overflow-y-auto overflow-x-hidden px-6 pb-6"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
