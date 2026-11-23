import { describe, expect, it } from 'vitest';
import {
    computeMedian,
    computePercentile,
    computeTodayOpeningBaseline,
    evaluateOpeningVolumeSpike,
    extractPastOpeningVolumes,
    openingBarWindow,
    twDayStartSec,
} from './opening-volume';
import { wallClockToUtc } from './utils/kbars';
import type { Candle } from './types/market';

function makeBar(dt: string, volume: number): Candle {
    return {
        time: wallClockToUtc(dt),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume,
    };
}

describe('opening-volume strategy helpers', () => {
    it('computes stock opening windows and check times for 15m, 30m, 60m and daily close', () => {
        const day0 = twDayStartSec(wallClockToUtc('2026-11-24 09:00:00'));

        const w15 = openingBarWindow(day0, 15);
        expect(w15.startSec).toBe(wallClockToUtc('2026-11-24 09:00:00'));
        expect(w15.barEndSec).toBe(wallClockToUtc('2026-11-24 09:15:00'));
        expect(w15.checkStartSec).toBe(wallClockToUtc('2026-11-24 09:15:00'));

        const w30 = openingBarWindow(day0, 30);
        expect(w30.barEndSec).toBe(wallClockToUtc('2026-11-24 09:30:00'));
        expect(w30.checkStartSec).toBe(wallClockToUtc('2026-11-24 09:30:00'));

        const w60 = openingBarWindow(day0, 60);
        expect(w60.barEndSec).toBe(wallClockToUtc('2026-11-24 10:00:00'));
        expect(w60.checkStartSec).toBe(wallClockToUtc('2026-11-24 10:00:00'));

        const wDaily = openingBarWindow(day0, 1440);
        expect(wDaily.barEndSec).toBe(wallClockToUtc('2026-11-24 13:34:00'));
        expect(wDaily.checkStartSec).toBe(wallClockToUtc('2026-11-24 13:05:00'));
    });

    it('extracts past opening volumes per trading day, ignoring today and zero-volume days', () => {
        const candles: Candle[] = [
            makeBar('2026-11-18 09:01:00', 100),
            makeBar('2026-11-18 09:15:00', 200),
            makeBar('2026-11-18 09:16:00', 9999), // outside first 15m bar
            makeBar('2026-11-19 09:05:00', 0),    // zero-volume day ignored
            makeBar('2026-11-20 09:02:00', 400),
            makeBar('2026-11-20 09:14:00', 100),
            makeBar('2026-11-23 09:01:00', 600),
            makeBar('2026-11-24 09:05:00', 5000), // today excluded from past baseline
        ];
        const today0 = twDayStartSec(wallClockToUtc('2026-11-24 09:05:00'));

        expect(extractPastOpeningVolumes(candles, today0, 15, 20)).toEqual([300, 500, 600]);
        expect(extractPastOpeningVolumes(candles, today0, 15, 2)).toEqual([500, 600]);
    });

    it('computes median robustly even with extreme outlier days', () => {
        expect(computeMedian([])).toBeNull();
        expect(computeMedian([100, 120, 110, 95, 50000])).toBe(110);
        expect(computeMedian([100, 200, 300, 400])).toBe(250);
    });

    it('waits until bar close (Option B) before evaluating 15m opening bar', () => {
        const today0 = twDayStartSec(wallClockToUtc('2026-11-24 09:00:00'));
        const pastVolumes = [1000, 1100, 900, 1050, 950]; // median = 1000

        const beforeClose = evaluateOpeningVolumeSpike({
            nowWallSec: wallClockToUtc('2026-11-24 09:14:59'),
            todayDayStartSec: today0,
            timeframe: 15,
            multiplier: 2,
            pastVolumes,
            todayVolume: 5000,
        });
        expect(beforeClose.readyToCheck).toBe(false);
        expect(beforeClose.met).toBe(false);

        const atClose = evaluateOpeningVolumeSpike({
            nowWallSec: wallClockToUtc('2026-11-24 09:15:00'),
            todayDayStartSec: today0,
            timeframe: 15,
            multiplier: 2,
            pastVolumes,
            todayVolume: 2500,
        });
        expect(atClose.readyToCheck).toBe(true);
        expect(atClose.met).toBe(true);
        expect(atClose.ratio).toBe(2.5);
        expect(atClose.exceededPct).toBe(100);
    });

    it('checks daily close volume only starting at 13:05', () => {
        const today0 = twDayStartSec(wallClockToUtc('2026-11-24 09:00:00'));
        const pastVolumes = [10000, 12000, 11000]; // median = 11000

        const at1304 = evaluateOpeningVolumeSpike({
            nowWallSec: wallClockToUtc('2026-11-24 13:04:59'),
            todayDayStartSec: today0,
            timeframe: 1440,
            multiplier: 2,
            pastVolumes,
            todayVolume: 25000,
        });
        expect(at1304.readyToCheck).toBe(false);
        expect(at1304.met).toBe(false);

        const at1305 = evaluateOpeningVolumeSpike({
            nowWallSec: wallClockToUtc('2026-11-24 13:05:00'),
            todayDayStartSec: today0,
            timeframe: 1440,
            multiplier: 2,
            pastVolumes,
            todayVolume: 25000,
        });
        expect(at1305.readyToCheck).toBe(true);
        expect(at1305.met).toBe(true);
    });

    it('computes today historical opening baseline and coveredLabel accurately', () => {
        const candles: Candle[] = [
            makeBar('2026-11-23 09:01:00', 500),
            makeBar('2026-11-24 09:01:00', 300),
            makeBar('2026-11-24 09:05:00', 400),
            makeBar('2026-11-24 09:16:00', 999),
        ];
        const today0 = twDayStartSec(wallClockToUtc('2026-11-24 09:16:00'));
        const base = computeTodayOpeningBaseline(candles, today0, 15);
        expect(base.histVolume).toBe(700);
        expect(base.coveredLabel).toBe(wallClockToUtc('2026-11-24 09:05:00'));
    });

    it('computes P90 percentile and filters elevated-regime noise days cleanly', () => {
        // 20-day sample where 90th percentile (index 17, 18th of 20) is 131,000
        const past20 = [
            20000, 22000, 24000, 25000, 26000,
            28000, 30000, 32000, 35000, 38000,
            40000, 45000, 50000, 65000, 82000,
            94000, 98000, 131000, 149379, 165144,
        ];
        expect(computePercentile(past20, 90)).toBe(131000);

        const today0 = twDayStartSec(wallClockToUtc('2026-11-24 10:00:00'));
        const now = wallClockToUtc('2026-11-24 10:00:00');

        const mildHigh = evaluateOpeningVolumeSpike({
            nowWallSec: now,
            todayDayStartSec: today0,
            timeframe: 60,
            multiplier: 1.6,
            pastVolumes: past20,
            todayVolume: 165144,
            baselineKind: 'p90',
        });
        expect(mildHigh.met).toBe(false);

        const genuineSpike = evaluateOpeningVolumeSpike({
            nowWallSec: now,
            todayDayStartSec: today0,
            timeframe: 60,
            multiplier: 1.6,
            pastVolumes: past20,
            todayVolume: 277712,
            baselineKind: 'p90',
        });
        expect(genuineSpike.met).toBe(true);
        expect(genuineSpike.baselineKind).toBe('p90');
        expect(genuineSpike.baselineVolume).toBe(131000);
    });
});
