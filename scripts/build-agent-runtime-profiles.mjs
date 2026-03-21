/**
 * build-agent-runtime-profiles.mjs
 *
 * 读取 temp-agency-agents/ 中的原始 markdown，结合 src/data/agents.ts 的元数据，
 * 生成 shared/agents/runtime-profiles.ts 运行时 profile 文件。
 *
 * 用法：node scripts/build-agent-runtime-profiles.mjs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeImportedBranding } from './normalize-imported-branding.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const agentsRoot = path.join(rootDir, 'temp-agency-agents')
const agentsDataPath = path.join(rootDir, 'src', 'data', 'agents.ts')
const outputPath = path.join(rootDir, 'shared', 'agents', 'runtime-profiles.ts')

// ── 最大文件体积限制（2MB）
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

// ────────────────────────────────────────────────────────────────────────────
// 1. 编码修复
// 常见问题：UTF-8 多字节 emoji 被错误以 Latin-1 解读后再转义，导致乱码序列
// 修复策略：精确字符串替换已知错误序列
// ────────────────────────────────────────────────────────────────────────────
const ENCODING_MAP = {
  // emoji 乱码修复（UTF-8 双字节/三字节被 Latin-1 读取的典型结果）
  'đ§ ':  '🧠',   // U+1F9E0 Brain
  'đŻ':   '🎯',   // U+1F3AF Direct Hit
  'đ¨':   '🚨',   // U+1F6A8 Police Car Light
  'đ':   '📋',   // U+1F4CB Clipboard
  'đ':   '🔄',   // U+1F504 Counterclockwise Arrows Button
  'đ­':   '🎭',   // U+1F3AD Performing Arts
  'đ':   '📊',   // U+1F4CA Bar Chart
  'đ':   '📈',   // U+1F4C8 Chart Increasing
  'đ':   '📉',   // U+1F4C9 Chart Decreasing
  'đ':   '📌',   // U+1F4CC Round Pushpin
  'đ':   '📍',   // U+1F4CD Round Pushpin
  'đ ':  '🏠',   // U+1F3E0 House
  'đ¢':   '🏢',   // U+1F3E2 Office Building
  'đ€':   '🤔',   // U+1F914 Thinking Face
  'đ¡':   '💡',   // U+1F4A1 Light Bulb
  'đ':   '🔍',   // U+1F50D Magnifying Glass Left
  'đ':   '🔎',   // U+1F50E Magnifying Glass Right
  'đ':   '🎨',   // U+1F3A8 Artist Palette
  'đ':   '🎬',   // U+1F3AC Clapper Board
  'đ':   '🎮',   // U+1F3AE Video Game
  'đ':   '🎵',   // U+1F3B5 Musical Note
  'đ':   '🎶',   // U+1F3B6 Musical Notes
  'đ':   '🎸',   // U+1F3B8 Guitar
  'đ§':   '🧩',   // U+1F9E9 Puzzle Piece
  'đ¦':   '🦊',   // U+1F98A Fox
  'đ¦':   '🦁',   // U+1F981 Lion (collision—keep first match)
  'đ':   '🌍',   // U+1F30D Earth Globe Europe-Africa
  'đ':   '🌎',   // U+1F30E Earth Globe Americas
  'đ':   '🌏',   // U+1F30F Earth Globe Asia-Australia
  'đ':   '💰',   // U+1F4B0 Money Bag
  'đ°':   '💰',   // alt encoding
  'đ€':   '🤝',   // U+1F91D Handshake
  'đ¥':   '🥇',   // U+1F947 1st Place Medal
  'đ¥':   '🥈',   // (collision)
  'đ':   '🚀',   // U+1F680 Rocket
  'đ':   '🛡',   // U+1F6E1 Shield
  'đ¯':   '🎯',   // alt encoding for Direct Hit
  'â':   '→',    // U+2192 Rightwards Arrow
  'â':   '✓',    // U+2713 Check Mark
  'â':   '✗',    // U+2717 Ballot X
  'Ă':   'Ö',    // Latin capital O with diaeresis
  'ĂŠ':  'é',    // Latin small e with acute
  'Ă©':  'é',    // alt
  'Ă':   'à',    // Latin small a with grave
  'Ă ': 'à',    // alt
  'Ă¨':  'è',    // Latin small e with grave
  'Ă¯':  'ï',    // Latin small i with diaeresis
  'Ă´':  'ô',    // Latin small o with circumflex
  'Ă»':  'û',    // Latin small u with circumflex
  'Ă¼':  'ü',    // Latin small u with diaeresis
  'â':   '—',    // Em dash
  'â':   '–',    // En dash
  'â':   '"',    // Left double quotation mark
  'â':   '"',    // Right double quotation mark
  'â':   "'",    // Left single quotation mark
  'â':   "'",    // Right single quotation mark
  'Â©':  '©',    // Copyright sign
  'Â®':  '®',    // Registered sign
  'Â·':  '·',    // Middle dot
  'Â°':  '°',    // Degree sign
}

function fixEncoding(text) {
  let fixed = text
  for (const [bad, good] of Object.entries(ENCODING_MAP)) {
    if (fixed.includes(bad)) {
      fixed = fixed.split(bad).join(good)
    }
  }
  return fixed
}

// ────────────────────────────────────────────────────────────────────────────
// 2. token 预算估算
// 简单公式：字符数 × 0.4，向上取整（英文平均 ~4 字符/token）
// ────────────────────────────────────────────────────────────────────────────
function estimateTokens(text) {
  return Math.ceil((text || '').length * 0.4)
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Markdown 段落提取
// ────────────────────────────────────────────────────────────────────────────

/**
 * 将 markdown 按 H1/H2 拆分为 sections 数组
 * 返回 [{ level: 1|2, heading: string, content: string }]
 */
function splitMarkdownIntoSections(markdown) {
  const sections = []
  // 按 H1 或 H2 分割，保留分隔符
  const parts = markdown.split(/^(#{1,2} .+)$/m)

  let current = null
  for (const part of parts) {
    const h1Match = part.match(/^# (.+)$/)
    const h2Match = part.match(/^## (.+)$/)

    if (h1Match) {
      if (current) sections.push(current)
      current = { level: 1, heading: h1Match[1].trim(), content: '' }
    } else if (h2Match) {
      if (current) sections.push(current)
      current = { level: 2, heading: h2Match[1].trim(), content: '' }
    } else if (current) {
      current.content += part
    }
  }
  if (current) sections.push(current)

  return sections
}

/**
 * 判断一个 heading 是否属于"核心系统 prompt"类别
 * 匹配规则：包含以下关键词（大小写不敏感）
 */
const SYSTEM_HEADING_PATTERNS = [
  /identity/i,
  /memory/i,
  /mission/i,
  /rule/i,
  /principle/i,
  /purpose/i,
  /role/i,
  /responsibility/i,
  /persona/i,
  /core/i,
  /personality/i,
  /who you are/i,
  /你是/i,
]

/**
 * 判断是否属于 stylePrompt 类别
 */
const STYLE_HEADING_PATTERNS = [
  /style/i,
  /communication/i,
  /vibe/i,
  /tone/i,
  /voice/i,
  /persona/i,
  /character/i,
]

/**
 * 判断是否属于 outputContract 类别
 */
const OUTPUT_HEADING_PATTERNS = [
  /output/i,
  /deliverable/i,
  /format/i,
  /template/i,
  /structure/i,
]

function matchesAny(heading, patterns) {
  return patterns.some((p) => p.test(heading))
}

/**
 * 从 markdown 中提取各层次内容
 */
function extractProfileParts(markdown) {
  const fixed = fixEncoding(markdown)
  const sections = splitMarkdownIntoSections(fixed)

  const systemParts = []
  const styleParts = []
  const outputParts = []
  const referenceSections = []

  // H1 整体作为 systemPrompt 的开头（角色总描述）
  const h1Section = sections.find((s) => s.level === 1)
  if (h1Section) {
    const h1Body = h1Section.content.trim()
    if (h1Body) {
      systemParts.push(h1Body)
    }
  }

  for (const section of sections) {
    if (section.level !== 2) continue

    const heading = section.heading
    const body = section.content.trim()
    if (!body) continue

    if (matchesAny(heading, STYLE_HEADING_PATTERNS)) {
      styleParts.push(`## ${heading}\n${body}`)
    } else if (matchesAny(heading, OUTPUT_HEADING_PATTERNS)) {
      outputParts.push(`## ${heading}\n${body}`)
    } else if (matchesAny(heading, SYSTEM_HEADING_PATTERNS)) {
      systemParts.push(`## ${heading}\n${body}`)
    } else {
      // 其余章节作为参考节（按需注入）
      referenceSections.push({ title: heading, content: body })
    }
  }

  // 如果完全没有提取到系统 prompt 内容（markdown 结构异常），
  // 则把全文前 3000 字符作为 systemPrompt
  const systemPrompt =
    systemParts.length > 0
      ? systemParts.join('\n\n')
      : fixed.slice(0, 3000).trim()

  const stylePrompt = styleParts.length > 0 ? styleParts.join('\n\n') : undefined
  const outputContract = outputParts.length > 0 ? outputParts.join('\n\n') : undefined

  return { systemPrompt, stylePrompt, outputContract, referenceSections }
}

// ────────────────────────────────────────────────────────────────────────────
// 4. planningHints 生成
// 从 agents.ts 中的 description + vibe 生成 2-3 条简洁能力描述
// ────────────────────────────────────────────────────────────────────────────
function buildPlanningHints(agent) {
  const hints = []

  // Hint 1：从 vibe 提取（短句，直接能力定位）
  if (agent.vibe) {
    hints.push(agent.vibe.trim())
  }

  // Hint 2：从 description 截取前 120 字符作为能力摘要
  if (agent.description) {
    const shortDesc = agent.description.slice(0, 120).trim()
    const lastSpace = shortDesc.lastIndexOf(' ')
    hints.push(lastSpace > 80 ? shortDesc.slice(0, lastSpace) + '…' : shortDesc)
  }

  // Hint 3：division 定位
  if (agent.division) {
    hints.push(`Division: ${agent.division}`)
  }

  return hints.filter(Boolean).slice(0, 3)
}

// ────────────────────────────────────────────────────────────────────────────
// 5. 最简化 profile（当找不到 md 文件时）
// ────────────────────────────────────────────────────────────────────────────
function buildFallbackProfile(agent) {
  const systemPrompt = [
    `You are **${agent.name}**.`,
    agent.description ? `\n${agent.description}` : '',
    agent.vibe ? `\n\nVibe: ${agent.vibe}` : '',
  ]
    .filter(Boolean)
    .join('')

  return {
    agentId: agent.id,
    name: agent.name,
    division: agent.division,
    systemPrompt,
    planningHints: buildPlanningHints(agent),
    referenceSections: [],
    tokenBudget: {
      system: estimateTokens(systemPrompt),
      reference: 0,
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 6. 从 agents.ts 解析所有 Agent 元数据
// ────────────────────────────────────────────────────────────────────────────
function parseAgentsFromSource(source) {
  const agents = []

  // 只匹配含有 fileName 字段的对象块（即 Agent，非 Division）
  // 策略：用 id: 'xxx' 和 fileName: 'xxx' 作为锚点，在整段源码中逐行扫描
  // 更健壮的做法：用正则提取所有含 fileName 的完整 { ... } 块
  const agentEntryRegex = /\{[^{}]*?\bfileName:\s*'[^']+?'[^{}]*?\}/gs
  const blocks = source.match(agentEntryRegex) || []

  for (const block of blocks) {
    const id = (block.match(/\bid:\s*'([^']+)'/) || [])[1]
    const name = (block.match(/\bname:\s*'([^']+)'/) || [])[1]
    const division = (block.match(/\bdivision:\s*'([^']+)'/) || [])[1]
    const fileName = (block.match(/\bfileName:\s*'([^']+)'/) || [])[1]

    // description 和 vibe 可能含转义单引号
    const descMatch = block.match(/\bdescription:\s*'([\s\S]*?)(?=',\s*\n|\n\s*(?:color|emoji|vibe|division|subDivision))/)
    const vibeMatch = block.match(/\bvibe:\s*'([\s\S]*?)(?=',\s*\n|\n\s*(?:division|subDivision|fileName))/)

    if (id && name && fileName) {
      agents.push({
        id,
        name,
        description: descMatch ? descMatch[1].replace(/\\'/g, "'").trim() : '',
        vibe: vibeMatch ? vibeMatch[1].replace(/\\'/g, "'").trim() : '',
        division: division || 'unknown',
        fileName,
      })
    }
  }

  return agents
}

// ────────────────────────────────────────────────────────────────────────────
// 7. 文件遍历
// ────────────────────────────────────────────────────────────────────────────
async function walkDir(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name)
        return entry.isDirectory() ? walkDir(fullPath) : [fullPath]
      })
    )
    return files.flat()
  } catch {
    return []
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 8. 代码生成辅助
// ────────────────────────────────────────────────────────────────────────────
function escapeTemplateLiteral(value) {
  return (value || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
}

function serializeProfile(profile) {
  const refSections = profile.referenceSections
    .map(
      (s) =>
        `    { title: ${JSON.stringify(s.title)}, content: \`${escapeTemplateLiteral(s.content)}\` }`
    )
    .join(',\n')

  const lines = [
    `  ${JSON.stringify(profile.agentId)}: {`,
    `    agentId: ${JSON.stringify(profile.agentId)},`,
    `    name: ${JSON.stringify(profile.name)},`,
    `    division: ${JSON.stringify(profile.division)},`,
    `    systemPrompt: \`${escapeTemplateLiteral(profile.systemPrompt)}\`,`,
  ]

  if (profile.stylePrompt) {
    lines.push(`    stylePrompt: \`${escapeTemplateLiteral(profile.stylePrompt)}\`,`)
  }
  if (profile.outputContract) {
    lines.push(`    outputContract: \`${escapeTemplateLiteral(profile.outputContract)}\`,`)
  }

  lines.push(`    planningHints: ${JSON.stringify(profile.planningHints)},`)
  lines.push(`    referenceSections: [\n${refSections}\n    ],`)
  lines.push(`    tokenBudget: { system: ${profile.tokenBudget.system}, reference: ${profile.tokenBudget.reference} },`)
  lines.push(`  },`)

  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// 9. 主流程
// ────────────────────────────────────────────────────────────────────────────
async function main() {
  // 检查 temp-agency-agents/ 是否存在
  let agentsRootExists = false
  try {
    await fs.access(agentsRoot)
    agentsRootExists = true
  } catch {
    console.warn(
      '\n⚠️  temp-agency-agents/ 目录不存在，将使用 agents.ts 元数据生成最简化 profile。\n' +
      '   提示：克隆 agency-agents 仓库到 temp-agency-agents/ 后重新运行可获得完整 profile。\n'
    )
  }

  // 读取 agents.ts 元数据
  let agentsSource = ''
  try {
    agentsSource = await fs.readFile(agentsDataPath, 'utf8')
  } catch (e) {
    console.error(`❌ 无法读取 ${agentsDataPath}：${e.message}`)
    process.exit(1)
  }

  const agents = parseAgentsFromSource(agentsSource)
  if (agents.length === 0) {
    console.error('❌ 未从 agents.ts 解析到任何 agent，请检查文件格式')
    process.exit(1)
  }
  console.log(`📋 从 agents.ts 读取到 ${agents.length} 个 Agent`)

  // 建立 fileName → 文件路径 映射
  const fileMap = new Map()
  if (agentsRootExists) {
    const allFiles = await walkDir(agentsRoot)
    const mdFiles = allFiles.filter(
      (f) =>
        f.endsWith('.md') &&
        !['README.md', 'CONTRIBUTING.md', 'LICENSE.md'].includes(path.basename(f))
    )
    for (const filePath of mdFiles) {
      fileMap.set(path.basename(filePath), filePath)
    }
    console.log(`📂 在 temp-agency-agents/ 中找到 ${fileMap.size} 个 markdown 文件`)
  }

  // 构建 profiles
  const profiles = []
  let foundCount = 0
  let fallbackCount = 0

  for (const agent of agents) {
    const mdFilePath = fileMap.get(agent.fileName)

    if (!mdFilePath) {
      profiles.push(buildFallbackProfile(agent))
      fallbackCount++
      continue
    }

    // 读取 markdown，尝试 UTF-8，失败则 Latin-1
    let raw = ''
    try {
      raw = await fs.readFile(mdFilePath, 'utf8')
    } catch {
      try {
        raw = await fs.readFile(mdFilePath, 'latin1')
      } catch (e) {
        console.warn(`  ⚠️  无法读取 ${agent.fileName}：${e.message}，使用 fallback`)
        profiles.push(buildFallbackProfile(agent))
        fallbackCount++
        continue
      }
    }

    // 去除 frontmatter
    let body = raw
    const normalized = raw.replace(/\r\n/g, '\n')
    if (normalized.startsWith('---\n')) {
      const closingIndex = normalized.indexOf('\n---\n', 4)
      if (closingIndex !== -1) {
        body = normalized.slice(closingIndex + 5).trim()
      }
    }

    const normalizedBody = normalizeImportedBranding(body)

    const { systemPrompt, stylePrompt, outputContract, referenceSections } =
      extractProfileParts(normalizedBody)

    // 计算 token 预算
    const systemTokens = estimateTokens(systemPrompt) + estimateTokens(stylePrompt)
    const refTokens = referenceSections.reduce(
      (sum, s) => sum + estimateTokens(s.title) + estimateTokens(s.content),
      0
    )

    const profile = {
      agentId: agent.id,
      name: agent.name,
      division: agent.division,
      systemPrompt,
      planningHints: buildPlanningHints(agent),
      referenceSections,
      tokenBudget: { system: systemTokens, reference: refTokens },
    }
    if (stylePrompt) profile.stylePrompt = stylePrompt
    if (outputContract) profile.outputContract = outputContract

    profiles.push(profile)
    foundCount++
  }

  console.log(`✅ 完整 profile：${foundCount} 个，fallback profile：${fallbackCount} 个`)

  // 排序
  profiles.sort((a, b) => a.agentId.localeCompare(b.agentId))

  // 生成 TypeScript 源码
  const header = `/**
 * Agent 运行时 profile — 由 scripts/build-agent-runtime-profiles.mjs 生成
 * 请勿手动编辑 — 运行 \`npm run build:profiles\` 重新生成
 * 生成时间：${new Date().toISOString()}
 * Agents 数量：${profiles.length}
 */

import type { AgentRuntimeProfile } from './types.js'

export const agentRuntimeProfiles: Record<string, AgentRuntimeProfile> = {
`

  const footer = `}\n`

  // 逐条序列化，超过体积限制时截断 referenceSections
  const profileBlocks = []
  let estimatedBytes = Buffer.byteLength(header + footer, 'utf8')

  for (const profile of profiles) {
    // 先尝试完整序列化
    let block = serializeProfile(profile)
    let blockBytes = Buffer.byteLength(block, 'utf8')

    if (estimatedBytes + blockBytes > MAX_OUTPUT_BYTES) {
      // 尝试截断 referenceSections
      const trimmed = { ...profile, referenceSections: profile.referenceSections.slice(0, 3) }
      block = serializeProfile(trimmed)
      blockBytes = Buffer.byteLength(block, 'utf8')

      if (estimatedBytes + blockBytes > MAX_OUTPUT_BYTES) {
        // 仍超限，再截断为 1 条
        const minimal = { ...profile, referenceSections: profile.referenceSections.slice(0, 1) }
        block = serializeProfile(minimal)
        blockBytes = Buffer.byteLength(block, 'utf8')
      }
    }

    profileBlocks.push(block)
    estimatedBytes += blockBytes
  }

  const output = header + profileBlocks.join('\n') + '\n' + footer

  await fs.writeFile(outputPath, output, 'utf8')

  const actualBytes = Buffer.byteLength(output, 'utf8')
  const actualKB = (actualBytes / 1024).toFixed(1)
  console.log(
    `\n✨ 已生成 ${path.relative(rootDir, outputPath)}\n` +
    `   · Profiles：${profiles.length} 个\n` +
    `   · 文件大小：${actualKB} KB\n`
  )
}

main().catch((error) => {
  console.error('❌ 构建失败：', error)
  process.exit(1)
})
