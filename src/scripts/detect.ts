/**
 * 浏览器端入口。运行逐项扫描动画：每个信号依次亮起，分数环随分数累加而增长，
 * 最终给出结论、命中列表与雷达图。
 *
 * 浏览器只能测 6 个信号（timezone/language/fonts/webgl/emoji/canvas），
 * 另外 3 个（osLocale/claudeConfig/proxy）由 CLI 采集。
 */
import {
  SIGNAL_META,
  scoreTimezone,
  scoreLanguages,
  scoreEmojiVendor,
  scoreWebgl,
  scoreFonts,
  FONT_LISTS,
  type SignalResult,
  type SignalId,
} from '../core/signals';
import { score } from '../core/scorer';

const SCAN_STEP_MS = 380;
const SETTLE_MS = 120;

// --- DOM helpers ---
function q<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector(sel) as T | null;
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- 雷达图 ---
const N_RADAR = SIGNAL_META.length; // 9
const CX = 130, CY = 130, R_MAX = 90;

function radarVertex(i: number, radius: number): [number, number] {
  const angle = (i * 2 * Math.PI) / N_RADAR - Math.PI / 2;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

function updateRadar(scores: Partial<Record<SignalId, number>>, band: string) {
  const shape = q<SVGPolygonElement>('#radar-shape');
  const vertices = document.querySelectorAll<SVGCircleElement>('#radar-vertices circle');
  const wrap = q('#radar');
  if (wrap) wrap.setAttribute('data-band', band);

  const points: string[] = [];
  SIGNAL_META.forEach((meta, i) => {
    const s = scores[meta.id] ?? 0;
    const [x, y] = radarVertex(i, R_MAX * Math.max(0, Math.min(1, s)));
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    const v = vertices[i];
    if (v) {
      v.setAttribute('cx', x.toFixed(1));
      v.setAttribute('cy', y.toFixed(1));
      v.setAttribute('r', s > 0.05 ? '3.2' : '0');
    }
  });
  if (shape) shape.setAttribute('points', points.join(' '));
}

// --- 分数环 ---
const RING_R = 90;
const RING_C = 2 * Math.PI * RING_R;

function setRing(total: number, band: string) {
  const ring = q<SVGCircleElement>('#score-ring');
  const valueEl = q('#score-value');
  const gauge = q('#score-gauge');
  if (ring) {
    ring.style.strokeDasharray = `${RING_C.toFixed(2)}px`;
    ring.style.strokeDashoffset = `${(RING_C * (1 - total / 100)).toFixed(2)}px`;
  }
  if (valueEl) valueEl.textContent = String(total);
  if (gauge) {
    gauge.removeAttribute('data-scanning');
    gauge.setAttribute('data-band', band);
  }
}

// --- 检测函数 ---

function detectTimezone(): SignalResult {
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

function detectLanguage(): SignalResult {
  const list =
    navigator.languages && navigator.languages.length
      ? Array.from(navigator.languages)
      : [navigator.language];
  const filtered = list.filter(Boolean).map((l) => l.toLowerCase());
  return {
    id: 'language',
    score: scoreLanguages(filtered),
    evidence: filtered.join(', ') || 'unknown',
    confidence: 'high',
    measured: true,
  };
}

function detectEmoji(): SignalResult {
  const ua = (navigator.userAgent || '').toLowerCase();
  const platform = ((navigator as Navigator & { platform?: string }).platform || '').toLowerCase();
  const { vendor, score } = scoreEmojiVendor(`${platform} ${ua}`);
  return {
    id: 'emoji',
    score,
    evidence: `${vendor} 风格`,
    confidence: 'low',
    measured: true,
  };
}

function isFontAvailable(font: string, ctx: CanvasRenderingContext2D): boolean {
  const test = '中文字体检测ABCabc012';
  const size = '72px';
  const bases = ['monospace', 'sans-serif', 'serif'];
  return bases.some((base) => {
    ctx.font = `${size} ${base}`;
    const baseWidth = ctx.measureText(test).width;
    ctx.font = `${size} "${font}", ${base}`;
    const w = ctx.measureText(test).width;
    return Math.abs(w - baseWidth) > 0.5;
  });
}

function detectFonts(): SignalResult {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      id: 'fonts',
      score: 0,
      evidence: 'canvas 不可用',
      confidence: 'low',
      measured: true,
    };
  }
  const sc = FONT_LISTS.FONTS_SC.filter((f) => isFontAvailable(f, ctx));
  const tc = FONT_LISTS.FONTS_TC.filter((f) => isFontAvailable(f, ctx));
  const { score, evidence } = scoreFonts(sc, tc);
  return {
    id: 'fonts',
    score,
    evidence,
    confidence: 'high',
    measured: true,
  };
}

function detectWebgl(): SignalResult {
  const canvas = document.createElement('canvas');
  const gl =
    (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
    (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
  if (!gl) {
    return {
      id: 'webgl',
      score: 0,
      evidence: 'WebGL 不可用',
      confidence: 'low',
      measured: true,
    };
  }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = dbg
    ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '')
    : String(gl.getParameter(gl.VENDOR) || '');
  const renderer = dbg
    ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
    : String(gl.getParameter(gl.RENDERER) || '');
  const { score, evidence, hits } = scoreWebgl(vendor, renderer);
  return {
    id: 'webgl',
    score,
    evidence: hits.length > 0 ? `命中: ${hits.join(', ')} · ${evidence}` : evidence,
    confidence: 'low',
    measured: true,
  };
}

function detectCanvas(): SignalResult {
  // 弱信号：canvas 渲染中文字符的稳定性指纹。命中无法直接对应「中国」，
  // 这里仅作为指纹噪声维度，分数恒为 0（保留信号位但不对总分贡献）。
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { id: 'canvas', score: 0, evidence: 'canvas 不可用', confidence: 'low', measured: true };
  }
  ctx.textBaseline = 'top';
  ctx.font = '14px ui-sans-serif, system-ui';
  ctx.fillText('Claude 安全检测 · 中', 2, 2);
  ctx.strokeStyle = '#d7875f';
  ctx.strokeRect(0, 0, 60, 20);
  const data = ctx.getImageData(0, 0, 60, 20).data;
  // 简易 hash，仅用于 evidence 展示
  let hash = 0;
  for (let i = 0; i < data.length; i += 4) {
    hash = ((hash * 31) + data[i] + data[i + 1] + data[i + 2]) | 0;
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
  return {
    id: 'canvas',
    score: 0,
    evidence: `hash: ${hex}`,
    confidence: 'low',
    measured: true,
  };
}

/** 浏览器端可检测的信号表（其余 3 个在 CLI）。 */
const BROWSER_DETECTORS: Partial<Record<SignalId, () => SignalResult>> = {
  timezone: detectTimezone,
  language: detectLanguage,
  fonts: detectFonts,
  webgl: detectWebgl,
  emoji: detectEmoji,
  canvas: detectCanvas,
};

// --- 扫描主流程 ---

function resetUI() {
  setRing(0, '');
  const gauge = q('#score-gauge');
  gauge?.setAttribute('data-scanning', 'true');
  gauge?.removeAttribute('data-band');

  // 隐藏结论横幅，清空卡片边框颜色
  const banner = q('#verdict-banner');
  if (banner) {
    banner.hidden = true;
    banner.removeAttribute('data-band');
  }
  const card = q('#score-card');
  card?.removeAttribute('data-band');

  const title = q('#result-title');
  if (title) {
    title.textContent = '正在分析…';
    title.className = 'empty';
  }
  const hits = q('#result-hits');
  if (hits) hits.innerHTML = '';

  updateRadar({}, '');

  for (const meta of SIGNAL_META) {
    const row = q(`[data-signal="${meta.id}"]`);
    if (!row) continue;
    row.classList.remove('is-active', 'is-done');
    row.classList.add('is-pending');
    row.removeAttribute('data-verdict');
    const val = q('[data-field="value"]', row);
    const contrib = q('[data-field="contribution"]', row);
    if (val) val.textContent = '';
    if (contrib) contrib.textContent = '';
    row.querySelectorAll('.dot').forEach((d) => (d.className = 'dot'));
  }

  // 配置对比高亮重置
  document
    .querySelectorAll<HTMLElement>('#compare-danger li, #compare-safe li')
    .forEach((li) => (li.style.opacity = '0.4'));
}

const BAND_TEXT: Record<string, { title: string; desc: string }> = {
  low: {
    title: '低风险',
    desc: '你的环境看起来不像典型的中国用户。Claude Code 不太可能基于这些信号把你标记。',
  },
  medium: {
    title: '中风险',
    desc: '检测到部分中国环境特征。建议调整时区与浏览器语言。',
  },
  high: {
    title: '高风险',
    desc: '多项信号强烈指向中国环境。Claude Code 极有可能将你标记为中国用户。',
  },
};

const BAND_ICON: Record<string, string> = {
  low: '✓',
  medium: '▲',
  high: '✕',
};

function setVerdict(band: string | null) {
  const banner = q<HTMLElement>('#verdict-banner');
  const icon = q('#verdict-icon');
  const badge = q('#risk-badge');
  const desc = q('#risk-desc');
  const card = q('#score-card');

  if (!band) {
    if (banner) banner.hidden = true;
    if (banner) banner.removeAttribute('data-band');
    if (card) card.removeAttribute('data-band');
    return;
  }

  const info = BAND_TEXT[band];
  if (banner) {
    banner.hidden = false;
    banner.setAttribute('data-band', band);
  }
  if (card) card.setAttribute('data-band', band);
  if (icon) icon.textContent = BAND_ICON[band] || '';
  if (badge) badge.textContent = info.title;
  if (desc) desc.textContent = info.desc;
}

function finalize(result: ReturnType<typeof score>) {
  setVerdict(result.band);

  // 命中证据
  const hitsBox = q('#result-hits');
  const titleEl = q('#result-title');
  if (hitsBox) hitsBox.innerHTML = '';

  if (result.hits.length === 0) {
    if (titleEl) {
      titleEl.textContent = '没有信号命中——你的环境看起来很干净';
      titleEl.className = 'empty';
    }
  } else {
    if (titleEl) {
      titleEl.textContent = `${result.hits.length} 项命中`;
      titleEl.className = '';
    }
    for (const h of result.hits) {
      const meta = SIGNAL_META.find((m) => m.id === h.id);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.setAttribute('data-verdict', h.verdict);
      chip.innerHTML =
        `<span class="contrib">+${h.contribution}</span> ${meta?.name ?? h.id}` +
        (h.evidence ? ` <span style="opacity:0.6">· ${escapeHtml(h.evidence)}</span>` : '');
      hitsBox?.appendChild(chip);
    }
  }

  // 雷达图最终更新
  const scores: Partial<Record<SignalId, number>> = {};
  for (const r of result.results) {
    if (r.measured) scores[r.id] = r.score;
  }
  updateRadar(scores, result.band);

  // 配置对比高亮命中项
  for (const h of result.hits) {
    document
      .querySelectorAll<HTMLElement>(`#compare-danger li[data-signal="${h.id}"]`)
      .forEach((li) => (li.style.opacity = '1'));
    document
      .querySelectorAll<HTMLElement>(`#compare-safe li[data-signal="${h.id}"]`)
      .forEach((li) => (li.style.opacity = '1'));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

let running = false;

async function run() {
  if (running) return;
  running = true;
  const btn = q<HTMLButtonElement>('#retest');
  if (btn) btn.disabled = true;

  resetUI();
  await delay(SETTLE_MS);

  const collected: Partial<Record<SignalId, SignalResult>> = {};

  for (const meta of SIGNAL_META) {
    const row = q(`[data-signal="${meta.id}"]`);
    row?.classList.remove('is-pending');
    row?.classList.add('is-active');
    await delay(SCAN_STEP_MS);

    const detector = BROWSER_DETECTORS[meta.id];
    let outcome: SignalResult;
    if (detector) {
      try {
        outcome = detector();
      } catch {
        outcome = {
          id: meta.id,
          score: 0,
          evidence: '检测失败',
          confidence: 'low',
          measured: true,
        };
      }
    } else {
      outcome = {
        id: meta.id,
        score: 0,
        evidence: '仅 CLI 可测',
        confidence: 'low',
        measured: false,
      };
    }
    collected[meta.id] = outcome;

    if (row) {
      const val = q('[data-field="value"]', row);
      const contrib = q('[data-field="contribution"]', row);
      const verdict = outcome.score >= 0.6 ? 'high' : outcome.score >= 0.25 ? 'medium' : 'low';
      if (val) val.textContent = outcome.evidence;
      if (contrib) {
        const c = Math.round(outcome.score * meta_weight(meta.id));
        contrib.textContent = outcome.measured ? `+${c}` : '—';
      }
      row.setAttribute('data-verdict', verdict);
      row.classList.remove('is-active');
      row.classList.add('is-done');
    }

    // 实时更新分数环（部分打分，已知信号）
    const partial = score(collected);
    setRing(partial.total, partial.band);

    // 实时雷达图
    const liveScores: Partial<Record<SignalId, number>> = {};
    for (const [id, r] of Object.entries(collected)) {
      liveScores[id as SignalId] = r!.score;
    }
    updateRadar(liveScores, partial.band);

    await delay(SETTLE_MS);
  }

  const result = score(collected);
  setRing(result.total, result.band);
  finalize(result);

  const label = q('#retest-label');
  if (label) label.textContent = '重新扫描';
  if (btn) btn.disabled = false;
  running = false;
}

function meta_weight(id: SignalId): number {
  // 信号权重（与 DEFAULT_WEIGHTS 一致，这里同步用于 UI 显示）
  const w: Record<SignalId, number> = {
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
  return w[id];
}

// --- API 命令复制 ---
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function initApiCopy() {
  const btn = q<HTMLButtonElement>('#api-copy');
  const label = q('#api-copy-label');
  if (!btn) return;
  const idle = label?.textContent ?? '复制';
  btn.addEventListener('click', async () => {
    const text = (btn.dataset.copy || '').trim();
    if (text && (await copyText(text))) {
      btn.classList.add('is-copied');
      if (label) label.textContent = '已复制';
      setTimeout(() => {
        btn.classList.remove('is-copied');
        if (label) label.textContent = idle;
      }, 1600);
    }
  });
}

function init() {
  q<HTMLButtonElement>('#retest')?.addEventListener('click', () => {
    void run();
  });
  initApiCopy();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
