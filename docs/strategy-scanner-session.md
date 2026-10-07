# 開發紀錄：策略監控支援日夜盤過濾 (Session Filtering)

## 需求背景
部分期貨與選擇權商品（如台指期）具備日盤與夜盤交易時段。針對這些商品，使用者在設計策略監控時，往往會有以下情境需求：
- **僅日盤監控**：某些策略僅在正常日盤時段有效，不希望被夜盤走勢干擾，尤其在計算日線技術指標（如均線、KD）時，希望能剃除夜盤的 K 棒資料以反映純日盤的走勢。
- **僅夜盤監控**：某些策略設計在夜間發布重大數據（如美股開盤、非農數據）時觸發，但技術指標計算仍希望能維持全天候的連續性，只是限定在夜盤時段才執行觸發與下單。

為了滿足上述需求，我們在 `ScanTarget` 中引入了 `session` 選項，提供 `all` (全盤)、`day` (僅日盤)、`night` (僅夜盤) 三種模式。

## 實作細節

### 1. 資料層 (Store)
- 檔案：`src/lib/scanner-store.ts`
- 修改：
  - 在 `ScanTarget` 介面中新增可選屬性 `session?: 'all' | 'day' | 'night'`。
  - 確保從檔案配置 (如 `strategies.json`) 載入時，能夠正確解析並套用此屬性。

### 2. 使用者介面 (UI)
- 檔案：`src/components/strategy-scanner-panel.tsx`
- 修改：
  - 於「新增策略監控」面板中的「觸發動作」區塊，新增一個 `<select>` 供使用者選擇盤別（預設為「全盤」）。
  - 當建立策略並呼叫 `addScanTarget` 時，將 `session` 狀態一併寫入設定。
  - 在監控清單渲染時，若 `session` 不為 `all`，則在策略代號前顯示 `(僅日盤)` 或 `(僅夜盤)` 標籤以利用戶辨識。

### 3. 監控引擎 (Scanner Engine)
- 檔案：`src/lib/scanner-engine.ts`
- 修改：
  - **商品型態快取**：要過濾日夜盤，引擎必須知道該商品的 `security_type`。我們新增了 `targetSecTypes` 這個 Map，在策略啟動與 `ensureContract` 時將 `security_type` 儲存下來。
  - **Tick 層級即時過濾**：
    在 `onAnyTick` 迴圈中，取出該 Tick 的秒數並使用 `isDaySessionTick` 判斷是否為日盤。如果策略設定為 `day` 但當下收到的是夜盤 Tick，或設定為 `night` 但收到的是日盤 Tick，則直接跳過觸發判斷。
  - **K 棒過濾 (僅日盤)**：
    對於需要計算均線 (MA) 或 KD 等技術指標的策略，若設定為 `day` (僅日盤)，則在將最新 K 棒傳入 `aggregate()` 前，先使用 `filterDaySession()` 將夜盤與盤外時段的 K 棒剔除。如此一來，後續計算出來的指標就完全不含夜盤資料。至於 `night` (僅夜盤) 與全盤，則直接使用所有 K 棒計算指標。

## 使用的底層工具
- `wallClockToUtc`：將字串時間轉換為 UTC 秒。
- `isDaySessionTick`：判斷特定時間的 Tick 是否屬於該商品的日盤。
- `filterDaySession`：剔除 K 棒陣列中的夜盤資料。

## 結論
透過上述架構，我們成功在既有的即時監控引擎中實作了盤別過濾，並且對於指標計算與即時觸發做出了清楚的邏輯區隔，符合使用者對於期權自動化交易的彈性要求。
