type FastEmbedModule = typeof import('fastembed')

export interface EmbeddingVector {
  model: string
  dimensions: number
  values: number[]
}

export interface EmbeddingProvider {
  model: string
  dimensions: number
  embedPassages(texts: string[]): Promise<EmbeddingVector[]>
  embedQuery(text: string): Promise<EmbeddingVector>
}

export interface CreateFastEmbedProviderOptions {
  fastembedModule?: FastEmbedModule
  cacheDir?: string
  showDownloadProgress?: boolean
}

const DEFAULT_CACHE_DIR = process.env['MEMORY_EMBEDDING_CACHE_DIR'] ?? 'D:\\clawtest\\fastembed-cache'
const DEFAULT_BATCH_SIZE = 16

interface SupportedModelMetadata {
  model: string
  dim: number
}

function toEmbeddingVector(model: string, fallbackDimensions: number, values: number[]): EmbeddingVector {
  return {
    model,
    dimensions: values.length > 0 ? values.length : fallbackDimensions,
    values,
  }
}

function resolveSupportedModelDimensions(
  embedding: { listSupportedModels?: () => SupportedModelMetadata[] },
  model: string,
): number {
  if (typeof embedding.listSupportedModels !== 'function') {
    return 0
  }

  try {
    const modelMetadata = embedding.listSupportedModels().find((entry) => entry.model === model)
    return modelMetadata?.dim ?? 0
  } catch {
    return 0
  }
}

async function collectEmbeddingBatches(
  generator: AsyncGenerator<number[][], void, unknown>,
): Promise<number[][]> {
  const vectors: number[][] = []

  for await (const batch of generator) {
    vectors.push(...batch)
  }

  return vectors
}

export async function createFastEmbedProvider(
  options: CreateFastEmbedProviderOptions = {},
): Promise<EmbeddingProvider> {
  const fastembedModule = options.fastembedModule ?? await import('fastembed')
  const model = fastembedModule.EmbeddingModel.BGESmallENV15
  const embedding = await fastembedModule.FlagEmbedding.init({
    model,
    cacheDir: options.cacheDir ?? DEFAULT_CACHE_DIR,
    showDownloadProgress: options.showDownloadProgress ?? false,
    executionProviders: [fastembedModule.ExecutionProvider.CPU],
  })

  let dimensions = resolveSupportedModelDimensions(embedding, model)

  return {
    model,
    get dimensions() {
      return dimensions
    },
    async embedPassages(texts: string[]) {
      if (texts.length === 0) {
        return []
      }

      const vectors = await collectEmbeddingBatches(embedding.passageEmbed(texts, DEFAULT_BATCH_SIZE))
      return vectors.map((values) => {
        if (dimensions === 0 && values.length > 0) {
          dimensions = values.length
        }

        return toEmbeddingVector(model, dimensions, Array.from(values))
      })
    },
    async embedQuery(text: string) {
      const values = await embedding.queryEmbed(text)
      if (dimensions === 0 && values.length > 0) {
        dimensions = values.length
      }

      return toEmbeddingVector(model, dimensions, Array.from(values))
    },
  }
}
