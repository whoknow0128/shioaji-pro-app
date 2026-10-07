import { useState } from 'react';
import { useScanTargets, addScanTarget, removeScanTarget, toggleScanTargetActive } from '../lib/scanner-store';
import type { ScanTarget } from '../lib/scanner-store';
import { Trash2, Play, Pause, Plus } from 'lucide-react';

export function StrategyScannerPanel() {
    const targets = useScanTargets();
    const [code, setCode] = useState('2330');
    
    // 建立策略的暫存條件列表
    const [stagedConditions, setStagedConditions] = useState<any[]>([]);
    
    // 目前表單的單一條件
    const [threshold, setThreshold] = useState('1000');
    const [conditionType, setConditionType] = useState('above');
    const [action, setAction] = useState<'alert'|'trade'>('alert');
    const [quantity, setQuantity] = useState('1');
    const [maPeriod, setMaPeriod] = useState('5');
    const [kdPeriod, setKdPeriod] = useState('9');
    const [timeframe, setTimeframe] = useState('1');

    const handleAddCondition = () => {
        const needsThreshold = ['above', 'below', 'kd_k_cross_up', 'kd_k_cross_down', 'kd_d_cross_up', 'kd_d_cross_down', 'ma_above', 'ma_below', 'kd_k_above', 'kd_k_below', 'kd_d_above', 'kd_d_below'].includes(conditionType);
        if (needsThreshold && !threshold) return;
        
        const params: Record<string, any> = {};
        if (conditionType.startsWith('ma_')) params.ma_period = Number(maPeriod);
        if (conditionType.startsWith('kd_')) params.kd_period = Number(kdPeriod);
        
        if (['ma_cross_up', 'ma_cross_down', 'kd_cross_up', 'kd_cross_down', 'kd_k_cross_up', 'kd_k_cross_down', 'kd_d_cross_up', 'kd_d_cross_down', 'ma_above', 'ma_below', 'kd_k_above', 'kd_k_below', 'kd_d_above', 'kd_d_below'].includes(conditionType)) {
            params.timeframe = Number(timeframe);
        }

        setStagedConditions([...stagedConditions, {
            id: `cond-${Date.now()}`,
            type: conditionType,
            threshold: needsThreshold ? Number(threshold) : undefined,
            params
        }]);
    };

    const handleCreateStrategy = () => {
        if (!code || stagedConditions.length === 0) return;

        addScanTarget({
            code,
            conditions: stagedConditions,
            action,
            active: true,
            quantity: action === 'trade' ? Number(quantity) : undefined,
        });
        
        setCode('');
        setStagedConditions([]); // 重置暫存區
    };

    const timeframeLabel = (tf?: number) => {
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

    const formatSingleCondition = (c: any) => {
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
            // 新增的狀態條件
            case 'ma_above': return `${prefix}價格大於 ${c.params?.ma_period || 5}MA`;
            case 'ma_below': return `${prefix}價格小於 ${c.params?.ma_period || 5}MA`;
            case 'kd_k_above': return `${prefix}K值大於 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
            case 'kd_k_below': return `${prefix}K值小於 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
            case 'kd_d_above': return `${prefix}D值大於 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
            case 'kd_d_below': return `${prefix}D值小於 ${c.threshold} (KD:${c.params?.kd_period || 9})`;
            default: return c.type;
        }
    };

    const formatTargetConditions = (t: ScanTarget) => {
        if (!t.conditions || t.conditions.length === 0) return '無條件 (請刪除)';
        return t.conditions.map(c => `[${formatSingleCondition(c)}]`).join(' AND ');
    };

    const isIndicator = ['ma_cross_up', 'ma_cross_down', 'kd_cross_up', 'kd_cross_down', 'kd_k_cross_up', 'kd_k_cross_down', 'kd_d_cross_up', 'kd_d_cross_down', 'ma_above', 'ma_below', 'kd_k_above', 'kd_k_below', 'kd_d_above', 'kd_d_below'].includes(conditionType);
    const needsThresholdInput = ['above', 'below', 'kd_k_cross_up', 'kd_k_cross_down', 'kd_d_cross_up', 'kd_d_cross_down', 'kd_k_above', 'kd_k_below', 'kd_d_above', 'kd_d_below'].includes(conditionType);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 'bold' }}>新增策略監控</h3>
            
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input 
                    placeholder="股票代號" 
                    value={code} 
                    onChange={e => setCode(e.target.value)} 
                    style={{ width: '80px', padding: '4px' }}
                />
            </div>

            {/* 條件設計區 */}
            <div style={{ padding: '8px', border: '1px dashed #ccc', marginBottom: '8px', borderRadius: '4px' }}>
                <div style={{ marginBottom: '8px', fontWeight: 'bold', fontSize: '13px' }}>1. 設計條件 (可疊加)</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <select value={conditionType} onChange={e => setConditionType(e.target.value)} style={{ padding: '4px' }}>
                        <optgroup label="瞬間觸發 (Trigger)">
                            <option value="above">突破 (大於價位)</option>
                            <option value="below">跌破 (小於價位)</option>
                            <option value="ma_cross_up">突破 MA</option>
                            <option value="ma_cross_down">跌破 MA</option>
                            <option value="kd_cross_up">KD 黃金交叉</option>
                            <option value="kd_cross_down">KD 死亡交叉</option>
                            <option value="kd_k_cross_up">K值向上突破</option>
                            <option value="kd_k_cross_down">K值向下跌破</option>
                            <option value="kd_d_cross_up">D值向上突破</option>
                            <option value="kd_d_cross_down">D值向下跌破</option>
                        </optgroup>
                        <optgroup label="持續狀態 (State/Filter)">
                            <option value="ma_above">價格大於 MA</option>
                            <option value="ma_below">價格小於 MA</option>
                            <option value="kd_k_above">K值大於</option>
                            <option value="kd_k_below">K值小於</option>
                            <option value="kd_d_above">D值大於</option>
                            <option value="kd_d_below">D值小於</option>
                        </optgroup>
                    </select>
                    
                    {needsThresholdInput && (
                        <input 
                            type="number" 
                            placeholder={conditionType.startsWith('kd_') ? "觸發值" : "觸發價"} 
                            value={threshold} 
                            onChange={e => setThreshold(e.target.value)} 
                            style={{ width: '80px', padding: '4px' }}
                        />
                    )}
                    
                    {isIndicator && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>週期:</span>
                            <select value={timeframe} onChange={e => setTimeframe(e.target.value)} style={{ padding: '4px' }}>
                                <option value="1">1分</option>
                                <option value="5">5分</option>
                                <option value="15">15分</option>
                                <option value="30">30分</option>
                                <option value="60">60分</option>
                                <option value="1440">日線</option>
                                <option value="10080">周線</option>
                            </select>
                        </div>
                    )}

                    {(conditionType.startsWith('ma_')) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>MA天數:</span>
                            <input 
                                type="number" 
                                value={maPeriod} 
                                onChange={e => setMaPeriod(e.target.value)} 
                                style={{ width: '60px', padding: '4px' }}
                            />
                        </div>
                    )}
                    
                    {(conditionType.startsWith('kd_')) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>KD天數:</span>
                            <input 
                                type="number" 
                                value={kdPeriod} 
                                onChange={e => setKdPeriod(e.target.value)} 
                                style={{ width: '60px', padding: '4px' }}
                            />
                        </div>
                    )}

                    <button onClick={handleAddCondition} style={{ padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        <Plus size={16} /> 加入條件
                    </button>
                </div>

                {stagedConditions.length > 0 && (
                    <div style={{ marginTop: '8px', padding: '8px', background: '#f5f5f5', borderRadius: '4px' }}>
                        <strong>已加入的條件 (全部滿足才觸發):</strong>
                        <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
                            {stagedConditions.map(c => (
                                <li key={c.id}>
                                    {formatSingleCondition(c)}
                                    <button onClick={() => setStagedConditions(stagedConditions.filter(x => x.id !== c.id))} style={{ marginLeft: '8px', color: 'red', cursor: 'pointer', border: 'none', background: 'none' }}>移除</button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* 策略動作區 */}
            {stagedConditions.length > 0 && (
                <div style={{ padding: '8px', border: '1px solid #ccc', marginBottom: '16px', borderRadius: '4px' }}>
                    <div style={{ marginBottom: '8px', fontWeight: 'bold', fontSize: '13px' }}>2. 觸發動作</div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <select value={action} onChange={e => setAction(e.target.value as any)} style={{ padding: '4px' }}>
                            <option value="alert">僅提醒</option>
                            <option value="trade">自動下單(買進)</option>
                        </select>
                        
                        {action === 'trade' && (
                            <input 
                                type="number" 
                                placeholder="數量" 
                                value={quantity} 
                                onChange={e => setQuantity(e.target.value)} 
                                style={{ width: '60px', padding: '4px' }}
                            />
                        )}
                        
                        <button onClick={handleCreateStrategy} style={{ padding: '4px 8px', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px' }}>
                            建立策略
                        </button>
                    </div>
                </div>
            )}

            <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 'bold' }}>監控清單</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {targets.length === 0 && <div style={{ opacity: 0.5 }}>目前沒有監控目標</div>}
                {targets.map(t => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}>
                        <div>
                            <strong>{t.code}</strong> - {formatTargetConditions(t)}
                            <span style={{ marginLeft: '8px', fontSize: '12px', color: t.action === 'trade' ? '#d9534f' : '#5bc0de' }}>
                                [{t.action === 'trade' ? `自動買進 ${t.quantity} 張` : '提醒'}]
                            </span>
                            <span style={{ marginLeft: '8px', fontSize: '12px', color: t.status === 'monitoring' ? '#5cb85c' : t.status === 'error' ? '#d9534f' : '#f0ad4e' }}>
                                ({t.status === 'monitoring' ? '監控中' : t.status === 'error' ? '失敗' : '已觸發'})
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => toggleScanTargetActive(t.id, !t.active)} style={{ cursor: 'pointer' }}>
                                {t.active ? <Pause size={16} /> : <Play size={16} />}
                            </button>
                            <button onClick={() => removeScanTarget(t.id)} style={{ cursor: 'pointer', color: '#d9534f' }}>
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
