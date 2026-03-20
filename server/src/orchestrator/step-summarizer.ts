import type { LLMProvider } from '../providers/types.js'

// 字符数阈值：低于此值直接复用原文，不调用 LLM
const SHORT_OUTPUT_THRESHOLD = 500

export async function summarizeStepOutput(params: {
  provider: LLMProvider
  model: string
  stepTitle: string
  rawOutput: string
}): Promise<string> {
  const { provider, model, stepTitle, rawOutput } = params

  // 短输出直接复用
  if (rawOutput.length <= SHORT_OUTPUT_THRESHOLD) {
    return rawOutput
  }

  const systemPrompt = `You are a concise summarizer. Condense the given content into a summary under 200 words (or 200 Chinese characters if the content is in Chinese). Preserve: key conclusions, main findings, and information useful for a final report aggregator. Omit: redundant details, examples, and verbose explanations.`

  const userPrompt = `Step title: ${stepTitle}\n\nContent to summarize:\n${rawOutput}`

  try {
    let fullText = ''
    for await (const chunk of provider.chat({
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 512,
      temperature: 0.2,
    })) {
      if (chunk.delta) fullText += chunk.delta
    }
    return fullText.trim() || rawOutput
  } catch {
    // 摘要失败时回退到原始输出
    return rawOutput
  }
}
