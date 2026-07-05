/**
 * CLI 入口：扫描本机环境，采集 9 项信号，输出 ANSI 报告或 JSON。
 *
 * 与浏览器端、HTTP 端点共用 src/core/* 的评分逻辑。
 *
 * 用法：
 *   node dist/cli.mjs              # ANSI 表格
 *   node dist/cli.mjs --json       # JSON
 *   node dist/cli.mjs --weights ./weights.json
 */
import si from 'systeminformation';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SIGNAL_META,
  scoreTimezone,
  scoreLanguages,
  scoreEmojiVendor,
  scoreWebgl,
  scoreFonts,
  FONT_LISTS,
  type SignalId,
  type SignalResult,
} from '../src/core/signals';
import { score, type ScoreResult } from '../src/core/scorer';
import { DEFAULT_WEIGHTS } from '../src/core/defaults';

// ----------------------------- 信号采集 -----------------------------

function collectTimezone(): SignalResult {
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    tz = '';
  }
  return {
    id: 'timezone',
    score: scoreTimezone(tz),
    evidence: tz || 'unknown',
    confidence: 'high',
    measured: true,
  };
}

function collectLanguage(): SignalResult {
  // Node 端没有 navigator.languages，读 env 变量
  const envs = [
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    process.env.LANGUAGE,
  ].filter(Boolean) as string[];
  // LANG 形如 "zh_CN.UTF-8" / "en_US.UTF-8"
  const langs = envs
    .flatMap((e) => e.split(':'))
    .map((e) => e.replace(/\.[^.]*$/, '').replace(/_/g, '-').toLowerCase());
  const unique = Array.from(new Set(langs));
  return {
    id: 'language',
    score: scoreLanguages(unique),
    evidence: unique.join(', ') || 'unknown',
    confidence: 'medium' as 'high',
    measured: true,
  } as SignalResult;
}

/** Windows 中文字体常见文件名（小写）。 */
const CN_FONT_FILES_WIN = [
  'msyh.ttc', 'msyh.ttf', 'msyhbd.ttc', 'msyhl.ttc',      // 微软雅黑
  'simsun.ttc', 'simsun.ttf', 'nsimsun.ttf',               // 宋体
  'simhei.ttf',                                            // 黑体
  'simkai.ttf', 'stkaiti.ttf',                            // 楷体
  'stsong.ttf', 'stzhongs.ttf',                            // 华文宋体
  'stheiti.ttf', 'stxihei.ttf',                            // 华文黑体
  'deng.ttf', 'dengb.ttf', 'dengl.ttf',                    // 等线
  'msjh.ttc', 'msjhbd.ttc',                                // 微软正黑（繁）
  'mingliu.ttc', 'pmingliu.ttf',                           // 明体（繁）
];

/** macOS 中文字体常见文件名。 */
const CN_FONT_FILES_MAC = [
  'pingfang.ttc',
  'stheiti light.ttc',
  'stheiti medium.ttc',
  'songti.ttc',
  'hiragino sans gb.ttc',
  'kaiti.ttc',
  'baoli.ttc',
  'libian.ttc',
  'weibei.ttc',
  'yuppy.ttc',
];

/** Linux 中文字体常见路径片段（文件名包含这些关键词即视为命中）。 */
const CN_FONT_KEYWORDS_LINUX = [
  'notosanscjk',
  'notoserifcjk',
  'sourcehansans',
  'sourcehanserif',
  'wqy',
  'wenquanyi',
  'droidsansfallback',
  'arphic',
  'uming',
  'ukai',
];

function listFontFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .map((f) => f.toLowerCase())
      .filter((f) => /\.(ttf|ttc|otf)$/.test(f));
  } catch {
    return [];
  }
}

function collectFonts(): SignalResult {
  const platform = process.platform;
  let found: { sc: string[]; tc: string[] } = { sc: [], tc: [] };

  if (platform === 'win32') {
    const fontsDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
    const files = listFontFiles(fontsDir);
    // 把硬编码文件名映射到字体名（简化：命中即视为对应字体可用）
    for (const f of CN_FONT_FILES_WIN) {
      if (files.includes(f)) {
        if (f.startsWith('msjh') || f.startsWith('mingliu') || f.startsWith('pmingliu')) {
          found.tc.push(f);
        } else {
          found.sc.push(f);
        }
      }
    }
  } else if (platform === 'darwin') {
    const dirs = [
      path.join(os.homedir(), 'Library/Fonts'),
      '/Library/Fonts',
      '/System/Library/Fonts',
    ];
    const files = Array.from(new Set(dirs.flatMap(listFontFiles)));
    for (const f of CN_FONT_FILES_MAC) {
      if (files.includes(f)) {
        if (f.includes('pingfang') && f.endsWith('.ttc')) {
          // PingFang.ttc 同时含 SC/TC
          found.sc.push('PingFang SC');
          found.tc.push('PingFang TC');
        } else {
          found.sc.push(f);
        }
      }
    }
  } else {
    // Linux
    const dirs = [
      '/usr/share/fonts',
      path.join(os.homedir(), '.fonts'),
      path.join(os.homedir(), '.local/share/fonts'),
    ];
    const files = Array.from(new Set(dirs.flatMap(listFontFiles)));
    for (const kw of CN_FONT_KEYWORDS_LINUX) {
      const hit = files.find((f) => f.includes(kw));
      if (hit) {
        if (kw.includes('cjk') || kw.includes('sourcehan')) {
          found.sc.push(hit);
        } else {
          found.sc.push(hit);
        }
      }
    }
  }

  // 用 scoreFonts 的简化逻辑（输入是文件名而非字体名，但计数仍然有效）
  const scCount = found.sc.length;
  const tcCount = found.tc.length;
  let scoreVal = 0;
  if (scCount >= 1) scoreVal = Math.min(1, 0.75 + 0.05 * scCount);
  else if (tcCount >= 1) scoreVal = 0.5;

  // 也用 scoreFonts 验证（避免类型不一致）
  void scoreFonts;
  void FONT_LISTS;

  const evidence =
    scCount + tcCount === 0
      ? '未检测到'
      : [...found.sc, ...found.tc].slice(0, 4).join(', ') +
        (scCount + tcCount > 4 ? ' …' : '');

  return {
    id: 'fonts',
    score: scoreVal,
    evidence,
    confidence: 'high',
    measured: true,
  };
}

async function collectWebgl(): Promise<SignalResult> {
  try {
    const g = await si.graphics();
    const vendors = g.controllers.map((c) => `${c.vendor || ''} ${c.model || ''}`.trim());
    const vendorStr = vendors.join(' | ') || 'unknown';
    // 用第一个 controller 做 GPU 厂商判断
    const first = g.controllers[0];
    const v = (first?.vendor || '').toLowerCase();
    const m = (first?.model || '').toLowerCase();
    // 复用 scoreWebgl：传入 vendor/renderer 字符串
    const { score: s, hits } = scoreWebgl(first?.vendor || '', first?.model || '');
    return {
      id: 'webgl',
      score: s,
      evidence: hits.length > 0 ? `命中: ${hits.join(', ')} · ${vendorStr}` : vendorStr,
      confidence: 'high',
      measured: true,
    };
  } catch {
    return {
      id: 'webgl',
      score: 0,
      evidence: 'systeminformation 不可用',
      confidence: 'low',
      measured: true,
    };
  }
}

function collectOsLocale(): SignalResult {
  // Windows: chcp；Mac/Linux: env / locale 命令
  let evidence = '';
  let scoreVal = 0;

  if (process.platform === 'win32') {
    try {
      const out = execSync('chcp', { encoding: 'utf8', timeout: 3000 }).trim();
      const m = out.match(/:\s*(\d+)/);
      const codepage = m ? parseInt(m[1], 10) : 0;
      evidence = `代码页 ${codepage}`;
      // 936 = GBK（中国大陆），950 = Big5（繁体），65001 = UTF-8
      if (codepage === 936) scoreVal = 1;
      else if (codepage === 950) scoreVal = 0.5;
      else if (codepage === 65001) scoreVal = 0.1;
    } catch {
      evidence = 'chcp 失败';
    }
  } else {
    try {
      const out = execSync('locale', { encoding: 'utf8', timeout: 3000 }).trim();
      const lines = out.split('\n');
      const langLine =
        lines.find((l) => l.startsWith('LANG=')) ||
        lines.find((l) => l.startsWith('LC_ALL='));
      const val = (langLine || '').replace(/^[^=]*=/, '').replace(/"/g, '');
      evidence = val;
      const lower = val.toLowerCase();
      if (lower.startsWith('zh_cn') || lower.includes('hans')) scoreVal = 1;
      else if (lower.startsWith('zh_tw') || lower.startsWith('zh_hk') || lower.includes('hant')) {
        scoreVal = 0.5;
      } else if (lower.startsWith('zh')) scoreVal = 0.4;
    } catch {
      evidence = 'locale 失败';
    }
  }

  return {
    id: 'osLocale',
    score: scoreVal,
    evidence,
    confidence: 'high',
    measured: true,
  };
}

function collectClaudeConfig(): SignalResult {
  const home = os.homedir();
  const dir = path.join(home, '.claude');
  let exists = false;
  let filesCount = 0;
  let sizeBytes = 0;
  try {
    const stat = fs.statSync(dir);
    if (stat.isDirectory()) {
      exists = true;
      const entries = fs.readdirSync(dir, { recursive: true });
      for (const e of entries) {
        const full = path.join(dir, String(e));
        try {
          const s = fs.statSync(full);
          if (s.isFile()) {
            filesCount += 1;
            sizeBytes += s.size;
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* directory doesn't exist */
  }

  const evidence = exists
    ? `存在 (${filesCount} 个文件, ${formatBytes(sizeBytes)})`
    : '不存在';
  // 存在 + 文件数 > 0 即弱命中；大量配置强命中
  let scoreVal = 0;
  if (exists && filesCount > 0) scoreVal = filesCount > 20 ? 0.8 : 0.5;

  return {
    id: 'claudeConfig',
    score: scoreVal,
    evidence,
    confidence: 'low',
    measured: true,
  };
}

function collectEmoji(): SignalResult {
  // CLI 没法测真实 Emoji 渲染，从 OS 平台推断
  const platform = process.platform;
  const probe =
    platform === 'win32'
      ? 'win'
      : platform === 'darwin'
        ? 'mac'
        : 'linux';
  const { vendor, score } = scoreEmojiVendor(probe);
  return {
    id: 'emoji',
    score,
    evidence: `${vendor} 风格 (OS 推断)`,
    confidence: 'low',
    measured: true,
  };
}

function collectCanvas(): SignalResult {
  // CLI 无 canvas，标记为未测量
  return {
    id: 'canvas',
    score: 0,
    evidence: 'CLI 不可测',
    confidence: 'low',
    measured: false,
  };
}

function collectProxy(): SignalResult {
  const env = process.env;
  const proxyStr =
    env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || '';
  if (!proxyStr) {
    return {
      id: 'proxy',
      score: 0,
      evidence: '未设置',
      confidence: 'high',
      measured: true,
    };
  }
  // 解析 hostname
  let hostname = '';
  try {
    hostname = new URL(proxyStr).hostname;
  } catch {
    hostname = proxyStr;
  }

  const cnHits: string[] = [];
  // 国内代理特征
  const cnPatterns: Array<{ re: RegExp; name: string }> = [
    { re: /\.cn$/i, name: '.cn 域名' },
    { re: /\.com\.cn$/i, name: '.com.cn 域名' },
    { re: /^aliyun/i, name: 'aliyun' },
    { re: /^tencent/i, name: 'tencent' },
    { re: /^cloud-?tencent/i, name: 'cloud-tencent' },
    { re: /^huawei/i, name: 'huawei' },
    { re: /^cn-/i, name: 'cn- 前缀' },
    { re: /^china-/i, name: 'china- 前缀' },
  ];
  for (const p of cnPatterns) {
    if (p.re.test(hostname)) cnHits.push(p.name);
  }

  const localPatterns: Array<{ re: RegExp; name: string }> = [
    { re: /^127\./, name: '127.*' },
    { re: /^192\.168\./, name: '192.168.*' },
    { re: /^10\./, name: '10.*' },
    { re: /^172\.(1[6-9]|2\d|3[01])\./, name: '172.16-31.*' },
    { re: /^localhost$/i, name: 'localhost' },
  ];
  const localHits: string[] = [];
  for (const p of localPatterns) {
    if (p.re.test(hostname)) localHits.push(p.name);
  }

  let scoreVal = 0;
  let evidence = `${hostname} (${proxyStr})`;
  if (cnHits.length > 0) {
    scoreVal = 0.85;
    evidence += ` · 命中 ${cnHits.join(', ')}`;
  } else if (localHits.length > 0) {
    scoreVal = 0.4;
    evidence += ` · 本地/内网 (${localHits.join(', ')})`;
  }

  return {
    id: 'proxy',
    score: scoreVal,
    evidence,
    confidence: 'high',
    measured: true,
  };
}

// ----------------------------- 渲染 -----------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  accent: (s: string) => `\x1b[38;5;173m${s}\x1b[0m`,
  dimColor: (s: string) => `\x1b[38;5;245m${s}\x1b[0m`,
  boldText: (s: string) => `\x1b[1m${s}\x1b[0m`,
  bandColor: (band: string, s: string) => {
    const code = band === 'low' ? '38;5;71' : band === 'medium' ? '38;5;178' : '38;5;167';
    return `\x1b[${code}m${s}\x1b[0m`;
  },
};

function renderAnsi(result: ScoreResult, useColor: boolean): string {
  if (!useColor) {
    // 去掉 ANSI 的简化版（递归不便，直接构造无色版本）
    return renderPlain(result);
  }

  const bar = ANSI.accent('│');
  const rule = (corner: string) => ANSI.accent(corner + '─'.repeat(52));
  const bandBadge = ANSI.bandColor(result.band, '●');

  const bandText: Record<string, string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
  };
  const bandDesc: Record<string, string> = {
    low: '本机环境看起来不像中国用户。',
    medium: '检测到部分中国环境特征。',
    high: '多项信号强烈指向中国环境。',
  };

  const out: string[] = [];
  out.push(rule('╭'));
  out.push(`${bar}  ${ANSI.accent(ANSI.boldText('Claude Safe'))}  ${ANSI.dimColor('本地环境检测')}`);
  out.push(`${bar}  ${ANSI.dimColor(`平台 ${process.platform}/${process.arch}`)}`);
  out.push(bar);
  out.push(
    `${bar}  风险分  ${ANSI.bandColor(result.band, ANSI.boldText(`${result.total}/100`))}   ${bandBadge} ${ANSI.bandColor(result.band, bandText[result.band])}`,
  );
  out.push(`${bar}  ${bandDesc[result.band]}`);
  out.push(bar);
  out.push(`${bar}  ${ANSI.dimColor('信号详情')}`);
  for (const r of result.results) {
    const c = r.contribution > 0 ? `+${r.contribution}`.padStart(4) : (r.measured ? '   0' : '   —').padStart(4);
    const mark = !r.measured ? ANSI.dimColor('·') : r.contribution > 0 ? bandBadge : ANSI.dimColor('·');
    const name = SIGNAL_META.find((m) => m.id === r.id)?.name ?? r.id;
    out.push(`${bar}    ${mark} ${ANSI.dimColor(c)}  ${name}${r.evidence ? ANSI.dimColor(` · ${r.evidence}`) : ''}`);
  }
  out.push(bar);
  out.push(`${bar}  ${ANSI.dimColor('命中证据')}`);
  const hits = result.hits;
  if (hits.length === 0) {
    out.push(`${bar}    ${ANSI.dimColor('无')}`);
  } else {
    for (const h of hits) {
      const name = SIGNAL_META.find((m) => m.id === h.id)?.name ?? h.id;
      out.push(`${bar}    ${ANSI.bandColor(h.verdict, '●')} ${ANSI.boldText(`+${h.contribution}`.padStart(4))}  ${name}`);
    }
  }
  out.push(bar);
  out.push(`${bar}  ${ANSI.dimColor('安全建议')}`);
  for (const h of hits) {
    const meta = SIGNAL_META.find((m) => m.id === h.id);
    if (meta) {
      out.push(`${bar}    ${ANSI.accent('→')} ${meta.hint}`);
    }
  }
  if (hits.length === 0) {
    out.push(`${bar}    ${ANSI.dimColor('当前配置已较安全，无需调整')}`);
  }
  out.push(rule('╰'));
  out.push('');
  return out.join('\n');
}

function renderPlain(result: ScoreResult): string {
  const lines: string[] = [];
  lines.push('=== Claude Safe ===');
  lines.push(`平台 ${process.platform}/${process.arch}`);
  lines.push(`风险分 ${result.total}/100  [${result.band}]`);
  lines.push('');
  lines.push('信号详情:');
  for (const r of result.results) {
    const name = SIGNAL_META.find((m) => m.id === r.id)?.name ?? r.id;
    const c = r.measured ? `+${r.contribution}` : '—';
    lines.push(`  ${c.padStart(4)}  ${name}${r.evidence ? ` · ${r.evidence}` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderJson(result: ScoreResult): string {
  const bandText: Record<string, string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
  };
  return JSON.stringify(
    {
      app: 'Claude Safe CLI',
      platform: `${process.platform}/${process.arch}`,
      node: process.version,
      score: result.total,
      band: result.band,
      verdict: bandText[result.band],
      coverage: {
        measuredWeight: result.measuredWeight,
        totalWeight: result.totalWeight,
      },
      signals: result.results.map((r) => ({
        id: r.id,
        name: SIGNAL_META.find((m) => m.id === r.id)?.name ?? r.id,
        contribution: r.contribution,
        score: Math.round(r.score * 100) / 100,
        verdict: r.verdict,
        evidence: r.evidence,
        measured: r.measured,
      })),
      hits: result.hits.map((h) => ({
        id: h.id,
        name: SIGNAL_META.find((m) => m.id === h.id)?.name ?? h.id,
        contribution: h.contribution,
      })),
    },
    null,
    2,
  );
}

// ----------------------------- 主入口 -----------------------------

function loadWeightsOverride(): Partial<Record<SignalId, number>> | undefined {
  // --weights=<path> 或 --weights <path>
  const wArg = process.argv.find((a) => a.startsWith('--weights'));
  if (!wArg) return undefined;
  const eq = wArg.indexOf('=');
  const p = eq >= 0 ? wArg.slice(eq + 1) : process.argv[process.argv.indexOf(wArg) + 1];
  if (!p) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const out: Partial<Record<SignalId, number>> = {};
    for (const k of Object.keys(DEFAULT_WEIGHTS) as SignalId[]) {
      const v = raw[k];
      if (typeof v === 'number' && v >= 0) out[k] = v;
    }
    return out;
  } catch {
    return undefined;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const noColor = argv.includes('--no-color') || process.env.NO_COLOR;
  const isTTY = process.stdout.isTTY;
  const useColor = !noColor && isTTY !== false;

  const collected: Partial<Record<SignalId, SignalResult>> = {};

  // 同步采集
  collected.timezone = collectTimezone();
  collected.language = collectLanguage();
  collected.fonts = collectFonts();
  collected.osLocale = collectOsLocale();
  collected.claudeConfig = collectClaudeConfig();
  collected.emoji = collectEmoji();
  collected.canvas = collectCanvas();
  collected.proxy = collectProxy();
  // 异步采集
  collected.webgl = await collectWebgl();

  const weightsOverride = loadWeightsOverride();
  const result = score(collected, weightsOverride);

  if (wantJson) {
    process.stdout.write(renderJson(result) + '\n');
  } else {
    process.stdout.write(renderAnsi(result, useColor) + '\n');
  }
}

void main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

// 避免 tsup 报 unused 警告
void fileURLToPath;
