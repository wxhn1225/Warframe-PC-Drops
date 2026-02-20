# Warframe PC Drops（多语言静态页）

本仓库从官方掉落表 `https://www.warframe.com/droptables` 下载英文版 `droptables-en.html`，并用 `warframe-public-export-plus/dict.*.json` 的官方术语翻译生成各语言静态 HTML（不改动原始页面样式/结构，只替换文本）。

## 本地生成

前提：已拉取 submodule `warframe-public-export-plus`。

```bash
node scripts/build-site.mjs
```

输出目录：`site/`

- `site/index.html`：语言选择页（默认跳转简体中文 `droptables-zh.html`）
- `site/droptables-xx.html`：各语言掉落表页面

## 自动更新（GitHub Pages）

工作流：`.github/workflows/pages.yml`

- 每天定时下载官方掉落表
- 若检测到更新：提交新的 `droptables-en.html` 到仓库，并重新生成所有语言页面后发布到 GitHub Pages
- 也支持手动触发（`workflow_dispatch`）

