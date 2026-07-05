/**
 * 信号元数据 + isomorphic 评分函数。
 *
 * 这里只放纯函数：输入是已知信号值（字符串/数组），输出是分数。
 * DOM 检测、文件系统读取都在各自的入口（detect.ts / cli/index.ts）里完成，
 * 调用这里的纯函数完成打分。这样浏览器、服务端、CLI 三端共用同一套评分逻辑。
 */

import {
  CLAUDE_TIMEZONES,
  CN_TIMEZONES,
  FONTS_SC,
  FONTS_TC,
  GREATER_CN_TIMEZONES,
  CN_GPU_VENDORS,
  type SignalId,
} from './defaults';

export type { SignalId };

export type RiskBand = 'low' | 'medium' | 'high';
export type Scope = 'browser' | 'server' | 'cli';

/** 单个信号检测结果。 */
export interface SignalResult {
  id: SignalId;
  /** 0..1「中国相似度」。 */
  score: number;
  /** 命中证据，直接展示给用户。 */
  evidence: string;
  /** 检测可信度（高=直接对应 Claude 真实检测；低=间接指纹）。 */
  confidence: 'high' | 'low';
  /** 是否实际检测到（服务端/CLI 看不到的信号为 false）。 */
  measured: boolean;
}

/** 信号元数据：名称、作用域、安全建议、机制说明。 */
export interface SignalMeta {
  id: SignalId;
  name: string;
  claudeUsed?: boolean;
  scopes: Scope[];
  hint: string;
  /** 解释为什么这个信号和「中国封号」相关。 */
  explanation: string;
}

/** 9 个信号的元数据，UI 渲染用。 */
export const SIGNAL_META: SignalMeta[] = [
  {
    id: 'timezone',
    name: '系统时区',
    claudeUsed: true,
    scopes: ['browser', 'server', 'cli'],
    hint: '把系统时区设为 Asia/Tokyo、America/New_York 等非中国时区',
    explanation:
      'Claude Code 通过 Intl.DateTimeFormat 读取操作系统时区，这是它真实判定的核心信号。命中 Asia/Shanghai 或 Asia/Urumqi 时，会在 system prompt 的「Today\'s date is …」一行用隐写术（日期分隔符 - 变 /）标记为中国用户。',
  },
  {
    id: 'language',
    name: '浏览器语言',
    claudeUsed: true,
    scopes: ['browser', 'server', 'cli'],
    hint: '浏览器首选语言设为 en-US，移除 navigator.languages 中的 zh-*',
    explanation:
      'navigator.languages（服务端对应 Accept-Language 头）反映用户语言偏好。zh-CN / zh-Hans 是中国环境最强特征之一，Claude 与多数海外服务都用它做风险评分。',
  },
  {
    id: 'fonts',
    name: '中文字体',
    scopes: ['browser', 'cli'],
    hint: '难以隐藏，可使用隐私浏览器或容器隔离环境',
    explanation:
      '通过 canvas 测量「中文字体检测ABCabc」在不同字体下的渲染宽度，能反查系统是否安装微软雅黑、PingFang SC、思源黑体等简体中文字体。中国发行版 Windows/macOS 默认带这些字体，是间接的「中文环境」指纹。',
  },
  {
    id: 'webgl',
    name: 'GPU 字符串',
    scopes: ['browser', 'cli'],
    hint: 'WebGL 中禁用硬件加速，或使用国外 GPU',
    explanation:
      '通过 WEBGL_debug_renderer_info 扩展读取 GPU 厂商和型号。摩尔线程、兆芯、芯动、宝龙达等国产 GPU 厂商字符串是国内设备的强特征。NVIDIA/AMD/Intel 主流型号则不命中。',
  },
  {
    id: 'osLocale',
    name: '系统区域/代码页',
    scopes: ['cli'],
    hint: 'Windows「区域」改为英文(美国)，PowerShell 执行 chcp 437',
    explanation:
      'Windows 代码页 936 (GBK) 是简体中文系统默认；950 (Big5) 是繁体；65001 (UTF-8) 通常表示英文环境。Linux/Mac 通过 LANG/LC_ALL 反映区域。这些是 OS 级别的「中文环境」硬证据。',
  },
  {
    id: 'claudeConfig',
    name: 'Claude 配置',
    scopes: ['cli'],
    hint: '清空 ~/.claude/ 或用容器隔离',
    explanation:
      '~/.claude/ 目录是 Claude Code 的本地配置与历史记录位置。存在且文件量大，间接说明本机长期作为 Claude Code 客户端使用——结合中国时区、中国 IP 时构成累积证据。',
  },
  {
    id: 'emoji',
    name: 'Emoji 渲染器',
    scopes: ['browser'],
    hint: '使用 Apple/Google 风格的 Emoji 字体',
    explanation:
      '通过 navigator.userAgent 推断 OS 厂商，对应不同 Emoji 渲染风格（Apple/Google/Microsoft）。Microsoft 风格意味着 Windows 系统，结合其他信号加权。单独看是弱信号。',
  },
  {
    id: 'canvas',
    name: 'Canvas 指纹',
    scopes: ['browser'],
    hint: '难以隐藏，可使用隐私浏览器',
    explanation:
      '绘制特定文本+形状后取像素 hash，得到稳定的浏览器指纹。该指纹本身不直接代表「中国」，但中国用户的 Windows+Edge/Chrome 占比极高，导致 hash 落在少数几个常见桶里，可作辅助识别。',
  },
  {
    id: 'proxy',
    name: '代理 hostname',
    scopes: ['server', 'cli'],
    hint: '使用国外节点的代理，避免 .cn / 国内云厂商域名',
    explanation:
      'HTTP_PROXY 环境变量（服务端可见 x-forwarded-for）暴露中转节点。hostname 含 .cn / aliyun / tencent / huawei 等国内云厂商关键词，意味着用户用国内代理出海——这是 Claude 反向识别中转站的典型特征。',
  },
];

/** 系统时区打分。 */
export function scoreTimezone(tz: string): number {
  if (!tz) return 0;
  if (CLAUDE_TIMEZONES.includes(tz) || CN_TIMEZONES.includes(tz)) return 1;
  if (GREATER_CN_TIMEZONES.includes(tz)) return 0.6;
  return 0;
}

/** 浏览器语言 / Accept-Language 打分。 */
export function scoreLanguages(langs: string[]): number {
  const list = (langs || []).map((l) => (l || '').toLowerCase());
  if (list.length === 0) return 0;
  const primary = list[0] || '';
  const isHansCN = (l: string) =>
    l.startsWith('zh-cn') || l.includes('hans') || l === 'zh';
  const isHant = (l: string) =>
    l.startsWith('zh-tw') ||
    l.startsWith('zh-hk') ||
    l.startsWith('zh-mo') ||
    l.includes('hant');
  if (isHansCN(primary)) return 1;
  if (isHant(primary)) return 0.5;
  if (list.some(isHansCN)) return 0.7;
  if (list.some((l) => l.startsWith('zh'))) return 0.4;
  return 0;
}

/** Emoji 渲染器推断。 */
export function scoreEmojiVendor(probe: string): { vendor: string; score: number } {
  const p = (probe || '').toLowerCase();
  let vendor = 'Unknown';
  if (/iphone|ipad|ipod|mac/.test(p)) vendor = 'Apple';
  else if (/android/.test(p)) vendor = 'Google';
  else if (/win/.test(p)) vendor = 'Microsoft';
  else if (/cros/.test(p)) vendor = 'Google';
  else if (/linux/.test(p)) vendor = 'Linux / Other';
  const scoreMap: Record<string, number> = {
    Apple: 0.25,
    Microsoft: 0.4,
    Google: 0.35,
    'Linux / Other': 0.5,
    Unknown: 0.4,
  };
  return { vendor, score: scoreMap[vendor] ?? 0.4 };
}

/** WebGL GPU 字符串打分。 */
export function scoreWebgl(vendor: string, renderer: string): {
  score: number;
  evidence: string;
  hits: string[];
} {
  const v = (vendor || '').toLowerCase();
  const r = (renderer || '').toLowerCase();
  const hits = CN_GPU_VENDORS.filter((kw) => v.includes(kw) || r.includes(kw));
  if (hits.length > 0) {
    return { score: 0.85, evidence: `${vendor} / ${renderer}`, hits };
  }
  return { score: 0, evidence: `${vendor} / ${renderer}`, hits: [] };
}

/** 已检测到的字体列表打分。 */
export function scoreFonts(sc: string[], tc: string[]): {
  score: number;
  evidence: string;
} {
  const scCount = sc.length;
  const tcCount = tc.length;
  let score = 0;
  if (scCount >= 1) score = Math.min(1, 0.75 + 0.05 * scCount);
  else if (tcCount >= 1) score = 0.5;
  const all = [...sc, ...tc];
  const evidence =
    all.length === 0
      ? '未检测到'
      : all.slice(0, 4).join(', ') + (all.length > 4 ? ' …' : '');
  return { score, evidence };
}

/** 已知的字体表（供调用方迭代）。 */
export const FONT_LISTS = { FONTS_SC, FONTS_TC };

/** 风险分档。 */
export function riskBand(total: number): RiskBand {
  if (total <= 30) return 'low';
  if (total <= 60) return 'medium';
  return 'high';
}

/** 单信号命中等级。 */
export function signalVerdict(score: number): RiskBand {
  if (score >= 0.6) return 'high';
  if (score >= 0.25) return 'medium';
  return 'low';
}
