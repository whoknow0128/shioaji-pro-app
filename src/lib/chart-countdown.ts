// src/lib/chart-countdown.ts — 主圖右側即時價格軸上的「收 K 剩餘時間」標記。
// 以 lightweight-charts v5 SeriesPrimitive 的 priceAxisViews() 渲染在最新價格
// 標籤正下方，自動寬度撐開價格軸並避開委託線／十字線標籤重疊。

import type {
    ISeriesApi,
    ISeriesPrimitive,
    ISeriesPrimitiveAxisView,
    SeriesAttachedParameter,
    SeriesType,
    Time,
} from 'lightweight-charts';
import { contrastTextColor } from './chart-drawings';
import { candleBarTime } from './chart-trade';
import {
    hasNightSession,
    sessionNow,
    sessionWindowFor,
    type SessionKind,
} from './intraday-session';

const DAY = 86400;

export interface CountdownBar {
    time: number;
    open: number;
    close: number;
}

export interface CountdownInput {
    lastBar: CountdownBar | null;
    tfMinutes: number;
    kind: SessionKind;
    now: number;
    /** true 時盤中最後一小時與日 K 收盤會對齊 sessionWindowFor().end（長日盤期貨設 false） */
    clampSessionEnd?: boolean;
}

export function formatCountdown(remainingSec: number): string {
    const sec = Math.max(0, Math.floor(remainingSec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 計算目前最後一根 K 棒距離收 K 的剩餘秒數與格式化字串。
 * 休市、盤間休息、或最後一根 K 棒已收盤超過一個週期時回傳 null（隱藏倒數）。
 */
export function barCloseCountdown(
    input: CountdownInput,
): { remainingSec: number; text: string } | null {
    const { lastBar, tfMinutes, kind, now } = input;
    if (!lastBar || !Number.isFinite(lastBar.time) || !Number.isFinite(now)) {
        return null;
    }
    const clampEnd = input.clampSessionEnd ?? true;
    const w = sessionWindowFor(kind, now);
    const inSession = now >= w.start && now < w.end;

    if (tfMinutes >= 1440) {
        if (!inSession) return null;
        if (!clampEnd && !w.night) return null;
        const todayDay = Math.floor(now / DAY) * DAY;
        const startDay = Math.floor(w.start / DAY) * DAY;
        const isCurrentDayBar =
            lastBar.time === todayDay || (w.night && lastBar.time === startDay);
        if (!isCurrentDayBar) return null;
        const remainingSec = Math.max(0, Math.ceil(w.end - now));
        return { remainingSec, text: formatCountdown(remainingSec) };
    }

    const bucketSec = tfMinutes * 60;
    if (!(bucketSec > 0)) return null;

    let closeAt: number | null = null;
    if (lastBar.time > now) {
        // 允許本機時鐘些微誤差（<= 5 秒）
        if (lastBar.time - now <= bucketSec + 5) {
            closeAt = lastBar.time;
        }
    } else if (inSession && now - lastBar.time < bucketSec) {
        // 剛跨過上一根收盤時刻、新 K 棒尚未收到第一筆成交時，依目前時刻推算新棒結束時間
        closeAt = candleBarTime(kind, now, tfMinutes);
    }

    if (closeAt === null) return null;
    if (inSession && (clampEnd || w.night) && w.end < closeAt) {
        closeAt = w.end;
    }

    const remainingSec = Math.ceil(closeAt - now);
    if (remainingSec <= 0) return null;
    return { remainingSec, text: formatCountdown(remainingSec) };
}

export interface BarCountdownOptions {
    getLastBar: () => CountdownBar | null;
    tfMinutes: number;
    kind: SessionKind;
    upColor: string;
    downColor: string;
    clampSessionEnd: boolean;
    getNow?: (kind: SessionKind) => number;
}

class BarCountdownAxisView implements ISeriesPrimitiveAxisView {
    constructor(private readonly _layer: BarCountdownLayer) {}

    coordinate(): number {
        const y = this._layer.lastPriceY();
        // 放在最新價下方 0.5px，由 lightweight-charts 的防重疊機制緊貼於價格標籤正下方
        return y === null ? -1000 : y + 0.5;
    }

    text(): string {
        return this._layer.currentText();
    }

    textColor(): string {
        return contrastTextColor(this.backColor());
    }

    backColor(): string {
        return this._layer.currentBackColor();
    }

    visible(): boolean {
        return this._layer.currentText().length > 0 && this._layer.lastPriceY() !== null;
    }

    tickVisible(): boolean {
        return false;
    }
}

export class BarCountdownLayer implements ISeriesPrimitive<Time> {
    private _series: ISeriesApi<SeriesType> | null = null;
    private _requestUpdate: (() => void) | null = null;
    private readonly _axisViews: readonly BarCountdownAxisView[];
    private _lastRenderedText = '';

    constructor(public options: BarCountdownOptions) {
        this._axisViews = [new BarCountdownAxisView(this)];
    }

    attached(param: SeriesAttachedParameter<Time>): void {
        this._series = param.series;
        this._requestUpdate = param.requestUpdate;
        this._lastRenderedText = this.currentText();
        this._requestUpdate();
    }

    detached(): void {
        this._series = null;
        this._requestUpdate = null;
    }

    setOptions(opts: Partial<BarCountdownOptions>): void {
        this.options = { ...this.options, ...opts };
        this.refresh();
    }

    /** 每秒呼叫：僅在倒數文字改變（或顯示狀態切換）時觸發圖表重繪 */
    tick(): void {
        const next = this.currentText();
        if (next !== this._lastRenderedText) {
            this._lastRenderedText = next;
            this._requestUpdate?.();
        }
    }

    refresh(): void {
        this._lastRenderedText = this.currentText();
        this._requestUpdate?.();
    }

    lastPriceY(): number | null {
        const bar = this.options.getLastBar();
        if (!bar || !this._series) return null;
        return this._series.priceToCoordinate(bar.close);
    }

    currentBackColor(): string {
        const bar = this.options.getLastBar();
        if (!bar) return this.options.upColor;
        return bar.close >= bar.open ? this.options.upColor : this.options.downColor;
    }

    currentText(): string {
        const bar = this.options.getLastBar();
        const nowFn = this.options.getNow ?? sessionNow;
        const res = barCloseCountdown({
            lastBar: bar,
            tfMinutes: this.options.tfMinutes,
            kind: this.options.kind,
            now: nowFn(this.options.kind),
            clampSessionEnd:
                this.options.clampSessionEnd || !hasNightSession(this.options.kind),
        });
        return res?.text ?? '';
    }

    priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
        return this._axisViews;
    }
}
