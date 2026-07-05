# Claude Safe · Claude 封号风险检测工具

扫描 9 项浏览器/系统环境信号，估算你被 Claude Code 标记为「中国用户」的风险分（0-100）。提供 Web 单页、HTTP API、Node CLI 三端入口，共享同一套评分逻辑。

---

## 这是什么

当 `ANTHROPIC_BASE_URL` 指向非官方中转时，Claude Code 会读取系统时区、代理 hostname、字体等环境信号。本工具扫描 9 项指纹，估算你被标记为「中国用户」的风险分，并给出每个信号的命中证据和改善建议。

三端入口：

- **Web 单页**：Astro 7 静态站点，浏览器里点扫描按钮看分数
- **HTTP API**：`/api/check` 端点，curl 一行拿到结果
- **Node CLI**：终端跑 `pnpm cli`，9 项信号全采集（含 CLI 独占的 3 项）

## 9 项信号

| ID | 信号 | 权重 | 浏览器 | 服务端 | CLI |
|---|---|---|:-:|:-:|:-:|
| `timezone` | 系统时区 | 24 | ✓ | ✓ | ✓ |
| `language` | 浏览器语言 | 20 | ✓ | ✓ | ✓ |
| `fonts` | 中文字体 | 14 | ✓ | — | ✓ |
| `webgl` | GPU 字符串 | 10 | ✓ | — | ✓ |
| `osLocale` | 系统区域/代码页 | 8 | — | — | ✓ |
| `claudeConfig` | `~/.claude/` 配置 | 6 | — | — | ✓ |
| `emoji` | Emoji 渲染器 | 6 | ✓ | — | — |
| `canvas` | Canvas 指纹 | 6 | ✓ | — | — |
| `proxy` | 代理 hostname | 6 | — | ✓ | ✓ |

权重合计 100。最终分 ≤ 30 低风险，30–60 中风险，> 60 高风险。

## 快速开始

### Web 端

```bash
pnpm install
pnpm dev
# 打开 http://localhost:4321
```

### CLI 工具（9 项信号全采集）

```bash
pnpm cli
```

### HTTP API

部署后直接 curl：

```bash
curl https://你的域名/api/check              # ANSI 彩色文本
curl "https://你的域名/api/check?format=json" # JSON
curl "https://你的域名/api/check?w=tz:30,lang:15"  # 自定义权重
```

## 部署到 Vercel

1. Fork 本仓库
2. Vercel 创建项目 → 导入 fork 后的仓库
3. Framework Preset 选 Astro（自动识别 `@astrojs/vercel`）
4. 部署完成后即可访问 `/` 和 `/api/check`

## 配置

`weights.json` 可覆盖默认权重（无需改代码）：

```json
{
  "timezone": 30,
  "language": 15
}
```

CLI 也支持 `?w=tz:30,lang:15` 这样的 URL 参数覆盖。

## 技术栈

- Astro 7 + `@astrojs/vercel`（静态输出 + 单个 serverless function）
- 纯 SVG 雷达图（无图表库依赖，~80 行）
- tsup 打包 CLI 为单文件 ESM bundle
- `systeminformation`（CLI 端读取 GPU/字体信息）

## 项目结构

```
src/
├─ core/                       浏览器/服务端/CLI 共享评分逻辑（isomorphic）
│  ├─ signals.ts               类型定义 + 5 个纯评分函数
│  ├─ scorer.ts                合并 9 项信号 → 总分 + 分档 + 命中列表
│  └─ defaults.ts              权重表、中国时区表、中文字体表、国产 GPU 厂商表
├─ components/                 RadarChart / ScoreRing / EvidenceList / ConfigCompare / Footer
├─ pages/
│  ├─ index.astro              中文主页（唯一页面）
│  └─ api/check.ts             HTTP 端点（prerender = false）
├─ scripts/detect.ts           浏览器扫描动画入口
├─ layouts/Base.astro          HTML 外壳
└─ styles/global.css           Claude 暖橙配色

cli/
└─ index.ts                    Node CLI（采集 9 项信号 → ANSI 表格输出）
```

## License

MIT
