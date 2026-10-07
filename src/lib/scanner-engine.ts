import { retainQuote } from './quote-ownership';
import { ensureContract } from './contracts-cache';
import { onAnyTick } from './stream';
import { notify, placeQuickOrder } from './trade';
import { getScanTargets, updateScanTarget, formatTargetConditions } from './scanner-store';
import type { ScanTarget } from './scanner-store';
import { fetchKbars } from './shioaji';
import { kbarsToCandles, wallClockToUtc, dateStrOffset, aggregate } from './utils/kbars';
import { sma, stoch } from './indicators';
import { isDaySessionTick, filterDaySession } from './intraday-session';
import type { Candle } from './types/market';
import type { SecurityType } from './types/contract';

const retainers = new Map<string, ReturnType<typeof retainQuote>>();
const targetSecTypes = new Map<string, SecurityType>();
const lastPrices = new Map<string, number>();
const targetKbars = new Map<string, Candle[]>();
let lastTargets: ScanTarget[] = [];
const targetMetState = new Map<string, boolean>();

// 定期檢查訂閱狀態，同步 store 的變化
export async function syncScannerSubscriptions() {
    const targets = getScanTargets().filter(t => t.active && t.status === 'monitoring');
    const requiredCodes = new Set(targets.map(t => t.code));
    
    // 移除不再監控的訂閱
    for (const [code, release] of retainers.entries()) {
        if (!requiredCodes.has(code)) {
            release();
            retainers.delete(code);
            targetKbars.delete(code);
            targetSecTypes.delete(code);
        }
    }
    
    // 新增尚未訂閱的監控
    for (const target of targets) {
        const code = target.code;
        if (!retainers.has(code)) {
            // 由於非同步特性，先塞入一個假的防重複，隨後再替換
            retainers.set(code, () => {});
            
            try {
                const contract = await ensureContract(code);
                if (retainers.has(code)) { // double check
                    retainers.set(code, retainQuote(contract, 'Tick'));
                    targetSecTypes.set(code, contract.security_type);
                }
                
                // 若策略有任一條件需要指標，依據最大的 timeframe 載入適當天數的歷史 K 線
                const indicatorConds = target.conditions.filter(c => ['ma_cross_up', 'ma_cross_down', 'kd_cross_up', 'kd_cross_down', 'kd_k_cross_up', 'kd_k_cross_down', 'kd_d_cross_up', 'kd_d_cross_down', 'ma_above', 'ma_below', 'kd_k_above', 'kd_k_below', 'kd_d_above', 'kd_d_below'].includes(c.type));
                
                if (indicatorConds.length > 0) {
                    if (!targetKbars.has(code)) {
                        const maxTimeframe = Math.max(...indicatorConds.map(c => Number(c.params?.timeframe || 1)));
                        let days = 5;
                        if (maxTimeframe >= 10080) days = 60;
                        else if (maxTimeframe >= 1440) days = 30;
                        
                        const res = await fetchKbars(contract, dateStrOffset(days), dateStrOffset(0));
                        targetKbars.set(code, kbarsToCandles(res));
                    }
                }
            } catch (e) {
                console.error(`Scanner failed to subscribe or fetch kbars for ${code}:`, e);
                retainers.delete(code);
            }
        }
    }
    lastTargets = targets;
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
        const tickTimeStr = `${tick.date} ${tick.time.substring(0, 8)}`;
        const parsed = wallClockToUtc(tickTimeStr);
        if (!Number.isNaN(parsed)) tickSec = parsed;
    }
    
    const candles = targetKbars.get(tick.code);
    
    // Update live 1-min candle if exists
    if (candles && tickSec > 0) {
        const bucket = Math.ceil(tickSec / 60) * 60;
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

    // 檢查是否有符合條件的目標
    for (const t of lastTargets) {
        if (t.code === tick.code && t.active && t.status === 'monitoring' && t.conditions && t.conditions.length > 0) {
            
            const secType = targetSecTypes.get(t.code);
            if (secType && tickSec > 0 && t.session && t.session !== 'all') {
                const isDay = isDaySessionTick(secType, tickSec);
                if (t.session === 'day' && !isDay) continue;
                if (t.session === 'night' && isDay) continue;
            }

            let allMet = true;
            
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
                
                notify({
                    kind: 'ok',
                    title: '策略監控條件成立！',
                    body: `${t.code} 現價 ${price} 滿足條件：\n${formatTargetConditions(t)}\n${actionText}！`
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
});

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
    syncScannerSubscriptions();
}
