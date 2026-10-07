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
