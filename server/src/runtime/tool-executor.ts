import type { LLMProvider, ProviderMessage, ToolCallRequest, ToolDefinition } from '../providers/types.js'
import type { RegistrySnapshot } from './registry-snapshot.js'
import { executeTool } from '../tools/index.js'

export interface ToolExecutorOptions {
  provider: LLMProvider
  model: string
  systemPrompt: string
  initialMessages: ProviderMessage[]
  tools: ToolDefinition[]
  snapshot?: RegistrySnapshot
  maxIterations?: number
  onToolCallStarted?: (toolCall: ToolCallRequest) => void
  onToolCallCompleted?: (toolCall: ToolCallRequest, output: string, isError: boolean) => void
}

export interface ToolExecutorResult {
  finalText: string
  toolCallCount: number
  messages: ProviderMessage[]
}

const TOOL_USAGE_CLAIM_PATTERN =
  /\b(used|using|called|invoked|ran|executed|searched|read|inspected)\b|使用|调用|运行|执行|读取|搜索|查阅/i
const EXPLICIT_TOOL_REQUIREMENT_PATTERN =
  /\b(must|required|need to|before answering|before responding)\b|必须|务必|至少|不要输出最终答案/i

function getUserContent(messages: ProviderMessage[]): string {
  return messages
    .filter((message): message is Extract<ProviderMessage, { role: 'user' }> => message.role === 'user')
    .map(message => message.content)
    .join('\n')
}

function getRequestedToolNames(messages: ProviderMessage[], tools: ToolDefinition[]): string[] {
  const userContent = getUserContent(messages)

  return tools
    .map(tool => tool.name)
    .filter(toolName => userContent.includes(toolName))
}

function shouldRetryForMissingToolCall(
  assistantText: string,
  requestedToolNames: string[],
): boolean {
  if (!assistantText.trim() || requestedToolNames.length === 0) return false
  if (!TOOL_USAGE_CLAIM_PATTERN.test(assistantText)) return false
  return requestedToolNames.some(toolName => assistantText.includes(toolName))
}

function buildToolAwareSystemPrompt(systemPrompt: string, tools: ToolDefinition[]): string {
  if (tools.length === 0) return systemPrompt

  const toolNames = tools.map(tool => tool.name).join(', ')
  return [
    systemPrompt,
    '## Tool Use Protocol',
    `Available tools: ${toolNames}.`,
    'Never claim that you used a tool unless you actually emitted a tool call and received its result in this conversation.',
    'If the user explicitly requires one of the available tools, call the required tool before giving the final answer.',
    'If you have not called the required tool yet, do not fabricate tool outputs. Call the tool first.',
  ].join('\n\n')
}

function buildFinalSynthesisMessage(messages: ProviderMessage[]): string {
  const transcript = messages.map((message) => {
    if (message.role === 'user') {
      return `User request:\n${message.content}`
    }
    if (message.role === 'assistant') {
      const toolSummary = message.toolCalls?.length
        ? `\nTool calls issued: ${message.toolCalls.map(toolCall => toolCall.name).join(', ')}`
        : ''
      return `Assistant response:${toolSummary}\n${message.content || '(empty)'}`
    }
    return `Tool result (${message.toolName}):\n${message.content}`
  })

  return [
    'You have already completed the tool phase.',
    'Using the transcript and tool results below, produce the final user-facing answer now.',
    'Do not call tools. Do not describe missing tool usage. Synthesize the actual results only.',
    '',
    transcript.join('\n\n'),
  ].join('\n')
}

async function synthesizeFinalAnswer(params: {
  provider: LLMProvider
  model: string
  systemPrompt: string
  messages: ProviderMessage[]
}): Promise<string> {
  const { provider, model, systemPrompt, messages } = params
  const stream = provider.chat({
    model,
    systemPrompt,
    messages: [
      {
        role: 'user',
        content: buildFinalSynthesisMessage(messages),
      },
    ],
  })

  if (!stream || typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function') {
    return ''
  }

  let synthesizedText = ''

  for await (const chunk of stream) {
    if (chunk.delta) synthesizedText += chunk.delta
  }

  return synthesizedText
}

export async function runWithTools(options: ToolExecutorOptions): Promise<ToolExecutorResult> {
  const {
    provider,
    model,
    systemPrompt,
    initialMessages,
    tools,
    snapshot,
    maxIterations = 5,
    onToolCallStarted,
    onToolCallCompleted,
  } = options

  const userContent = getUserContent(initialMessages)
  const requestedToolNames = getRequestedToolNames(initialMessages, tools)
  const hasExplicitToolRequirement = EXPLICIT_TOOL_REQUIREMENT_PATTERN.test(userContent)
  const toolAwareSystemPrompt = buildToolAwareSystemPrompt(systemPrompt, tools)

  // 降级：provider 不支持 tools 时直接走普通 chat
  if (!provider.supportsTools || !provider.chatWithTools) {
    let text = ''
    const msgs = initialMessages.filter(
      (m): m is { role: 'user'; content: string } | { role: 'assistant'; content: string; toolCalls?: ToolCallRequest[] } =>
        m.role === 'user' || m.role === 'assistant',
    )
    for await (const chunk of provider.chat({
      model,
      systemPrompt,
      messages: msgs.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    })) {
      if (chunk.delta) text += chunk.delta
    }
    const fallbackNotice = [
      '[Tool Fallback Notice]',
      `Provider "${provider.name}" does not support tool calling in this runtime.`,
      'This response was generated in plain-chat mode without executing tools.',
    ].join(' ')
    const finalText = text.trim()
      ? `${fallbackNotice}\n\n${text}`
      : fallbackNotice
    return { finalText, toolCallCount: 0, messages: initialMessages }
  }

  const conversationMessages: ProviderMessage[] = [...initialMessages]
  let totalToolCalls = 0
  const completedRequestedToolNames = new Set<string>()

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let textAccum = ''
    const toolCallsThisTurn: ToolCallRequest[] = []

    for await (const chunk of provider.chatWithTools({
      model,
      systemPrompt: toolAwareSystemPrompt,
      messages: conversationMessages,
      tools,
    })) {
      if (chunk.delta) textAccum += chunk.delta
      if (chunk.toolCall) {
        toolCallsThisTurn.push(chunk.toolCall)
      }
    }

    // 没有 tool calls，对话结束
    if (toolCallsThisTurn.length === 0) {
      let finalText = textAccum
      const remainingRequiredToolNames = requestedToolNames.filter(
        toolName => !completedRequestedToolNames.has(toolName),
      )

      if (
        hasExplicitToolRequirement &&
        remainingRequiredToolNames.length > 0 &&
        iteration + 1 < maxIterations
      ) {
        conversationMessages.push({
          role: 'assistant',
          content: finalText,
        })
        conversationMessages.push({
          role: 'user',
          content: [
            'The previous response did not emit the required tool call(s).',
            `You still must actually call these remaining required tool(s): ${remainingRequiredToolNames.join(', ')}.`,
            'Do not write pseudo tool code or describe imagined tool results. Emit the actual tool call now.',
          ].join(' '),
        })
        continue
      }

      if (
        iteration + 1 < maxIterations &&
        shouldRetryForMissingToolCall(finalText, requestedToolNames)
      ) {
        conversationMessages.push({
          role: 'assistant',
          content: finalText,
        })
        conversationMessages.push({
          role: 'user',
          content: [
            'You described tool usage, but no tool call was emitted in the previous response.',
            'Do not claim any tool result until you have actually called the tool and received its output.',
            `You must call the required tool(s) now: ${requestedToolNames.join(', ')}.`,
          ].join(' '),
        })
        continue
      }

      if (!finalText.trim() && totalToolCalls > 0) {
        finalText = await synthesizeFinalAnswer({
          provider,
          model,
          systemPrompt,
          messages: conversationMessages,
        })
      }

      conversationMessages.push({
        role: 'assistant',
        content: finalText,
      })
      return {
        finalText,
        toolCallCount: totalToolCalls,
        messages: conversationMessages,
      }
    }

    // 记录带 toolCalls 的 assistant 消息
    conversationMessages.push({
      role: 'assistant',
      content: textAccum,
      toolCalls: toolCallsThisTurn,
    })

    // 执行每个 tool call
    for (const toolCall of toolCallsThisTurn) {
      onToolCallStarted?.(toolCall)

      const result = await executeTool(toolCall, snapshot)
      totalToolCalls++
      if (requestedToolNames.includes(toolCall.name)) {
        completedRequestedToolNames.add(toolCall.name)
      }

      onToolCallCompleted?.(toolCall, result.output, result.isError ?? false)

      conversationMessages.push({
        role: 'tool',
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        content: result.output,
      })
    }

    const remainingRequiredToolNames = requestedToolNames.filter(
      toolName => !completedRequestedToolNames.has(toolName),
    )
    if (remainingRequiredToolNames.length > 0 && iteration + 1 < maxIterations) {
      conversationMessages.push({
        role: 'user',
        content: [
          `You have already completed: ${[...completedRequestedToolNames].join(', ') || 'none'}.`,
          `You still must call the remaining required tool(s) before the final answer: ${remainingRequiredToolNames.join(', ')}.`,
          'Do not repeat completed tools unless it is strictly necessary.',
        ].join(' '),
      })
    }
  }

  // 超出最大循环次数，返回最后一次 assistant 文本
  const lastAssistant = [...conversationMessages].reverse().find(m => m.role === 'assistant')
  let lastText = lastAssistant?.content ?? ''
  if (!lastText.trim() && totalToolCalls > 0) {
    lastText = await synthesizeFinalAnswer({
      provider,
      model,
      systemPrompt,
      messages: conversationMessages,
    })
  }
  return {
    finalText: lastText,
    toolCallCount: totalToolCalls,
    messages: conversationMessages,
  }
}
