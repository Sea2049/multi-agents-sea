import { createFastEmbedProvider, type EmbeddingProvider, type EmbeddingVector } from './provider.js'

type EmbeddingProviderFactory = () => Promise<EmbeddingProvider | null>

const defaultProviderFactory: EmbeddingProviderFactory = async () => createFastEmbedProvider()

let providerFactory: EmbeddingProviderFactory = defaultProviderFactory
let providerPromise: Promise<EmbeddingProvider | null> | null = null
let lastEmbeddingError: string | undefined

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

async function resolveProvider(): Promise<EmbeddingProvider | null> {
  if (!providerPromise) {
    providerPromise = providerFactory().catch((error: unknown) => {
      lastEmbeddingError = toErrorMessage(error)
      return null
    })
  }

  return providerPromise
}

export async function getEmbeddingProvider(): Promise<EmbeddingProvider | null> {
  return resolveProvider()
}

export async function embedPassageText(text: string): Promise<EmbeddingVector | null> {
  if (!text.trim()) {
    return null
  }

  const provider = await resolveProvider()
  if (!provider) {
    return null
  }

  const vectors = await provider.embedPassages([text])
  return vectors[0] ?? null
}

export async function embedQueryText(text: string): Promise<EmbeddingVector | null> {
  if (!text.trim()) {
    return null
  }

  const provider = await resolveProvider()
  if (!provider) {
    return null
  }

  return provider.embedQuery(text)
}

export function getLastEmbeddingError(): string | undefined {
  return lastEmbeddingError
}

export function setEmbeddingProviderFactoryForTests(factory: EmbeddingProviderFactory): void {
  providerFactory = factory
  providerPromise = null
  lastEmbeddingError = undefined
}

export function resetEmbeddingProviderForTests(): void {
  providerFactory = defaultProviderFactory
  providerPromise = null
  lastEmbeddingError = undefined
}

export type { EmbeddingProvider, EmbeddingVector }
