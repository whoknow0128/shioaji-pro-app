import { describe, expect, it, vi } from 'vitest';
import {
    barCloseCountdown,
    BarCountdownLayer,
    formatCountdown,
} from './chart-countdown';
import { wallClockToUtc } from './utils/kbars';

describe('formatCountdown', () => {
    it('formats sub-hour as MM:SS and >= 1h as HH:MM:SS', () => {
        expect(formatCountdown(0)).toBe('00:00');
        expect(formatCountdown(5)).toBe('00:05');
        expect(formatCountdown(275)).toBe('04:35');
        expect(formatCountdown(3599)).toBe('59:59');
        expect(formatCountdown(3600)).toBe('01:00:00');
        expect(formatCountdown(12605)).toBe('03:30:05');
    });
});

describe('barCloseCountdown', () => {
    it('computes remaining time for active intraday 5m bar', () => {
        const now = wallClockToUtc('2026-11-27T09:06:18');
        const barTime = wallClockToUtc('2026-11-27T09:10:00');
        const res = barCloseCountdown({
            lastBar: { time: barTime, open: 100, close: 102 },
            tfMinutes: 5,
            kind: 'STK',
            now,
        });
        expect(res).toEqual({ remainingSec: 222, text: '03:42' });
    });

    it('advances to next bar within active session when tick has not arrived yet', () => {
        const now = wallClockToUtc('2026-11-27T09:10:03');
        const prevBarTime = wallClockToUtc('2026-11-27T09:10:00');
        const res = barCloseCountdown({
            lastBar: { time: prevBarTime, open: 100, close: 102 },
            tfMinutes: 5,
            kind: 'STK',
            now,
        });
        expect(res).toEqual({ remainingSec: 297, text: '04:57' });
    });

    it('clamps 60m final session bar to exchange close (13:30 for TW stock)', () => {
        const now = wallClockToUtc('2026-11-27T13:10:15');
        const barTime = wallClockToUtc('2026-11-27T14:00:00');
        const res = barCloseCountdown({
            lastBar: { time: barTime, open: 100, close: 101 },
            tfMinutes: 60,
            kind: 'STK',
            now,
            clampSessionEnd: true,
        });
        expect(res).toEqual({ remainingSec: 1185, text: '19:45' });
    });

    it('returns null when market is closed or bar is from a past day', () => {
        const closedNow = wallClockToUtc('2026-11-27T13:35:00');
        expect(
            barCloseCountdown({
                lastBar: { time: wallClockToUtc('2026-11-27T13:30:00'), open: 100, close: 101 },
                tfMinutes: 5,
                kind: 'STK',
                now: closedNow,
            }),
        ).toBeNull();

        const saturdayNow = wallClockToUtc('2026-11-28T10:00:00');
        expect(
            barCloseCountdown({
                lastBar: { time: wallClockToUtc('2026-11-27T13:30:00'), open: 100, close: 101 },
                tfMinutes: 5,
                kind: 'STK',
                now: saturdayNow,
            }),
        ).toBeNull();
    });

    it('computes remaining time to session close on 1D chart during active trading day', () => {
        const now = wallClockToUtc('2026-11-27T10:00:00');
        const dayBar = wallClockToUtc('2026-11-27T00:00:00');
        const res = barCloseCountdown({
            lastBar: { time: dayBar, open: 100, close: 103 },
            tfMinutes: 1440,
            kind: 'STK',
            now,
        });
        expect(res).toEqual({ remainingSec: 3.5 * 3600, text: '03:30:00' });
    });
});

describe('BarCountdownLayer', () => {
    it('exposes priceAxisViews positioned right below last bar close without tick stub', () => {
        let now = wallClockToUtc('2026-11-27T09:06:18');
        const layer = new BarCountdownLayer({
            getLastBar: () => ({
                time: wallClockToUtc('2026-11-27T09:10:00'),
                open: 100,
                close: 102,
            }),
            tfMinutes: 5,
            kind: 'STK',
            upColor: '#ff4d6a',
            downColor: '#1fd286',
            clampSessionEnd: true,
            getNow: () => now,
        });
        const requestUpdate = vi.fn();
        layer.attached({
            chart: {} as never,
            series: { priceToCoordinate: (p: number) => (p === 102 ? 200 : null) } as never,
            requestUpdate,
        } as never);

        const view = layer.priceAxisViews()[0]!;
        expect(view.visible?.()).toBe(true);
        expect(view.tickVisible?.()).toBe(false);
        expect(view.text()).toBe('03:42');
        expect(view.coordinate()).toBe(200.5);
        expect(view.backColor()).toBe('#ff4d6a');

        // Calling tick() without text change does not redraw; advancing 1s does
        requestUpdate.mockClear();
        layer.tick();
        expect(requestUpdate).not.toHaveBeenCalled();

        now += 1;
        layer.tick();
        expect(requestUpdate).toHaveBeenCalledTimes(1);
        expect(view.text()).toBe('03:41');
    });
});
