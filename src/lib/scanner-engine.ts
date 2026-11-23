import { retainQuote } from './quote-ownership';
import { ensureContract } from './contracts-cache';
import { onAnyTick } from './stream';
import { notify, placeQuickOrder } from './trade';
import { getScanTargets, updateScanTarget, formatTargetConditions } from './scanner-store';
import type { ScanTarget } from './scanner-store';
import { fetchKbars } from './shioaji';
import { kbarsToCandles, wallClockToUtc, wallClockToUtcPrecise, nowWallClockUtc, dateStrOffset, aggregate } from './utils/kbars';
import { twCandleMinuteLabel } from './chart-trade';
import { sma, stoch } from './indicators';
import { isDaySessionTick, filterDaySession } from './intraday-session';
import {
    OPENING_VOL_TIMEFRAMES,
    computeTodayOpeningBaseline,
    evaluateOpeningVolumeSpike,
    extractPastOpeningVolumes,
    normalizeOpeningTimeframe,
    openingBarWindow,
    twDayStartSec,
    type OpeningVolTimeframe,
    type TodayOpeningBaseline,
} from './opening-volume';
import type { Candle } from './types/market';
import type { ContractBase, SecurityType } from './types/contract';

const retainers = new Map<string, ReturnType<typeof retainQuote>>();
const targetContracts = new Map<string, ContractBase>();
const targetSecTypes = new Map<string, SecurityType>();
const lastPrices = new Map<string, number>();
const targetKbars = new Map<string, Candle[]>();
const fetchedKbarDays = new Map<string, { days: number; dayStartSec: number }>();
const fetchingKbars = new Set<string>();
const openingCandles = new Map<string, Candle[]>();
const openingBaselineCache = new Map<string, { dayStartSec: number; byTf: Map<OpeningVolTimeframe, TodayOpeningBaseline> }>();
const liveOpeningVols = new Map<string, { dayStartSec: number; byTf: Map<OpeningVolTimeframe, { liveExtra: number; maxTotal: number }> }>();
const lastTodayRefreshAt = new Map<string, number>();
let lastTargets: ScanTarget[] = [];
const targetMetState = new Map<string, boolean>();

const INDICATOR_TYPES = new Set([
    'ma_cross_up', 'ma_cross_down',
    'kd_cross_up', 'kd_cross_down',
    'kd_k_cross_up', 'kd_k_cross_down',
    'kd_d_cross_up', 'kd_d_cross_down',
    'ma_above', 'ma_below',
    'kd_k_above', 'kd_k_below',
    'kd_d_above', 'kd_d_below',
]);

function getOpeningBaseline(
    code: string,
    todayDayStartSec: number,
    tf: OpeningVolTimeframe,
    candles: readonly Candle[],
): TodayOpeningBaseline {
    let entry = openingBaselineCache.get(code);
    if (!entry || entry.dayStartSec !== todayDayStartSec) {
        entry = { dayStartSec: todayDayStartSec, byTf: new Map() };
        openingBaselineCache.set(code, entry);
    }
    let b = entry.byTf.get(tf);
    if (!b) {
        b = computeTodayOpeningBaseline(candles, todayDayStartSec, tf);
        entry.byTf.set(tf, b);
    }
    return b;
}

function mergeTodayCandles(existing: Candle[], incoming: Candle[], todayDayStartSec: number): Candle[] {
    const past = existing.filter(c => c.time < todayDayStartSec);
    const todayMap = new Map<number, Candle>();
    for (const c of existing) {
        if (c.time >= todayDayStartSec) todayMap.set(c.time, c);
    }
    for (const c of incoming) {
        if (c.time >= todayDayStartSec) todayMap.set(c.time, c);
    }
    const todaySorted = Array.from(todayMap.values()).sort((a, b) => a.time - b.time);
    return [...past, ...todaySorted];
}

// 定期檢查訂閱狀態，同步 store 的變化
export async function syncScannerSubscriptions() {
    const targets = getScanTargets().filter(t => t.active && t.status === 'monitoring');
    const requiredCodes = new Set(targets.map(t => t.code));
    lastTargets = targets;

    // 移除不再監控的訂閱
    for (const [code, release] of retainers.entries()) {
        if (!requiredCodes.has(code)) {
            release();
            retainers.delete(code);
            targetContracts.delete(code);
            targetKbars.delete(code);
            targetSecTypes.delete(code);
            fetchedKbarDays.delete(code);
            openingCandles.delete(code);
            openingBaselineCache.delete(code);
            liveOpeningVols.delete(code);
            lastTodayRefreshAt.delete(code);
        }
    }

    const targetsByCode = new Map<string, ScanTarget[]>();
    for (const target of targets) {
        const list = targetsByCode.get(target.code) ?? [];
        list.push(target);
        targetsByCode.set(target.code, list);
    }

    const today0 = twDayStartSec(nowWallClockUtc());

    // 新增或更新監控訂閱與歷史 K 線
    for (const [code, codeTargets] of targetsByCode.entries()) {
        if (!retainers.has(code)) {
            // 由於非同步特性，先塞入一個假的防重複，隨後再替換
            retainers.set(code, () => {});
            try {
                const contract = await ensureContract(code);
                if (retainers.has(code)) {
                    retainers.set(code, retainQuote(contract, 'Tick'));
                    targetContracts.set(code, contract);
                    targetSecTypes.set(code, contract.security_type);
                }
            } catch (e) {
                console.error(`Scanner failed to subscribe for ${code}:`, e);
                retainers.delete(code);
                continue;
            }
        }

        const contract = targetContracts.get(code);
        if (!contract) continue;

        let needIndicators = false;
        let needOpeningVol = false;
        let maxDays = 0;

        for (const target of codeTargets) {
            for (const c of target.conditions) {
                if (INDICATOR_TYPES.has(c.type)) {
                    needIndicators = true;
                    const tf = Number(c.params?.timeframe || 1);
                    let days = 5;
                    if (tf >= 10080) days = 60;
                    else if (tf >= 1440) days = 30;
                    maxDays = Math.max(maxDays, days);
                } else if (c.type === 'opening_vol_spike') {
                    needOpeningVol = true;
                    const lookback = Math.max(1, Math.floor(Number(c.params?.lookback_days) || 20));
                    const calDays = Math.max(35, Math.ceil(lookback * 1.7) + 7);
                    maxDays = Math.max(maxDays, calDays);
                }
            }
        }

        const prevFetch = fetchedKbarDays.get(code);
        const needsFetch =
            maxDays > 0 &&
            !fetchingKbars.has(code) &&
            (!prevFetch || prevFetch.days < maxDays || prevFetch.dayStartSec !== today0);

        if (needsFetch) {
            fetchingKbars.add(code);
            try {
                const res = await fetchKbars(contract, dateStrOffset(maxDays), dateStrOffset(0), {
                    timeoutMs: maxDays >= 30 ? 30_000 : 10_000,
                });
                const candles = kbarsToCandles(res);
                if (needIndicators) {
                    targetKbars.set(code, candles.length > 1500 ? candles.slice(-1500) : [...candles]);
                }
                if (needOpeningVol) {
                    openingCandles.set(code, candles);
                    openingBaselineCache.delete(code);
                }
                fetchedKbarDays.set(code, { days: maxDays, dayStartSec: today0 });
            } catch (e) {
                console.error(`Scanner failed to fetch kbars for ${code}:`, e);
            } finally {
                fetchingKbars.delete(code);
            }
        }
    }
}

// 監聽 Store 變化，當我們新增/刪除/暫停監控時，自動更新訂閱
let syncTimer: any;
export function scheduleScannerSync() {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
        syncTimer = null;
        syncScannerSubscriptions();
    }, 100);
}

/**
 * 傾聽系統中所有的 Tick 更新
 */
onAnyTick(tick => {
    // SseTick.close is a string in shioaji 1.7
    const price = Number(tick.close);
    if (!Number.isFinite(price)) return;

    const prevPrice = lastPrices.get(tick.code);
    lastPrices.set(tick.code, price);

    let tickSec = 0;
    if (tick.date && tick.time) {
        const precise = wallClockToUtcPrecise(`${tick.date}T${tick.time}`);
        if (Number.isFinite(precise)) {
            tickSec = precise;
        } else {
            const parsed = wallClockToUtc(`${tick.date} ${tick.time.substring(0, 8)}`);
            if (!Number.isNaN(parsed)) tickSec = parsed;
        }
    }

    const candles = targetKbars.get(tick.code);

    // Update live 1-min candle if exists
    if (candles && tickSec > 0) {
        const bucket = twCandleMinuteLabel(tickSec);
        let last = candles[candles.length - 1];

        if (!last || last.time < bucket) {
            last = { time: bucket, open: price, high: price, low: price, close: price, volume: tick.volume || 0 };
            candles.push(last);
        } else if (last.time === bucket) {
            last.high = Math.max(last.high, price);
            last.low = Math.min(last.low, price);
            last.close = price;
            last.volume += tick.volume || 0;
        }

        // Keep memory bounded
        if (candles.length > 1500) {
            candles.splice(0, 500);
        }
    }

    // Update opening-bar live volume accumulators when opening candles are tracked
    const fullOpening = openingCandles.get(tick.code);
    if (fullOpening && tickSec > 0) {
        const today0 = twDayStartSec(tickSec);
        let liveEntry = liveOpeningVols.get(tick.code);
        if (!liveEntry || liveEntry.dayStartSec !== today0) {
            liveEntry = { dayStartSec: today0, byTf: new Map() };
            liveOpeningVols.set(tick.code, liveEntry);
        }
        const label = twCandleMinuteLabel(tickSec);
        for (const tf of OPENING_VOL_TIMEFRAMES) {
            const win = openingBarWindow(today0, tf);
            if (label >= win.startSec && label <= win.barEndSec) {
                const baseline = getOpeningBaseline(tick.code, today0, tf, fullOpening);
                let tfState = liveEntry.byTf.get(tf);
                if (!tfState) {
                    tfState = { liveExtra: 0, maxTotal: 0 };
                    liveEntry.byTf.set(tf, tfState);
                }
                if (tick.total_volume > 0) {
                    tfState.maxTotal = Math.max(tfState.maxTotal, tick.total_volume);
                }
                if (label > baseline.coveredLabel) {
                    tfState.liveExtra += tick.volume || 0;
                }
            }
        }
    }

    evaluateTargetsForCode(tick.code, price, prevPrice, tickSec || nowWallClockUtc());
});

function evaluateTargetsForCode(
    code: string,
    price: number,
    prevPrice: number | undefined,
    nowWallSec: number,
) {
    const candles = targetKbars.get(code);
    const fullOpening = openingCandles.get(code);

    for (const t of lastTargets) {
        if (t.code === code && t.active && t.status === 'monitoring' && t.conditions && t.conditions.length > 0) {
            const secType = targetSecTypes.get(t.code);
            if (secType && nowWallSec > 0 && t.session && t.session !== 'all') {
                const isDay = isDaySessionTick(secType, nowWallSec);
                if (t.session === 'day' && !isDay) continue;
                if (t.session === 'night' && isDay) continue;
            }

            let allMet = true;
            const openingNotes: string[] = [];

            let currentCandles = candles;
            if (currentCandles && secType && t.session === 'day') {
                currentCandles = filterDaySession(secType, currentCandles);
            }

            for (const cond of t.conditions) {
                let met = false;
                if (cond.type === 'above' && prevPrice !== undefined) {
                    met = (prevPrice <= (cond.threshold || 0) && price > (cond.threshold || 0));
                } else if (cond.type === 'below' && prevPrice !== undefined) {
                    met = (prevPrice >= (cond.threshold || 0) && price < (cond.threshold || 0));
                } else if (['ma_cross_up', 'ma_cross_down', 'ma_above', 'ma_below'].includes(cond.type) && currentCandles) {
                    const timeframe = Number(cond.params?.timeframe || 1);
                    const period = Number(cond.params?.ma_period || 5);
                    const aggCandles = aggregate(currentCandles, timeframe);
                    const ma = sma(aggCandles, period);
                    if (ma.length >= 2 && prevPrice !== undefined) {
                        const prevMa = ma[ma.length - 2]?.value;
                        const currMa = ma[ma.length - 1]?.value;
                        if (prevMa !== undefined && currMa !== undefined) {
                            if (cond.type === 'ma_cross_up') met = (prevPrice <= prevMa && price > currMa);
                            else if (cond.type === 'ma_cross_down') met = (prevPrice >= prevMa && price < currMa);
                            else if (cond.type === 'ma_above') met = (price > currMa);
                            else if (cond.type === 'ma_below') met = (price < currMa);
                        }
                    }
                } else if (['kd_cross_up', 'kd_cross_down', 'kd_k_cross_up', 'kd_k_cross_down', 'kd_d_cross_up', 'kd_d_cross_down', 'kd_k_above', 'kd_k_below', 'kd_d_above', 'kd_d_below'].includes(cond.type) && currentCandles) {
                    const timeframe = Number(cond.params?.timeframe || 1);
                    const period = Number(cond.params?.kd_period || 9);
                    const aggCandles = aggregate(currentCandles, timeframe);
                    const { k, d } = stoch(aggCandles, period, 3, 3);
                    if (k.length >= 2 && d.length >= 2) {
                        const prevK = k[k.length - 2]?.value;
                        const prevD = d[d.length - 2]?.value;
                        const currK = k[k.length - 1]?.value;
                        const currD = d[d.length - 1]?.value;
                        const th = cond.threshold || 0;
                        if (prevK !== undefined && prevD !== undefined && currK !== undefined && currD !== undefined) {
                            if (cond.type === 'kd_cross_up') met = (prevK <= prevD && currK > currD);
                            else if (cond.type === 'kd_cross_down') met = (prevK >= prevD && currK < currD);
                            else if (cond.type === 'kd_k_cross_up') met = (prevK <= th && currK > th);
                            else if (cond.type === 'kd_k_cross_down') met = (prevK >= th && currK < th);
                            else if (cond.type === 'kd_d_cross_up') met = (prevD <= th && currD > th);
                            else if (cond.type === 'kd_d_cross_down') met = (prevD >= th && currD < th);
                            else if (cond.type === 'kd_k_above') met = (currK > th);
                            else if (cond.type === 'kd_k_below') met = (currK < th);
                            else if (cond.type === 'kd_d_above') met = (currD > th);
                            else if (cond.type === 'kd_d_below') met = (currD < th);
                        }
                    }
                } else if (cond.type === 'opening_vol_spike' && fullOpening) {
                    const tf = normalizeOpeningTimeframe(cond.params?.timeframe);
                    const lookbackDays = Math.max(1, Math.floor(Number(cond.params?.lookback_days) || 20));
                    const multiplier = Math.max(0.1, Number(cond.params?.multiplier) || 2);
                    const today0 = twDayStartSec(nowWallSec);
                    const pastVolumes = extractPastOpeningVolumes(fullOpening, today0, tf, lookbackDays);
                    const baseline = getOpeningBaseline(t.code, today0, tf, fullOpening);
                    const liveEntry = liveOpeningVols.get(t.code);
                    const liveTf = liveEntry && liveEntry.dayStartSec === today0 ? liveEntry.byTf.get(tf) : undefined;
                    const todayVolume = Math.max(
                        baseline.histVolume + (liveTf?.liveExtra ?? 0),
                        liveTf?.maxTotal ?? 0,
                    );
                    const res = evaluateOpeningVolumeSpike({
                        nowWallSec,
                        todayDayStartSec: today0,
                        timeframe: tf,
                        multiplier,
                        pastVolumes,
                        todayVolume,
                    });
                    met = res.met;
                    if (met && res.medianVolume !== null && res.ratio !== null) {
                        const tfText = tf >= 1440 ? '日收盤(13:05)' : `${tf}分K首棒`;
                        openingNotes.push(
                            `${tfText} 今量 ${Math.round(res.todayVolume).toLocaleString()} / 近${res.sampleCount}日中位數 ${Math.round(res.medianVolume).toLocaleString()} (${res.ratio.toFixed(2)}x${res.exceededPct !== null ? `，贏過${res.exceededPct}%交易日` : ''})`,
                        );
                    }
                }

                if (!met) {
                    allMet = false;
                    break;
                }
            }

            const previouslyMet = targetMetState.get(t.id) || false;

            if (allMet && !previouslyMet) {
                targetMetState.set(t.id, true);

                if (!t.repeat) {
                    // 1. 單次觸發：觸發後立刻停止監控該條件，避免重複洗單
                    updateScanTarget(t.id, { active: false, status: 'triggered' });
                    scheduleScannerSync();
                }

                const actionText = t.action === 'trade' ? '並已嘗試送單' : '發出警示';
                const extraLine = openingNotes.length > 0 ? `\n${openingNotes.join('\n')}` : '';

                notify({
                    kind: 'ok',
                    title: '策略監控條件成立！',
                    body: `${t.code} 現價 ${price} 滿足條件：\n${formatTargetConditions(t)}${extraLine}\n${actionText}！`
                });

                // 2. 如果動作是交易，則送出市價委託
                if (t.action === 'trade' && t.quantity) {
                    executeTrade(t, price);
                }
            } else if (!allMet) {
                targetMetState.set(t.id, false);
            }
        }
    }
}

async function checkOpeningVolumeSchedules() {
    const nowSec = nowWallClockUtc();
    const d = new Date(nowSec * 1000);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) return;
    const today0 = twDayStartSec(nowSec);
    const tod = nowSec - today0;
    // 只在台股現貨盤中與收盤緩衝時段內主動排程檢查 (09:00 ~ 13:35)
    if (tod < 9 * 3600 || tod > 13.5 * 3600 + 300) return;

    const checkedCodes = new Set<string>();
    for (const t of lastTargets) {
        if (!t.active || t.status !== 'monitoring') continue;
        const openingConds = t.conditions.filter(c => c.type === 'opening_vol_spike');
        if (openingConds.length === 0) continue;

        const fullOpening = openingCandles.get(t.code);
        const contract = targetContracts.get(t.code);
        if (!fullOpening || !contract) continue;

        // 若已過檢查時間點但今日歷史仍未涵蓋該區間且即時量尚未抓到，補抓一次今日 K 棒
        const needsCatchup = openingConds.some(c => {
            const tf = normalizeOpeningTimeframe(c.params?.timeframe);
            const win = openingBarWindow(today0, tf);
            if (nowSec < win.checkStartSec) return false;
            const baseline = getOpeningBaseline(t.code, today0, tf, fullOpening);
            const liveEntry = liveOpeningVols.get(t.code);
            const liveTf = liveEntry && liveEntry.dayStartSec === today0 ? liveEntry.byTf.get(tf) : undefined;
            if (tf < 1440) {
                return baseline.coveredLabel < win.barEndSec && (liveTf?.maxTotal ?? 0) === 0;
            }
            return baseline.histVolume === 0 && (liveTf?.maxTotal ?? 0) === 0;
        });

        if (needsCatchup && !fetchingKbars.has(t.code) && Date.now() - (lastTodayRefreshAt.get(t.code) ?? 0) > 30_000) {
            lastTodayRefreshAt.set(t.code, Date.now());
            fetchingKbars.add(t.code);
            try {
                const res = await fetchKbars(contract, dateStrOffset(1), dateStrOffset(0), { timeoutMs: 10_000 });
                const merged = mergeTodayCandles(fullOpening, kbarsToCandles(res), today0);
                openingCandles.set(t.code, merged);
                openingBaselineCache.delete(t.code);
            } catch (e) {
                console.error(`Scanner catch-up fetch failed for ${t.code}:`, e);
            } finally {
                fetchingKbars.delete(t.code);
            }
        }

        if (!checkedCodes.has(t.code)) {
            checkedCodes.add(t.code);
            const latestCandles = openingCandles.get(t.code) ?? fullOpening;
            const fallbackPrice = latestCandles[latestCandles.length - 1]?.close ?? 0;
            const price = lastPrices.get(t.code) ?? fallbackPrice;
            if (price > 0) {
                evaluateTargetsForCode(t.code, price, price, nowSec);
            }
        }
    }
}

async function executeTrade(target: ScanTarget, currentPrice: number) {
    try {
        const contract = await ensureContract(target.code);
        // PoC: 預設使用買單，實際可能需要讓使用者在 UI 選擇買或賣
        await placeQuickOrder(contract, 'Buy', null, target.quantity || 1, {
            bypassRisk: false, 
            source: 'auto',
        });
        notify({ kind: 'ok', title: '策略自動下單', body: `${target.code} 自動買進 ${target.quantity} 張` });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notify({ kind: 'err', title: '策略自動下單失敗', body: `${target.code} 送單失敗: ${msg}` });
        updateScanTarget(target.id, { status: 'error' });
    }
}

let initialized = false;
export function initScannerEngine() {
    if (initialized) return;
    initialized = true;
    setInterval(syncScannerSubscriptions, 10000);
    setInterval(() => {
        void checkOpeningVolumeSchedules();
    }, 5000);
    syncScannerSubscriptions();
}
