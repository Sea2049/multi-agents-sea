import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedPassageText, embedQueryText, resetEmbeddingProviderForTests, setEmbeddingProviderFactoryForTests } from '../embedding/index.js'
import { createFastEmbedProvider, type EmbeddingProvider } from '../embedding/provider.js'

function createMockFastembedModule() {
  return {
    EmbeddingModel: {
      BGESmallENV15: 'fast-bge-small-en-v1.5',
    },
    ExecutionProvider: {
      CPU: 'cpu',
    },
    FlagEmbedding: {
      init: vi.fn().mockResolvedValue({
        async *passageEmbed(texts: string[]) {
          for (const text of texts) {
            if (text.includes('alpha')) {
              yield [[0.1, 0.2, 0.3]]
            } else {
              yield [[0.3, 0.2, 0.1]]
            }
          }
        },
        queryEmbed: vi.fn().mockResolvedValue([0.9, 0.8, 0.7]),
      }),
    },
  }
}

afterEach(() => {
  resetEmbeddingProviderForTests()
})

describe('embedding provider', () => {
  it('creates a fastembed-backed provider with basic vector metadata', async () => {
    const fastembedModule = createMockFastembedModule()

    const provider = await createFastEmbedProvider({
      fastembedModule: fastembedModule as never,
      cacheDir: 'D:\\clawtest\\fastembed-test-cache',
      showDownloadProgress: false,
    })

    expect(fastembedModule.FlagEmbedding.init).toHaveBeenCalledOnce()

    const passageVectors = await provider.embedPassages(['alpha memory'])
    expect(passageVectors).toHaveLength(1)
    expect(passageVectors[0]).toEqual({
      model: 'fast-bge-small-en-v1.5',
      dimensions: 3,
      values: [0.1, 0.2, 0.3],
    })

    const queryVector = await provider.embedQuery('alpha query')
    expect(queryVector).toEqual({
      model: 'fast-bge-small-en-v1.5',
      dimensions: 3,
      values: [0.9, 0.8, 0.7],
    })
  })

  it('allows the embedding singleton to be replaced by a mock provider', async () => {
    const mockProvider: EmbeddingProvider = {
      model: 'mock-embedding-v1',
      dimensions: 2,
      embedPassages: vi.fn().mockResolvedValue([
        {
          model: 'mock-embedding-v1',
          dimensions: 2,
          values: [1, 0],
        },
      ]),
      embedQuery: vi.fn().mockResolvedValue({
        model: 'mock-embedding-v1',
        dimensions: 2,
        values: [0, 1],
      }),
    }

    setEmbeddingProviderFactoryForTests(async () => mockProvider)

    await expect(embedPassageText('hello memory')).resolves.toEqual({
      model: 'mock-embedding-v1',
      dimensions: 2,
      values: [1, 0],
    })

    await expect(embedQueryText('hello query')).resolves.toEqual({
      model: 'mock-embedding-v1',
      dimensions: 2,
      values: [0, 1],
    })
  })
})
