import { describe, expect, it } from 'vitest';
import { computeFvgGaps } from './fvg-gap';
import { DEF_BY_TYPE } from './indicator-defs';
import type { Candle } from './types/market';

const T0 = 1_700_000_000;
function bar(i: number, low: number, high: number, close = (low + high) / 2): Candle {
    return {
        time: T0 + i * 300,
        open: (low + high) / 2,
        high,
        low,
        close,
        volume: 100,
    };
}

describe('computeFvgGaps', () => {
    it('detects bullish and bearish 3-bar FVGs without size filter', () => {
        const bars: Candle[] = [
            bar(0, 98, 100),   // b0.high = 100
            bar(1, 99, 105),   // overlaps b0, no gap
            bar(2, 102, 106),  // b2.low = 102 > 100 -> bullFvg [100, 102]
            bar(3, 101, 105),  // partial touch into [100, 102] (101 > 100, not fully mitigated)
            bar(4, 96, 102),   // low 96 <= 100 -> mitigates bullFvg at bar 4! Also b4.high=102 >= b2.low? no, wait:
            bar(5, 90, 95),    // b5.high = 95 < b3.low(101) -> bearFvg [95, 101], plus b5.high=95 < b4.low(96) -> bearGap [95, 96]
        ];
        const res = computeFvgGaps(bars);
        expect(res.bullFvg).toHaveLength(1);
        expect(res.bullFvg[0]).toMatchObject({
            kind: 'fvg',
            dir: 'bull',
            bottom: 100,
            top: 102,
            startIndex: 0,
            formedIndex: 2,
            mitigated: true,
            endIndex: 4,
        });

        expect(res.bearGap).toHaveLength(1);
        expect(res.bearGap[0]).toMatchObject({
            kind: 'gap',
            dir: 'bear',
            bottom: 95,
            top: 96,
            startIndex: 4,
            formedIndex: 5,
            mitigated: false,
            endIndex: 5,
        });

        expect(res.bearFvg).toHaveLength(1);
        expect(res.bearFvg[0]).toMatchObject({
            kind: 'fvg',
            dir: 'bear',
            bottom: 95,
            top: 101,
            startIndex: 3,
            formedIndex: 5,
            mitigated: false,
        });
    });

    it('detects 2-bar opening gaps and avoids duplicate FVG with identical bounds', () => {
        const bars: Candle[] = [
            bar(0, 95, 100),
            bar(1, 103, 106), // bullGap [100, 103]
            bar(2, 103, 108), // b2.low === 103 -> would give identical [100, 103] FVG
        ];
        const both = computeFvgGaps(bars, { mode: 0 });
        expect(both.bullGap).toHaveLength(1);
        expect(both.bullFvg).toHaveLength(0);

        // In FVG-only mode, the 3-bar FVG is kept
        const fvgOnly = computeFvgGaps(bars, { mode: 1 });
        expect(fvgOnly.bullGap).toHaveLength(0);
        expect(fvgOnly.bullFvg).toHaveLength(1);

        const gapOnly = computeFvgGaps(bars, { mode: 2 });
        expect(gapOnly.bullGap).toHaveLength(1);
        expect(gapOnly.bullFvg).toHaveLength(0);
    });

    it('supports touch-mitigation vs full-mitigation and showHistory toggle', () => {
        const bars: Candle[] = [
            bar(0, 98, 100),
            bar(1, 99, 105),
            bar(2, 102, 106), // bullFvg [100, 102]
            bar(3, 101, 106), // touches top (101 <= 102) without breaking bottom (100)
        ];
        const full = computeFvgGaps(bars, { mitigateMode: 0 });
        expect(full.bullFvg[0]!.mitigated).toBe(false);

        const touch = computeFvgGaps(bars, { mitigateMode: 1, showHistory: true });
        expect(touch.bullFvg[0]!.mitigated).toBe(true);
        expect(touch.bullFvg[0]!.endIndex).toBe(3);

        const hideHist = computeFvgGaps(bars, { mitigateMode: 1, showHistory: false });
        expect(hideHist.bullFvg).toHaveLength(0);
    });

    it('defaults to maxZones=20, prioritizing active zones then newest historical mitigated zones', () => {
        const bars: Candle[] = [];
        // Create 25 mitigated bull gaps (followed by a drop below the gap)
        let price = 100;
        let idx = 0;
        for (let g = 0; g < 25; g++) {
            bars.push(bar(idx++, price, price + 2));
            bars.push(bar(idx++, price + 4, price + 6)); // bullGap [price+2, price+4]
            bars.push(bar(idx++, price, price + 5));     // mitigates gap
            price += 1;
        }
        // 3 unmitigated bull gaps moving higher (price += 6 overlaps prev high price+7)
        for (let g = 0; g < 3; g++) {
            bars.push(bar(idx++, price, price + 2));
            bars.push(bar(idx++, price + 5, price + 7)); // bullGap [price+2, price+5]
            price += 6;
        }
        const res = computeFvgGaps(bars, { mode: 2 });
        expect(res.bullGap).toHaveLength(20);
        const active = res.bullGap.filter((z) => !z.mitigated);
        const mitigated = res.bullGap.filter((z) => z.mitigated);
        expect(active).toHaveLength(3);
        expect(mitigated).toHaveLength(17);
        // Should keep the newest 17 mitigated gaps (not the oldest ones)
        expect(mitigated[0]!.formedIndex).toBeGreaterThan(mitigated[16]!.formedIndex);
    });

    it('registers fvg indicator definition with expected defaults', () => {
        const def = DEF_BY_TYPE.get('fvg');
        expect(def).toBeDefined();
        expect(def?.category).toBe('overlay');
        expect(def?.params.find((p) => p.key === 'maxZones')?.def).toBe(20);
        expect(def?.params.find((p) => p.key === 'showHistory')?.def).toBe(1);
    });
});
