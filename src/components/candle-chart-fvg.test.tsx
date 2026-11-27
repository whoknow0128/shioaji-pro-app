import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { created, kbars } from './chart-session.test-harness';

vi.hoisted(() => {
    const store = new Map<string, string>();
    const ls = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        key: () => null,
        length: 0,
    };
    (globalThis as any).localStorage = ls;
    (globalThis as any).window = Object.assign(globalThis, {
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        location: { search: '', href: 'http://x/' },
    });
    (globalThis as any).document = {
        addEventListener() {},
        removeEventListener() {},
        createElement: () => ({ style: {}, getContext: () => null }),
        body: {},
    };
});
vi.mock('../lib/trade', () => ({ notify: () => {}, placeQuickOrder: async () => {} }));
vi.mock('../lib/shioaji', () => ({ cancelOrder: async () => {}, updateOrderPrice: async () => {} }));
vi.mock('lightweight-charts', async () => (await import('./chart-session.test-harness')).lwMock());
vi.mock('../hooks/use-stream', () => ({ useQuote: () => undefined }));

const fetchMock = vi.fn();
vi.mock('../lib/chart-history', () => ({
    fetchChartHistory: (...a: unknown[]) => fetchMock(...a),
    nextChartHistoryRevision: () => Math.random(),
}));

import { CandleChart } from './candle-chart';
import { newInstance, saveInstances } from '../lib/indicator-defs';

const stk = { code: '2330', security_type: 'STK', exchange: 'TSE', target_code: null } as any;

const flush = async () => {
    for (let i = 0; i < 6; i++) await act(async () => {});
};

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
    if (renderer) {
        act(() => renderer!.unmount());
        renderer = null;
    }
    created.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (cb: any) => setTimeout(cb, 0));
    vi.stubGlobal('cancelAnimationFrame', (id: any) => clearTimeout(id));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T10:00:00+08:00'));
    localStorage.removeItem('sj-pro-indicators-v2');
    localStorage.removeItem('sj-pro-chart-interval:2330');
});

describe('CandleChart FVG & Gap indicator', () => {
    it('populates anchor LineSeries with every bar so priceToCoordinate never returns null offscreen', async () => {
        saveInstances([newInstance('fvg')]);
        // Two segments separated by a clear upward gap (100 -> 110)
        fetchMock.mockResolvedValue(
            kbars([
                ['2026-09-25T09:01:00', '2026-09-25T09:03:00', () => 100],
                ['2026-09-25T09:04:00', '2026-09-25T09:06:00', () => 110],
            ]),
        );

        act(() => {
            renderer = create(createElement(CandleChart, { contract: stk, interval: '1m' }), {
                createNodeMock: () => ({
                    clientWidth: 800,
                    clientHeight: 400,
                    getBoundingClientRect: () => ({ width: 800, height: 400, left: 0, top: 0 }),
                    addEventListener() {},
                    removeEventListener() {},
                    style: {},
                }),
            });
        });
        await flush();

        const candleSeries = created.find((s) => s.kind === 'Candlestick')!;
        expect(candleSeries.last.length).toBeGreaterThan(0);
        // Candlestick + Volume + 4 FVG anchor LineSeries
        const anchors = created.filter((s) => s.kind === 'Line');
        expect(anchors).toHaveLength(4);
        // Every anchor must receive all bars (not just bars[0])
        for (const a of anchors) {
            expect(a.last).toHaveLength(candleSeries.last.length);
        }
        // Legend shows FVG label and the active gap count ('1')
        const text = JSON.stringify(renderer!.toJSON());
        expect(text).toContain('FVG');
        expect(text).toContain('"1"');
    });
});
