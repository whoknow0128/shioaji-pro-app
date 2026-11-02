# 策略掃描器 Telegram 推播整合與重複觸發 (Strategy Scanner Telegram Notifications & Repeat Triggers)

本文件紀錄了在 Shioaji Pro 中「策略掃描器」擴充 Telegram 推播功能以及「重複觸發」機制的實作細節與注意事項。

## 功能概述
當使用者設定的策略條件（例如：價格大於 1000、均線黃金交叉等）滿足時，系統會自動發送通知到指定的 Telegram 頻道/群組/個人機器人中。同時支援「單次觸發」與「重複觸發」：
- **單次觸發**：條件滿足一次後，該監控即停止運作（防止洗頻）。
- **重複觸發**：條件滿足發送通知後，保持監控開啟；當條件「不滿足後再度滿足」時，才會發送下一次通知。

## 環境變數設定

整合 Telegram 需要在專案根目錄的 `.env` 檔案中加入以下環境變數：

```env
VITE_TELEGRAM_BOT_TOKEN="your_bot_token_here"
VITE_TELEGRAM_CHAT_ID="your_chat_id_here"
```

> [!WARNING]
> **Vite 環境變數的坑**：
> 1. Vite 對於 `.env` 檔案的註解解析非常嚴格。絕對不要在變數的同一行後面加上 `#` 作為註解（例如 `KEY=VALUE #註解`），這會導致整個字串（包含 `#註解`）被當作變數的一部分讀取，進而造成 API 驗證失敗。
> 2. 每次修改 `.env` 檔案，**必須完全重啟開發伺服器 (`npm run dev`)** 才會生效。

## 架構與實作細節

### 1. Telegram 發送邏輯 (`src/lib/telegram-notifier.ts`)
透過呼叫 Telegram Bot API 的 `sendMessage` 端點來發送推播。
- **純文字模式**：我們刻意省略了 `parse_mode: 'Markdown'`。原因是許多台股或期貨商品代碼（例如 `TX00_M`）包含底線 `_`。在嚴格的 MarkdownV2 或 Markdown 模式下，未跳脫的底線會導致 API 回傳 `400 Bad Request` 錯誤。為確保通知穩定送達，統一使用純文字與全形括號 `【】` 進行排版。

### 2. 條件明細格式化 (`src/lib/scanner-store.ts`)
為了讓推播訊息明確告知使用者「為何觸發」，我們實作了 `formatTargetConditions` 函數：
- 遍歷策略中所有子條件。
- 自動加上 K 棒週期前綴（例如 `[1分K 價格向上突破 5MA]`）。
- 將所有條件以 ` AND ` 串接起來，最終呈現在推播訊息上。

### 3. 重複觸發機制 (`src/lib/scanner-engine.ts`)
在 `onAnyTick` 事件中，我們不希望每次報價更新時，如果條件仍滿足就瘋狂發送推播。
為此引入了邊緣觸發 (Edge-trigger) 邏輯，並透過 `targetMetState` Map 紀錄每條策略上一筆的狀態：
- **觸發條件**：`allMet === true` 且 `previouslyMet === false`。
- **重置條件**：當 `allMet === false` 時，將狀態重置。

如果使用者設定為「重複觸發 (`repeat: true`)」，我們只負責送出推播並標記 `targetMetState`，**不會**將該監控改為 `active: false`，它將繼續存活於監控迴圈中。

### 4. UI 測試與狀態管理 (`src/components/strategy-scanner-panel.tsx`)
- **測試按鈕 (鈴鐺 icon)**：可直接模擬一次推播，並會在訊息前加上 `(測試)` 字樣，方便使用者在不動用真實行情的情況下，確認 `.env` 設定是否正確。
- **重複觸發切換按鈕 (循環 icon)**：允許使用者在策略建立後，隨時切換單次/重複模式。

## 測試與驗證方式
1. 確認已設定 `.env` 且重啟伺服器。
2. 啟動服務後，至「策略掃描」面版新增任意策略。
3. 點擊清單右側的鈴鐺 (🔔) 按鈕，確認手機 Telegram 能否收到帶有 `(測試)` 標題及完整條件的通知。
4. 設定一個極易觸發的條件 (如 `價格大於 0`)，選擇「允許重複觸發」，確認真實行情觸發時：
   - 會收到第一次推播。
   - 隨後報價更新不會瘋狂推播。
   - 若將該股票價格調為不滿足，再調回滿足，則能收到第二次推播。
