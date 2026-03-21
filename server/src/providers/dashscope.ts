import type { ModelInfo } from './types.js'
import { OpenAIProvider } from './openai.js'

export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const DASHSCOPE_DEFAULT_MODEL_ID = 'qwen-max'

export const DASHSCOPE_MODELS: ModelInfo[] = [
  { id: DASHSCOPE_DEFAULT_MODEL_ID, name: 'Qwen Max', contextWindow: 131072 },
  { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072 },
  { id: 'qwen-max-latest', name: 'Qwen Max Latest', contextWindow: 131072 },
  { id: 'qwen-plus-latest', name: 'Qwen Plus Latest', contextWindow: 131072 },
]

export class DashScopeProvider extends OpenAIProvider {
  constructor(apiKey: string, baseURL: string = DASHSCOPE_BASE_URL) {
    super(apiKey, {
      name: 'dashscope',
      baseURL,
      models: DASHSCOPE_MODELS,
      validationModel: DASHSCOPE_DEFAULT_MODEL_ID,
    })
  }
}
