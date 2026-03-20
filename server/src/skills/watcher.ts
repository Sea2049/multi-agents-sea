import chokidar from 'chokidar'
import { getSkillDiscoveryRoots } from './loader.js'

export interface SkillWatcherHandle {
  close(): Promise<void>
}

export function createSkillWatcher(onChange: () => Promise<void>): SkillWatcherHandle {
  const watcher = chokidar.watch(getSkillDiscoveryRoots(), {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50,
    },
  })

  let reloadTimer: NodeJS.Timeout | null = null
  const scheduleReload = () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer)
    }
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void onChange()
    }, 100)
  }

  watcher.on('add', scheduleReload)
  watcher.on('change', scheduleReload)
  watcher.on('unlink', scheduleReload)
  watcher.on('unlinkDir', scheduleReload)

  return {
    async close() {
      if (reloadTimer) {
        clearTimeout(reloadTimer)
        reloadTimer = null
      }
      await watcher.close()
    },
  }
}
