# Build Resources

> 与主文档同步：见 [README.md](../README.md)、[CHANGELOG.md](../CHANGELOG.md)、[docs/FRAMEWORK.md](../docs/FRAMEWORK.md)（V2.2.8 · 2026-03-21 周六）。

这个目录存放桌面分发所需的品牌化资源：

- `icon-source.png`: 应用图标源图
- `installer-hero.png`: 安装器主视觉源图
- `icon.ico`: Windows 应用图标
- `installer-sidebar.bmp`: NSIS 安装器侧边图

生成方式：

```bash
npm run brand:assets
```

说明：

- `icon-source.png` 与 `installer-hero.png` 可以替换为新的品牌视觉源图
- `icon.ico` 与 `installer-sidebar.bmp` 由 `scripts/generate-brand-assets.mjs` 生成
