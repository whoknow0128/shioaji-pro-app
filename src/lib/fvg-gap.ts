// src/lib/fvg-gap.ts — FVG (Fair Value Gap) 與跳空缺口偵測及回補追蹤。
// 合併三棒失衡區 (FVG) 與相鄰兩棒跳空缺口 (Gap)，依參數追蹤是否已回補，
// 並保留歷史已回補缺口（截斷至回補 K 棒）以供主圖繪製。

import type { Candle } from './types/market';

export type ZoneOutputKey = 'bullFvg' | 'bearFvg' | 'bullGap' | 'bearGap';

export interface PriceZone {
    kind: 'fvg' | 'gap';
    dir: 'bull' | 'bear';
    outputKey: ZoneOutputKey;
    startIndex: number;
    endIndex: number;
    formedIndex: number;
    startTime: number;
    endTime: number;
    top: number;
    bottom: number;
    mitigated: boolean;
}

export interface FvgGapOptions {
    /** 0 = FVG + 跳空缺口, 1 = 僅 FVG, 2 = 僅跳空缺口 */
    mode?: number;
    /** 最多顯示幾個區域（預設 20；優先保留未回補，再補最新已回補） */
    maxZones?: number;
    /** true = 保留已回補的歷史缺口；false = 僅顯示未回補 */
    showHistory?: boolean;
    /** 0 = 完全回補（穿透缺口另一側），1 = 觸及邊緣即算回補 */
    mitigateMode?: number;
}

const EPS = 1e-9;

function isValidBar(b: Candle): boolean {
    return (
        Number.isFinite(b.time) &&
        Number.isFinite(b.high) &&
        Number.isFinite(b.low)
    );
}

/**
 * 從 K 棒序列偵測 FVG 與跳空缺口，並計算每個區域的回補狀態與起迄區間。
 * 不套用尺寸濾網；數量上限預設 20，優先保留仍有效的未回補缺口，
 * 剩餘名額填入最新產生的歷史已回補缺口。
 */
export function computeFvgGaps(
    bars: readonly Candle[],
    opts: FvgGapOptions = {},
): Record<ZoneOutputKey, PriceZone[]> {
    const empty: Record<ZoneOutputKey, PriceZone[]> = {
        bullFvg: [],
        bearFvg: [],
        bullGap: [],
        bearGap: [],
    };
    const n = bars.length;
    if (n < 2) return empty;

    const mode = opts.mode ?? 0;
    const includeFvg = mode !== 2;
    const includeGap = mode !== 1;
    const maxZones = Math.max(1, Math.floor(opts.maxZones ?? 20));
    const showHistory = opts.showHistory ?? true;
    const touchMitigate = opts.mitigateMode === 1;

    const rawZones: PriceZone[] = [];
    // 記錄每個 bar index 形成的 2-bar 跳空，用來在 mode=0 時避免重複畫出
    // 與 2-bar 跳空範圍完全重疊的 3-bar FVG
    const gapAtBar = new Map<number, { dir: 'bull' | 'bear'; top: number; bottom: number }>();

    if (includeGap) {
        for (let i = 1; i < n; i++) {
            const prev = bars[i - 1]!;
            const curr = bars[i]!;
            if (!isValidBar(prev) || !isValidBar(curr)) continue;

            if (curr.low > prev.high) {
                gapAtBar.set(i, { dir: 'bull', top: curr.low, bottom: prev.high });
                rawZones.push({
                    kind: 'gap',
                    dir: 'bull',
                    outputKey: 'bullGap',
                    startIndex: i - 1,
                    endIndex: n - 1,
                    formedIndex: i,
                    startTime: prev.time,
                    endTime: bars[n - 1]!.time,
                    top: curr.low,
                    bottom: prev.high,
                    mitigated: false,
                });
            } else if (curr.high < prev.low) {
                gapAtBar.set(i, { dir: 'bear', top: prev.low, bottom: curr.high });
                rawZones.push({
                    kind: 'gap',
                    dir: 'bear',
                    outputKey: 'bearGap',
                    startIndex: i - 1,
                    endIndex: n - 1,
                    formedIndex: i,
                    startTime: prev.time,
                    endTime: bars[n - 1]!.time,
                    top: prev.low,
                    bottom: curr.high,
                    mitigated: false,
                });
            }
        }
    }

    if (includeFvg && n >= 3) {
        for (let i = 2; i < n; i++) {
            const b0 = bars[i - 2]!;
            const b1 = bars[i - 1]!;
            const b2 = bars[i]!;
            if (!isValidBar(b0) || !isValidBar(b1) || !isValidBar(b2)) continue;

            if (b2.low > b0.high) {
                const top = b2.low;
                const bottom = b0.high;
                const dupGap = gapAtBar.get(i - 1) ?? gapAtBar.get(i);
                if (
                    dupGap &&
                    dupGap.dir === 'bull' &&
                    Math.abs(dupGap.top - top) <= EPS &&
                    Math.abs(dupGap.bottom - bottom) <= EPS
                ) {
                    continue;
                }
                rawZones.push({
                    kind: 'fvg',
                    dir: 'bull',
                    outputKey: 'bullFvg',
                    startIndex: i - 2,
                    endIndex: n - 1,
                    formedIndex: i,
                    startTime: b0.time,
                    endTime: bars[n - 1]!.time,
                    top,
                    bottom,
                    mitigated: false,
                });
            } else if (b2.high < b0.low) {
                const top = b0.low;
                const bottom = b2.high;
                const dupGap = gapAtBar.get(i - 1) ?? gapAtBar.get(i);
                if (
                    dupGap &&
                    dupGap.dir === 'bear' &&
                    Math.abs(dupGap.top - top) <= EPS &&
                    Math.abs(dupGap.bottom - bottom) <= EPS
                ) {
                    continue;
                }
                rawZones.push({
                    kind: 'fvg',
                    dir: 'bear',
                    outputKey: 'bearFvg',
                    startIndex: i - 2,
                    endIndex: n - 1,
                    formedIndex: i,
                    startTime: b0.time,
                    endTime: bars[n - 1]!.time,
                    top,
                    bottom,
                    mitigated: false,
                });
            }
        }
    }

    // 追蹤每個缺口的回補時間
    for (const z of rawZones) {
        for (let k = z.formedIndex + 1; k < n; k++) {
            const bar = bars[k]!;
            if (!isValidBar(bar)) continue;
            const hit =
                z.dir === 'bull'
                    ? touchMitigate
                        ? bar.low <= z.top
                        : bar.low <= z.bottom
                    : touchMitigate
                      ? bar.high >= z.bottom
                      : bar.high >= z.top;
            if (hit) {
                z.mitigated = true;
                z.endIndex = k;
                z.endTime = bar.time;
                break;
            }
        }
    }

    const active = rawZones
        .filter((z) => !z.mitigated)
        .sort((a, b) => b.formedIndex - a.formedIndex);
    const mitigated = showHistory
        ? rawZones
              .filter((z) => z.mitigated)
              .sort((a, b) => b.formedIndex - a.formedIndex)
        : [];

    const selected = active.slice(0, maxZones);
    if (selected.length < maxZones && mitigated.length > 0) {
        selected.push(...mitigated.slice(0, maxZones - selected.length));
    }

    for (const z of selected) {
        empty[z.outputKey].push(z);
    }
    return empty;
}
