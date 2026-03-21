import { clawhubProvider } from './clawhub.js'

// SkillHub 当前对外 API 稳定性待验证，先复用 ClawHub 协议形态作为占位。
// 后续拿到正式 API 文档后替换为独立实现。
export const skillhubProvider = {
  ...clawhubProvider,
  provider: 'skillhub' as const,
}
