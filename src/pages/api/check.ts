/**
 * 服务端「中国用户」估算，可经 curl / HTTP 调用。
 *
 * 浏览器扫描能读操作系统级信号（时区、字体、Intl locale、WebGL…），
 * 普通 HTTP 请求看不到这些。本端点基于请求可见的信息评分：
 *   - x-vercel-ip-timezone — 请求方 IP 的归属地时区（最关键）
 *   - x-vercel-ip-country   — 请求方 IP 的国家
 *   - accept-language       — 浏览器/UA 的语言偏好
 *   - user-agent            — 用于推断 emoji 渲染器
 *
 * 字体 / Intl locale / WebGL / Canvas 等浏览器独有信号无法在服务端测，分数按
 * 可测权重（70/100）归一化到 0-100。复用与浏览器端完全一致的纯函数评分器。
 */
import type { APIRoute } from 'astro';
import {
  SIGNAL_META,
  scoreTimezone,
  scoreLanguages,
  scoreEmojiVendor,
  type SignalId,
  type SignalResult,
} from '../../core/signals';
import { score } from '../../core/scorer';

export const prerender = false;

const SITE = 'https://claude-safe.vercel.app';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean);
}

/** IANA 时区相对于 UTC 的偏移分钟数（Asia/Shanghai → 480）。 */
function tzOffsetEastMinutes(timeZone: string): number | null {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    const h = parseInt(m[2] ?? '0', 10);
    const min = parseInt(m[3] ?? '0', 10);
    return sign * (h * 60 + min);
  } catch {
    return null;
  }
}

function fmtOffset(min: number | null): string {
  if (min === null) return 'unknown';
  const sign = min >= 0 ? '+' : '-';
  const h = Math.abs(min) / 60;
  return `UTC${sign}${Number.isInteger(h) ? h : h.toFixed(1)}`;
}

function wantsJson(url: URL, req: Request): boolean {
  const fmt = (url.searchParams.get('format') || '').toLowerCase();
  if (fmt === 'json') return true;
  if (fmt === 'text' || fmt === 'txt') return false;
  return (req.headers.get('accept') || '').toLowerCase().includes('application/json');
}

function wantsColor(url: URL, req: Request): boolean {
  const q = (url.searchParams.get('color') || '').toLowerCase();
  if (url.searchParams.has('no-color') || ['0', 'false', 'no', 'off'].includes(q)) return false;
  if (['1', 'true', 'yes', 'on', 'force'].includes(q)) return true;
  const accept = (req.headers.get('accept') || '').toLowerCase();
  if (accept.includes('text/html')) return false;
  const ua = (req.headers.get('user-agent') || '').toLowerCase();
  return !/mozilla|chrome\/|safari\/|firefox\/|edg\//.test(ua);
}

function analyze(req: Request) {
  const tz = req.headers.get('x-vercel-ip-timezone') || '';
  const country = req.headers.get('x-vercel-ip-country') || '';
  const acceptLang = parseAcceptLanguage(req.headers.get('accept-language') || '');
  const ua = req.headers.get('user-agent') || '';

  const offsetEast = tzOffsetEastMinutes(tz);
  const emoji = scoreEmojiVendor(ua);

  const collected: Partial<Record<SignalId, SignalResult>> = {
    timezone: {
      id: 'timezone',
      score: scoreTimezone(tz),
      evidence: tz || 'unknown',
      confidence: 'high',
      measured: true,
    },
    language: {
      id: 'language',
      score: scoreLanguages(acceptLang),
      evidence: acceptLang.join(', ') || 'unknown',
      confidence: 'high',
      measured: true,
    },
    emoji: {
      id: 'emoji',
      score: emoji.score,
      evidence: `${emoji.vendor} 风格`,
      confidence: 'low',
      measured: true,
    },
  };

  // 时区偏移作为 timezone 的旁证（不计为独立信号，因为合并到了 timezone）
  void offsetEast;

  const result = score(collected);

  return {
    result,
    geo: { country: country || null, timezone: tz || null, offset: fmtOffset(offsetEast) },
  };
}

function jsonBody(a: ReturnType<typeof analyze>) {
  const { result, geo } = a;
  const verdictMap = { low: '低风险', medium: '中风险', high: '高风险' };
  const descMap = {
    low: '环境看起来不像中国用户',
    medium: '检测到部分中国环境特征',
    high: '多项信号强烈指向中国环境',
  };
  return {
    app: 'Claude Safe',
    estimate: true,
    score: result.total,
    band: result.band,
    verdict: verdictMap[result.band],
    message: descMap[result.band],
    coverage: {
      measuredWeight: result.measuredWeight,
      totalWeight: result.totalWeight,
    },
    geo,
    signals: result.results
      .filter((r) => r.measured)
      .map((r) => ({
        id: r.id,
        name: SIGNAL_META.find((m) => m.id === r.id)?.name ?? r.id,
        contribution: r.contribution,
        score: Math.round(r.score * 100) / 100,
        evidence: r.evidence,
      })),
    note:
      '基于 IP 归属地 + 请求头的服务端估算；字体 / WebGL / Canvas 等信号仅浏览器或 CLI 可测。',
    docs: `${SITE}/`,
  };
}

function textBody(a: ReturnType<typeof analyze>, color: boolean): string {
  const { result, geo } = a;
  const bandText: Record<string, string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
  };
  const bandDesc: Record<string, string> = {
    low: '环境看起来不像中国用户。',
    medium: '检测到部分中国环境特征。建议调整时区与浏览器语言。',
    high: '多项信号强烈指向中国环境。Claude Code 极有可能将你标记为中国用户。',
  };

  const paint = (open: string) => (s: string) =>
    color ? `\x1b[${open}m${s}\x1b[0m` : s;
  const accent = paint('38;5;173');
  const dim = paint('38;5;245');
  const bold = paint('1');
  const bandColor = { low: paint('38;5;71'), medium: paint('38;5;178'), high: paint('38;5;167') }[
    result.band
  ];
  const badge = bandColor('●');

  const bar = accent('│');
  const rule = (corner: string) => accent(corner + '─'.repeat(52));

  const out: string[] = [];
  out.push(rule('╭'));
  out.push(`${bar}  ${accent(bold('Claude Safe'))}  ${dim('「中国用户」检测')}`);
  out.push(`${bar}  ${dim('基于 IP 归属地 + 请求头的服务端估算')}`);
  out.push(bar);
  out.push(
    `${bar}  风险分  ${bandColor(bold(`${result.total}/100`))}   ${badge} ${bandColor(
      bandText[result.band],
    )}`,
  );
  out.push(`${bar}  ${bandDesc[result.band]}`);
  out.push(bar);
  out.push(`${bar}  ${dim('服务端可见信号')}`);
  for (const s of result.results.filter((r) => r.measured).sort((x, y) => y.contribution - x.contribution)) {
    const c = (s.contribution > 0 ? `+${s.contribution}` : `${s.contribution}`).padStart(4);
    const mark = s.contribution > 0 ? badge : dim('·');
    const name = SIGNAL_META.find((m) => m.id === s.id)?.name ?? s.id;
    out.push(`${bar}    ${mark} ${dim(c)}  ${name}${s.evidence ? dim(` · ${s.evidence}`) : ''}`);
  }
  out.push(bar);
  out.push(`${bar}  ${dim('仅浏览器/CLI 可测（curl 看不到）')}`);
  const browserOnly = result.results
    .filter((r) => !r.measured)
    .map((r) => SIGNAL_META.find((m) => m.id === r.id)?.name ?? r.id)
    .join(' · ');
  out.push(`${bar}    ${dim(browserOnly)}`);
  out.push(bar);
  const geoStr = [geo.country, geo.timezone, geo.offset]
    .filter(Boolean)
    .join(' · ');
  out.push(
    `${bar}  ${dim(`覆盖 ${result.measuredWeight}/${result.totalWeight}  ·  归属地 ${geoStr || '无'}`)}`,
  );
  out.push(`${bar}  ${dim('IP/请求头估算，与浏览器端系统检测结果可能不同。')}`);
  out.push(rule('╰'));
  out.push(`   ${accent('→')}  完整检测  ${accent(`${SITE}/`)}`);
  out.push(`   ${dim('JSON      → 加 ?format=json')}`);
  out.push(`   ${dim('本地 CLI  → pnpm cli')}`);
  out.push('');
  return out.join('\n');
}

export const GET: APIRoute = ({ request, url }) => {
  const analysis = analyze(request);
  const vary = 'Accept, Accept-Language, User-Agent';

  if (!wantsJson(url, request)) {
    return new Response(textBody(analysis, wantsColor(url, request)), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        Vary: vary,
        ...CORS,
      },
    });
  }

  return new Response(JSON.stringify(jsonBody(analysis), null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: vary,
      ...CORS,
    },
  });
};

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
