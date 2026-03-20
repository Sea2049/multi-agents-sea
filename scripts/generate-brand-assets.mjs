import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import toIco from 'to-ico';
import bmp from 'bmp-js';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildResourcesDir = path.join(rootDir, 'buildResources');

const iconSourcePath = path.join(buildResourcesDir, 'icon-source.png');
const installerHeroPath = path.join(buildResourcesDir, 'installer-hero.png');
const iconOutputPath = path.join(buildResourcesDir, 'icon.ico');
const sidebarOutputPath = path.join(buildResourcesDir, 'installer-sidebar.bmp');
const fallbackIconSourcePath =
  'C:\\Users\\BOB\\.cursor\\projects\\e-trae-multi-agents-sea\\assets\\agency-network-icon-source.png';
const fallbackInstallerHeroPath =
  'C:\\Users\\BOB\\.cursor\\projects\\e-trae-multi-agents-sea\\assets\\agency-installer-hero.png';

const iconSizes = [16, 24, 32, 48, 64, 128, 256];

async function resolveExistingFile(primaryPath, fallbackPath) {
  try {
    await fs.access(primaryPath);
    return primaryPath;
  } catch {
    try {
      await fs.access(fallbackPath);
      return fallbackPath;
    } catch {
      throw new Error(`Missing required file: ${path.relative(rootDir, primaryPath)}`);
    }
  }
}

async function generateIcon(sourcePath) {
  const buffers = await Promise.all(
    iconSizes.map((size) =>
      sharp(sourcePath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer()
    )
  );

  const icoBuffer = await toIco(buffers);
  await fs.writeFile(iconOutputPath, icoBuffer);
}

async function generateInstallerSidebar(sourcePath) {
  const { data, info } = await sharp(sourcePath)
    .resize(164, 314, {
      fit: 'cover',
      position: 'centre',
    })
    .flatten({ background: '#05070b' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const encoded = bmp.encode({
    data,
    width: info.width,
    height: info.height,
  });

  await fs.writeFile(sidebarOutputPath, encoded.data);
}

async function main() {
  const resolvedIconSourcePath = await resolveExistingFile(iconSourcePath, fallbackIconSourcePath);
  const resolvedInstallerHeroPath = await resolveExistingFile(
    installerHeroPath,
    fallbackInstallerHeroPath
  );

  if (resolvedIconSourcePath !== iconSourcePath) {
    await fs.copyFile(resolvedIconSourcePath, iconSourcePath);
  }

  if (resolvedInstallerHeroPath !== installerHeroPath) {
    await fs.copyFile(resolvedInstallerHeroPath, installerHeroPath);
  }

  await generateIcon(resolvedIconSourcePath);
  await generateInstallerSidebar(resolvedInstallerHeroPath);

  console.log('Brand assets generated:');
  console.log(`- ${path.relative(rootDir, iconOutputPath)}`);
  console.log(`- ${path.relative(rootDir, sidebarOutputPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
