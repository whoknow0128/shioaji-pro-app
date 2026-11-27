// src/lib/price-box.ts — series primitive：在主圖繪製多組獨立矩形價格區
// （用於 FVG 失衡區、跳空缺口等可同時重疊／並存且各有起迄範圍的區域）。
// 使用 logical 座標線性投影（measureXAxis + xOfLogical），確保起點捲出視窗
// 左緣的未回補缺口依然能正確渲染可見段落。

import type {
    IChartApi,
    IPrimitivePaneRenderer,
    IPrimitivePaneView,
    ISeriesApi,
    ISeriesPrimitive,
    Logical,
    PrimitivePaneViewZOrder,
    SeriesAttachedParameter,
    SeriesType,
    Time,
} from 'lightweight-charts';
import { measureXAxis, xOfLogical } from './chart-drawing-geometry';
import { colorWithOpacity } from './indicator-defs';

export interface PriceBoxItem {
    startIndex: number;
    endIndex: number;
    startTime?: number;
    endTime?: number;
    top: number;
    bottom: number;
    mitigated: boolean;
}

export interface PriceBoxOptions {
    boxes: readonly PriceBoxItem[];
    activeFill: string;
    activeBorder: string;
    mitigatedFill: string;
    mitigatedBorder: string;
    borderWidth: number;
}

export const BOX_ACTIVE_FILL_OPACITY = 20;
export const BOX_ACTIVE_BORDER_OPACITY = 85;
export const BOX_MITIGATED_COLOR = '#f09436';
export const BOX_MITIGATED_FILL_OPACITY = 9;
export const BOX_MITIGATED_BORDER_OPACITY = 42;

export function boxColors(
    color: string,
    opacity: number,
    mitigatedColor = BOX_MITIGATED_COLOR,
): Pick<
    PriceBoxOptions,
    'activeFill' | 'activeBorder' | 'mitigatedFill' | 'mitigatedBorder'
> {
    const k = Math.max(0, Math.min(opacity, 100)) / 100;
    return {
        activeFill: colorWithOpacity(
            color,
            Math.round(BOX_ACTIVE_FILL_OPACITY * k),
        ),
        activeBorder: colorWithOpacity(
            color,
            Math.round(BOX_ACTIVE_BORDER_OPACITY * k),
        ),
        mitigatedFill: colorWithOpacity(
            mitigatedColor,
            Math.round(BOX_MITIGATED_FILL_OPACITY * k),
        ),
        mitigatedBorder: colorWithOpacity(
            mitigatedColor,
            Math.round(BOX_MITIGATED_BORDER_OPACITY * k),
        ),
    };
}

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

class PriceBoxRenderer implements IPrimitivePaneRenderer {
    constructor(
        private readonly _opts: PriceBoxOptions,
        private readonly _series: ISeriesApi<SeriesType> | null,
        private readonly _chart: IChartApi | null,
    ) {}

    draw(target: DrawTarget): void {
        const series = this._series;
        const chart = this._chart;
        if (!series || !chart) return;
        const o = this._opts;
        if (o.boxes.length === 0) return;

        const ts = chart.timeScale();
        const axis = measureXAxis((logical) =>
            ts.logicalToCoordinate(logical as Logical),
        );
        if (!axis) return;

        target.useBitmapCoordinateSpace((scope) => {
            const ctx = scope.context;
            const hr = scope.horizontalPixelRatio;
            const vr = scope.verticalPixelRatio;
            const bw = scope.bitmapSize.width;
            const lw = Math.max(1, Math.round(o.borderWidth * hr));
            const half = lw % 2 === 1 ? 0.5 : 0;
            const snap = (v: number) => Math.round(v - half) + half;
            const minHalf = Math.max(hr, 1);

            // 先畫歷史已回補、再畫有效未回補，讓未回補缺口保持清晰不被蓋淡
            const ordered = [
                ...o.boxes.filter((b) => b.mitigated),
                ...o.boxes.filter((b) => !b.mitigated),
            ];

            ctx.lineWidth = lw;
            for (const box of ordered) {
                const yT = series.priceToCoordinate(Math.max(box.top, box.bottom));
                const yB = series.priceToCoordinate(Math.min(box.top, box.bottom));
                if (yT === null || yB === null) continue;

                const rawX1 =
                    (box.startTime !== undefined
                        ? ts.timeToCoordinate(box.startTime as Time)
                        : null) ?? xOfLogical(axis, box.startIndex);
                const rawEndBase =
                    (box.endTime !== undefined
                        ? ts.timeToCoordinate(box.endTime as Time)
                        : null) ?? xOfLogical(axis, box.endIndex);
                const rawX2 = box.mitigated
                    ? rawEndBase
                    : rawEndBase + axis.barSpacing * 0.45;
                let x1 = rawX1 * hr;
                let x2 = Math.max(rawX2 * hr, x1 + minHalf * 2);

                if (x2 < 0 || x1 > bw) continue;
                x1 = Math.max(-lw, x1);
                x2 = Math.min(bw + lw, x2);

                const topY = yT * vr;
                const botY = yB * vr;
                const h = Math.max(1, botY - topY);
                const w = Math.max(1, x2 - x1);

                ctx.fillStyle = box.mitigated ? o.mitigatedFill : o.activeFill;
                ctx.fillRect(x1, topY, w, h);

                ctx.strokeStyle = box.mitigated
                    ? o.mitigatedBorder
                    : o.activeBorder;
                ctx.setLineDash(box.mitigated ? [4 * hr, 3 * hr] : []);
                const sx1 = snap(x1);
                const sx2 = snap(x2);
                const sy1 = snap(topY);
                const sy2 = snap(topY + h);
                ctx.beginPath();
                ctx.rect(sx1, sy1, Math.max(1, sx2 - sx1), Math.max(1, sy2 - sy1));
                ctx.stroke();
            }
            ctx.setLineDash([]);
        });
    }
}

class PriceBoxView implements IPrimitivePaneView {
    constructor(private readonly _prim: PriceBoxPrimitive) {}
    zOrder(): PrimitivePaneViewZOrder {
        return 'bottom';
    }
    renderer(): IPrimitivePaneRenderer {
        return new PriceBoxRenderer(
            this._prim.options,
            this._prim.series,
            this._prim.chart,
        );
    }
}

export class PriceBoxPrimitive implements ISeriesPrimitive<Time> {
    series: ISeriesApi<SeriesType> | null = null;
    chart: IChartApi | null = null;
    private readonly _views: PriceBoxView[];
    private _requestUpdate: (() => void) | null = null;

    constructor(public options: PriceBoxOptions) {
        this._views = [new PriceBoxView(this)];
    }

    attached(param: SeriesAttachedParameter<Time>): void {
        this.series = param.series;
        this.chart = param.chart;
        this._requestUpdate = param.requestUpdate;
        this._requestUpdate();
    }

    detached(): void {
        this.series = null;
        this.chart = null;
        this._requestUpdate = null;
    }

    applyOptions(opts: Partial<PriceBoxOptions>): void {
        this.options = { ...this.options, ...opts };
        this._requestUpdate?.();
    }

    paneViews(): readonly IPrimitivePaneView[] {
        return this._views;
    }
}
