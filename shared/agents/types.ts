export interface AgentRuntimeProfile {
  agentId: string
  name: string
  division: string
  /** 核心角色定义，直接作为 system prompt 发送给 LLM */
  systemPrompt: string
  /** 角色风格描述，可拼接在 systemPrompt 末尾 */
  stylePrompt?: string
  /** 期望的输出格式约束 */
  outputContract?: string
  /** 给 Planner 用的角色能力提示 */
  planningHints: string[]
  /** 可按需注入的参考章节，不默认放进 system prompt */
  referenceSections: Array<{ title: string; content: string }>
  /** token 预算估算 */
  tokenBudget: {
    /** systemPrompt + stylePrompt 的估算 token 数 */
    system: number
    /** 所有 referenceSections 合计的估算 token 数 */
    reference: number
  }
}
