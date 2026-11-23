import { CLOSE_GRACE } from './intraday-session';
import type { Candle } from './types/market';

export const OPENING_VOL_TIMEFRAMES = [15, 30, 60, 1440] as const;
export type OpeningVolTimeframe = (typeof OPENING_VOL_TIMEFRAMES)[number];
export type OpeningVolBaselineKind = 'p50' | 'p90';

const H = 3600;
const DAY = 86400;

export function normalizeOpeningBaseline(v: unknown): OpeningVolBaselineKind {
    return v === 'p90' ? 'p90' : 'p50';
}

export interface OpeningBarWindow {
    dayStartSec: number;
    /** 09:00:00 (Taiwan wall-clock encoded as UTC seconds) */
    startSec: number;
    /** 1m bar-label end of the target window (inclusive) */
    barEndSec: number;
    /** Earliest wall-clock second at which the condition is allowed to trigger */
    checkStartSec: number;
}

export function normalizeOpeningTimeframe(tf: unknown): OpeningVolTimeframe {
    const n = Number(tf);
    if (n === 30 || n === 60 || n === 1440) return n;
    return 15;
}

export function twDayStartSec(wallClockSec: number): number {
    return Math.floor(wallClockSec / DAY) * DAY;
}

/**
 * Stock (09:00 open) opening-bar window & close-check time for a given Taiwan
 * trading day (`dayStartSec = 00:00:00` UTC-encoded wall clock).
 *
 * - 15m: bars 09:01..09:15, checked from 09:15:00
 * - 30m: bars 09:01..09:30, checked from 09:30:00
 * - 60m: bars 09:01..10:00, checked from 10:00:00
 * - 1440 (日收盤): bars 09:01..13:34 (incl. closing cross), checked from 13:05:00
 */
export function openingBarWindow(dayStartSec: number, timeframe: number): OpeningBarWindow {
    const startSec = dayStartSec + 9 * H;
    if (timeframe >= 1440) {
        return {
            dayStartSec,
            startSec,
            barEndSec: dayStartSec + 13.5 * H + CLOSE_GRACE,
            checkStartSec: dayStartSec + 13 * H + 5 * 60,
        };
    }
    const barEndSec = startSec + timeframe * 60;
    return {
        dayStartSec,
        startSec,
        barEndSec,
        checkStartSec: barEndSec,
    };
}

/**
 * Extract past trading days' opening-bar volumes (excluding `todayDayStartSec`
 * and days with 0 total volume), ordered chronologically, capped to the most
 * recent `lookbackDays` valid trading days.
 */
export function extractPastOpeningVolumes(
    candles: readonly Candle[],
    todayDayStartSec: number,
    timeframe: number,
    lookbackDays: number,
): number[] {
    const perDay = new Map<number, number>();
    for (const c of candles) {
        if (c.time >= todayDayStartSec) continue;
        const d0 = twDayStartSec(c.time);
        const win = openingBarWindow(d0, timeframe);
        if (c.time >= win.startSec && c.time <= win.barEndSec) {
            perDay.set(d0, (perDay.get(d0) ?? 0) + c.volume);
        }
    }
    const days = Array.from(perDay.entries())
        .filter(([, vol]) => vol > 0)
        .sort((a, b) => a[0] - b[0]);
    const limit = Math.max(1, Math.floor(lookbackDays));
    return days.slice(-limit).map(([, vol]) => vol);
}

export function computeMedian(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid]!;
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computePercentile(values: readonly number[], percentile: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
    );
    return sorted[idx]!;
}

export function computeOpeningBaselineValue(
    values: readonly number[],
    kind: OpeningVolBaselineKind,
): number | null {
    return kind === 'p90' ? computePercentile(values, 90) : computeMedian(values);
}

export interface TodayOpeningBaseline {
    histVolume: number;
    /** Highest 1m bar label seen in today's historical kbars (0 if none) */
    coveredLabel: number;
}

export function computeTodayOpeningBaseline(
    candles: readonly Candle[],
    todayDayStartSec: number,
    timeframe: number,
): TodayOpeningBaseline {
    const win = openingBarWindow(todayDayStartSec, timeframe);
    let histVolume = 0;
    let coveredLabel = 0;
    for (const c of candles) {
        if (c.time < todayDayStartSec) continue;
        if (c.time >= win.startSec && c.time <= win.barEndSec) {
            histVolume += c.volume;
            if (c.time > coveredLabel) coveredLabel = c.time;
        }
    }
    return { histVolume, coveredLabel };
}

export interface OpeningVolumeEval {
    readyToCheck: boolean;
    met: boolean;
    todayVolume: number;
    baselineKind: OpeningVolBaselineKind;
    baselineVolume: number | null;
    medianVolume: number | null;
    ratio: number | null;
    sampleCount: number;
    exceededPct: number | null;
}

export function evaluateOpeningVolumeSpike(params: {
    nowWallSec: number;
    todayDayStartSec: number;
    timeframe: number;
    multiplier: number;
    pastVolumes: readonly number[];
    todayVolume: number;
    baselineKind?: OpeningVolBaselineKind;
}): OpeningVolumeEval {
    const {
        nowWallSec,
        todayDayStartSec,
        timeframe,
        multiplier,
        pastVolumes,
        todayVolume,
        baselineKind = 'p50',
    } = params;
    const win = openingBarWindow(todayDayStartSec, timeframe);
    const medianVolume = computeMedian(pastVolumes);
    const baselineVolume = computeOpeningBaselineValue(pastVolumes, baselineKind);
    const sampleCount = pastVolumes.length;

    if (nowWallSec < win.checkStartSec || baselineVolume === null || baselineVolume <= 0 || todayVolume <= 0) {
        return {
            readyToCheck: nowWallSec >= win.checkStartSec,
            met: false,
            todayVolume,
            baselineKind,
            baselineVolume,
            medianVolume,
            ratio: baselineVolume && baselineVolume > 0 ? todayVolume / baselineVolume : null,
            sampleCount,
            exceededPct: null,
        };
    }

    const ratio = todayVolume / baselineVolume;
    const beatCount = pastVolumes.filter(v => todayVolume >= v).length;
    const exceededPct = Math.round((beatCount / sampleCount) * 100);
    return {
        readyToCheck: true,
        met: ratio >= multiplier,
        todayVolume,
        baselineKind,
        baselineVolume,
        medianVolume,
        ratio,
        sampleCount,
        exceededPct,
    };
}
