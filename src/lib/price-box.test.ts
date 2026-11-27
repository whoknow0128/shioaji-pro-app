import { describe, expect, it } from 'vitest';
import {
    BOX_ACTIVE_BORDER_OPACITY,
    BOX_ACTIVE_FILL_OPACITY,
    BOX_MITIGATED_BORDER_OPACITY,
    BOX_MITIGATED_COLOR,
    BOX_MITIGATED_FILL_OPACITY,
    boxColors,
    PriceBoxPrimitive,
    type PriceBoxItem,
} from './price-box';

interface Calls {
    fills: { x: number; y: number; w: number; h: number; style: unknown }[];
    rects: { x: number; y: number; w: number; h: number; style: unknown; dash: unknown }[];
}

function fakeTarget(w = 800, h = 400, hr = 1, vr = 1) {
    const calls: Calls = { fills: [], rects: [] };
    let fillStyle: unknown;
    let strokeStyle: unknown;
    let dash: unknown = [];
    const ctx = {
        set fillStyle(v: unknown) { fillStyle = v; },
        set strokeStyle(v: unknown) { strokeStyle = v; },
        set lineWidth(_: unknown) {},
        setLineDash: (d: unknown) => { dash = d; },
        fillRect: (x: number, y: number, rw: number, rh: number) => {
            calls.fills.push({ x, y, w: rw, h: rh, style: fillStyle });
        },
        beginPath: () => {},
        rect: (x: number, y: number, rw: number, rh: number) => {
            calls.rects.push({ x, y, w: rw, h: rh, style: strokeStyle, dash });
        },
        stroke: () => {},
    };
    const target = {
        useBitmapCoordinateSpace: (fn: (scope: unknown) => void) =>
            fn({
                context: ctx,
                horizontalPixelRatio: hr,
                verticalPixelRatio: vr,
                bitmapSize: { width: w * hr, height: h * vr },
                mediaSize: { width: w, height: h },
            }),
    };
    return { target, calls };
}

function fakeAttach(prim: PriceBoxPrimitive, origin = 100, barSpacing = 10) {
    const chart = {
        timeScale: () => ({
            logicalToCoordinate: (l: number) => origin + l * barSpacing,
            timeToCoordinate: () => null,
        }),
    };
    const series = {
        priceToCoordinate: (p: number) => 300 - (p - 100),
    };
    prim.attached({ chart, series, requestUpdate: () => {} } as never);
}

describe('PriceBoxPrimitive', () => {
    it('renders in bottom zOrder below candles', () => {
        const prim = new PriceBoxPrimitive({
            boxes: [],
            ...boxColors('#1fd286', 100),
            borderWidth: 1,
        });
        expect(prim.paneViews()[0]!.zOrder!()).toBe('bottom');
    });

    it('draws mitigated boxes before active boxes with distinct fill/dash and clips offscreen starts', () => {
        const boxes: PriceBoxItem[] = [
            { startIndex: -50, endIndex: 10, top: 120, bottom: 110, mitigated: false },
            { startIndex: 2, endIndex: 6, top: 108, bottom: 104, mitigated: true },
            { startIndex: -30, endIndex: -20, top: 105, bottom: 102, mitigated: true }, // totally offscreen left
        ];
        const colors = boxColors('#1fd286', 100);
        const prim = new PriceBoxPrimitive({
            boxes,
            ...colors,
            borderWidth: 1,
        });
        fakeAttach(prim, 100, 10);
        const t = fakeTarget(800, 400);
        prim.paneViews()[0]!.renderer()!.draw(t.target as never);

        // Offscreen box skipped -> only 2 boxes drawn
        expect(t.calls.fills).toHaveLength(2);
        // Mitigated drawn first (dashed), active drawn second (solid)
        expect(t.calls.fills[0]!.style).toBe(colors.mitigatedFill);
        expect(t.calls.rects[0]!.dash).toEqual([4, 3]);
        expect(t.calls.fills[1]!.style).toBe(colors.activeFill);
        expect(t.calls.rects[1]!.dash).toEqual([]);
        // Offscreen start (-400) clamped to -1 (borderWidth)
        expect(t.calls.fills[1]!.x).toBe(-1);
    });

    it('computes expected active and faded-orange mitigated opacities', () => {
        expect(BOX_MITIGATED_COLOR).toBe('#f09436');
        const c = boxColors('#ff0000', 100);
        expect(c.activeFill).toBe(`rgba(255, 0, 0, ${(BOX_ACTIVE_FILL_OPACITY / 100).toFixed(2)})`);
        expect(c.activeBorder).toBe(`rgba(255, 0, 0, ${(BOX_ACTIVE_BORDER_OPACITY / 100).toFixed(2)})`);
        expect(c.mitigatedFill).toBe(`rgba(240, 148, 54, ${(BOX_MITIGATED_FILL_OPACITY / 100).toFixed(2)})`);
        expect(c.mitigatedBorder).toBe(`rgba(240, 148, 54, ${(BOX_MITIGATED_BORDER_OPACITY / 100).toFixed(2)})`);
    });
});
