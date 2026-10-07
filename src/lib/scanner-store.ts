import { useSyncExternalStore } from 'react';

export interface ScanCondition {
    id: string; // 單一條件的唯一 ID
    type: string; // 條件類型: 'above', 'below', 'ma_cross_up', 'ma_cross_down', 'kd_cross_up', 'kd_cross_down', 'kd_k_cross_up', 'kd_k_cross_down', 'kd_d_cross_up', 'kd_d_cross_down', 'ma_above', 'ma_below', 'kd_k_above', 'kd_k_below', 'kd_d_above', 'kd_d_below'
    threshold?: number;
    params?: Record<string, any>; // timeframe, ma_period, kd_period
}

export interface ScanTarget {
    id: string; // 唯一識別碼
    code: string; // 股票代號
    conditions: ScanCondition[]; // 多個條件，全部達成才觸發 (AND 邏輯)
    action: 'alert' | 'trade'; // 動作：提醒或交易
    active: boolean; // 是否啟用監控
    status: 'monitoring' | 'triggered' | 'error'; // 當前狀態
    quantity?: number; // 若為 trade，代表下單數量
    repeat?: boolean; // 是否允許重複觸發
}

const STORAGE_KEY = 'sj-pro-scanner-targets';
let targets: ScanTarget[] = [];
const listeners = new Set<() => void>();

function loadTargets() {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.every(t => Array.isArray(t.conditions))) {
                targets = parsed;
            } else {
                targets = []; // Discard old format
                saveTargets();
            }
        }
    } catch {
        // storage not available
    }
}

function saveTargets() {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(targets));
    } catch {
        // quota limit
    }
}

// 初始載入
loadTargets();

function emit() {
    saveTargets();
    listeners.forEach(l => l());
}

export function getScanTargets() {
    return targets;
}

export function useScanTargets() {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        () => targets
    );
}

export function addScanTarget(target: Omit<ScanTarget, 'id' | 'status'>) {
    const id = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    targets = [...targets, { ...target, id, status: target.active ? 'monitoring' : 'triggered' }];
    emit();
    return id;
}

export function removeScanTarget(id: string) {
    targets = targets.filter(t => t.id !== id);
    emit();
}

export function updateScanTarget(id: string, patch: Partial<ScanTarget>) {
    targets = targets.map(t => (t.id === id ? { ...t, ...patch } : t));
    emit();
}

export function toggleScanTargetActive(id: string, active: boolean) {
    targets = targets.map(t => {
        if (t.id === id) {
            return { ...t, active, status: active ? 'monitoring' : 'triggered' };
        }
        return t;
    });
    emit();
}

export const timeframeLabel = (tf?: number) => {
    switch (tf) {
        case 1: return '1分K';
        case 5: return '5分K';
        case 15: return '15分K';
        case 30: return '30分K';
        case 60: return '60分K';
        case 1440: return '日K';
        case 10080: return '周K';
        default: return tf ? `${tf}分K` : '1分K';
    }
};

export const formatSingleCondition = (c: any) => {
    const prefix = c.params?.timeframe ? `[${timeframeLabel(c.params.timeframe)}] ` : '';
    switch (c.type) {
        case 'above': return `價格向上突破 ${c.threshold}`;
        case 'below': return `價格向下跌破 ${c.threshold}`;
        case 'ma_cross_up': return `${prefix}價格向上突破 ${c.params?.ma_period || 5}MA`;
        case 'ma_cross_down': return `${prefix}價格向下跌破 ${c.params?.ma_period || 5}MA`;
        case 'kd_cross_up': return `${prefix}KD(${c.params?.kd_period || 9}) 黃金交叉`;
        case 'kd_cross_down': return `${prefix}KD(${c.params?.kd_period || 9}) 死亡交叉`;
        case 'kd_k_cross_up': return `${prefix}K值向上突破 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
        case 'kd_k_cross_down': return `${prefix}K值向下跌破 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
        case 'kd_d_cross_up': return `${prefix}D值向上突破 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
        case 'kd_d_cross_down': return `${prefix}D值向下跌破 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
        case 'ma_above': return `${prefix}價格大於 ${c.params?.ma_period || 5}MA`;
        case 'ma_below': return `${prefix}價格小於 ${c.params?.ma_period || 5}MA`;
        case 'kd_k_above': return `${prefix}K值大於 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
        case 'kd_k_below': return `${prefix}K值小於 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
        case 'kd_d_above': return `${prefix}D值大於 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
        case 'kd_d_below': return `${prefix}D值小於 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
        default: return c.type;
    }
};

export const formatTargetConditions = (t: ScanTarget) => {
    if (!t.conditions || t.conditions.length === 0) return '無條件 (請刪除)';
    return t.conditions.map(c => `[${formatSingleCondition(c)}]`).join(' AND ');
};
