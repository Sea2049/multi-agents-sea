import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeImportedBranding } from './normalize-imported-branding.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentsRoot = path.join(rootDir, 'temp-agency-agents');
const agentsDataPath = path.join(rootDir, 'src', 'data', 'agents.ts');
const outputPath = path.join(rootDir, 'src', 'data', 'agentMarkdown.ts');

async function walk(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }
      return fullPath;
    })
  );

  return files.flat();
}

function stripFrontmatter(fileContent) {
  const normalized = fileContent.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return null;
  }

  const closingIndex = normalized.indexOf('\n---\n', 4);
  if (closingIndex === -1) {
    return null;
  }

  return normalized.slice(closingIndex + 5).trim();
}

function extractHeadings(markdown) {
  return Array.from(markdown.matchAll(/^##?\s+(.+)$/gm)).map((match) => match[1].trim());
}

function escapeTemplateLiteral(value) {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

async function main() {
  const agentsDataContent = await fs.readFile(agentsDataPath, 'utf8');
  const knownAgentIds = new Set(
    Array.from(agentsDataContent.matchAll(/id:\s*'([^']+)'/g)).map((match) => match[1])
  );

  const allFiles = await walk(agentsRoot);
  const markdownFiles = allFiles.filter((filePath) => filePath.endsWith('.md'));

  const records = [];

  for (const filePath of markdownFiles) {
    const fileName = path.basename(filePath);
    if (['README.md', 'CONTRIBUTING.md', 'LICENSE.md', 'LICENSE'].includes(fileName)) {
      continue;
    }

    const raw = await fs.readFile(filePath, 'utf8');
    const body = stripFrontmatter(raw);
    if (!body) {
      continue;
    }

    const relativePath = path.relative(agentsRoot, filePath).split(path.sep).join('/');
    const id = path.basename(filePath, '.md');

    if (!knownAgentIds.has(id)) {
      continue;
    }

    const normalizedBody = normalizeImportedBranding(body);

    records.push({
      id,
      sourcePath: relativePath,
      headings: extractHeadings(normalizedBody),
      markdown: normalizedBody,
    });
  }

  records.sort((a, b) => a.id.localeCompare(b.id));

  const output = `export interface AgentMarkdownEntry {
  sourcePath: string;
  headings: string[];
  markdown: string;
}

export const agentMarkdownById: Record<string, AgentMarkdownEntry> = {
${records
  .map(
    (record) => `  '${record.id}': {
    sourcePath: '${record.sourcePath}',
    headings: ${JSON.stringify(record.headings)},
    markdown: \`${escapeTemplateLiteral(record.markdown)}\`,
  },`
  )
  .join('\n')}
};
`;

  await fs.writeFile(outputPath, output, 'utf8');
  console.log(`Generated ${path.relative(rootDir, outputPath)} with ${records.length} entries.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
