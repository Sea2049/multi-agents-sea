const BRAND_REPLACEMENTS = [
  ['Agency Agents Desktop', 'agent-sea'],
  ['Agency Desktop', 'agent-sea'],
  ['Agency Agents', 'agent-sea agents'],
  ['`agency-agents`', '`agent-sea`'],
  ['The Agency repo', 'agent-sea repo'],
  ['The Agency', 'agent-sea'],
]

export function normalizeImportedBranding(text) {
  let normalized = text ?? ''

  for (const [source, target] of BRAND_REPLACEMENTS) {
    normalized = normalized.split(source).join(target)
  }

  return normalized
}
