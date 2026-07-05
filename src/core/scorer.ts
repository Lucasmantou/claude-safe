/**
 * 打分纯函数：接收各信号检测结果，输出总分、分档、命中列表。
 *
 * 三端共用：浏览器 detect.ts、服务端 api/check.ts、CLI cli/index.ts。
 */

import { DEFAULT_WEIGHTS, type SignalId } from './defaults';
import {
  signalVerdict,
  riskBand,
  type RiskBand,
  type SignalResult,
} from './signals';

export interface EnrichedResult extends SignalResult {
  verdict: RiskBand;
  weight: number;
  contribution: number;
}

export interface ScoreResult {
  total: number;
  band: RiskBand;
  measuredWeight: number;
  totalWeight: number;
  results: EnrichedResult[];
  hits: EnrichedResult[];
}

/** 把 9 个信号检测结果合并为最终报告。 */
export function score(
  results: Partial<Record<SignalId, SignalResult>>,
  weights?: Partial<Record<SignalId, number>>,
): ScoreResult {
  const w: Record<SignalId, number> = { ...DEFAULT_WEIGHTS, ...(weights || {}) };

  const enriched: EnrichedResult[] = (
    Object.keys(w) as SignalId[]
  ).map((id) => {
    const weight = w[id];
    const r = results[id];
    if (!r) {
      return {
        id,
        score: 0,
        evidence: '',
        confidence: 'low',
        measured: false,
        verdict: 'low',
        weight,
        contribution: 0,
      };
    }
    const contribution = Math.round(r.score * weight);
    return {
      ...r,
      verdict: signalVerdict(r.score),
      weight,
      contribution,
    };
  });

  const measuredWeight = enriched
    .filter((r) => r.measured)
    .reduce((sum, r) => sum + r.weight, 0);
  const totalWeight = enriched.reduce((sum, r) => sum + r.weight, 0);

  // 直接累加贡献，上限 100
  const rawTotal = enriched.reduce((sum, r) => sum + r.contribution, 0);
  const total = Math.min(100, rawTotal);

  const hits = enriched.filter((r) => r.measured && r.verdict !== 'low');

  return {
    total,
    band: riskBand(total),
    measuredWeight,
    totalWeight,
    results: enriched,
    hits,
  };
}

/** 从 URL 参数 `?w=tz:24,lang:20` 解析权重覆盖。 */
export function parseWeightOverrides(query: string | null | undefined): Partial<Record<SignalId, number>> {
  if (!query) return {};
  const out: Partial<Record<SignalId, number>> = {};
  for (const pair of query.split(',')) {
    const [key, value] = pair.split(':');
    if (!key || !value) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      out[key.trim() as SignalId] = num;
    }
  }
  return out;
}
