/**
 * 默认常量池。Isomorphic：浏览器 / 服务端 / CLI 共享。
 */

export type SignalId =
  | 'timezone'
  | 'language'
  | 'fonts'
  | 'webgl'
  | 'osLocale'
  | 'claudeConfig'
  | 'emoji'
  | 'canvas'
  | 'proxy';

/** 默认权重，9 项总和 100。可被 weights.json / URL 参数覆盖。 */
export const DEFAULT_WEIGHTS: Record<SignalId, number> = {
  timezone: 24,
  language: 20,
  fonts: 14,
  webgl: 10,
  osLocale: 8,
  claudeConfig: 6,
  emoji: 6,
  canvas: 6,
  proxy: 6,
};

/** 中国大陆时区（IANA）。 */
export const CN_TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Urumqi',
  'Asia/Chongqing',
  'Asia/Chungking',
  'Asia/Harbin',
  'Asia/Kashgar',
];

/** Claude Code 实际读取的中国时区（公开逆向分析）。 */
export const CLAUDE_TIMEZONES = ['Asia/Shanghai', 'Asia/Urumqi'];

/** 大中华区时区（港澳台），中等命中。 */
export const GREATER_CN_TIMEZONES = ['Asia/Hong_Kong', 'Asia/Macau', 'Asia/Taipei'];

/** 简体中文字体探测清单。 */
export const FONTS_SC = [
  'Microsoft YaHei',
  'Microsoft YaHei UI',
  'SimSun',
  'NSimSun',
  'SimHei',
  'KaiTi',
  'FangSong',
  'DengXian',
  'PingFang SC',
  'Hiragino Sans GB',
  'STHeiti',
  'STSong',
  'Songti SC',
  'Source Han Sans CN',
  'Source Han Sans SC',
  'Noto Sans CJK SC',
  'Noto Serif CJK SC',
  'WenQuanYi Micro Hei',
  'WenQuanYi Zen Hei',
];

/** 繁体中文字体探测清单。 */
export const FONTS_TC = [
  'Microsoft JhengHei',
  'PMingLiU',
  'MingLiU',
  'DFKai-SB',
  'PingFang TC',
  'PingFang HK',
  'Source Han Sans TW',
  'Noto Sans CJK TC',
];

/** 国内 GPU 厂商关键词（WebGL vendor/renderer 命中即加分）。 */
export const CN_GPU_VENDORS = [
  'moore',
  'mthreads',
  'moorethreads',
  'zhaoxin',
  'shanghai',
  'loxli',
  'metax',
  'iluvatar',
  'innosilicon',
  'biren',
  'hygon',
  'kunlun',
  'glcore',
  'battlemage',
  'jingjia',
  'jwcc',
  'longtime',
  'treasure',
  'renesas',
];

/** 国内代理 hostname 关键词。 */
export const CN_PROXY_PATTERNS = [
  /\.cn$/i,
  /\.com\.cn$/i,
  /^aliyun/i,
  /^tencent/i,
  /^cloud-?tencent/i,
  /^huawei/i,
  /^cn-/i,
  /^china-/i,
];

/** 本地回环 / 内网代理（弱命中）。 */
export const LOCAL_PROXY_PATTERNS = [
  /^127\./,
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^localhost$/i,
];
