# Shioaji Pro App 專案啟動與 AI 協同執行指南 (`feat/strategy-scanner` 分支)

本文件專為 **使用者搭配 AI 助理（Pair Programming / Agentic AI）** 共同將此專案及本分支（`feat/strategy-scanner`）順利運行所撰寫。無論是由開發者自行操作，或是直接將此文件交給 AI 讀取執行，都能快速完成環境配置、服務啟動與功能驗證。

---

## 1. 本分支特性速覽 (`feat/strategy-scanner`)

本分支在既有的 Shioaji Pro 交易終端基礎上，實作了完整的**策略監控與掃描（Strategy Scanner）**模組：
- **複合條件策略監控**：支援價格突破（大於/小於）、均線（MA 多週期交叉/突破）、KD（K/D 數值及黃金/死亡交叉）及多種 K 棒時框（1分K、5分K、60分K等）。
- **Telegram 即時推播**：當策略觸發或委託成立時，透過 Telegram Bot 即時推播訊息，支援條件明細自動格式化與測試鈴鐺按鈕（🔔）。
- **重複觸發與邊緣觸發機制 (Edge-Trigger)**：支援「單次觸發」與「重複觸發」，狀態未重置前不重複洗頻。
- **日夜盤時段過濾 (Session Filtering)**：支援全盤 (`all`)、僅日盤 (`day`)、僅夜盤 (`night`)；設定日盤時，技術指標會自動剔除夜盤 K 棒以精準反映日盤均線與指標。
- **配置自動持久化**：開發模式下，前端策略變更與版面配置會自動同步寫入 [`src/config/strategies.json`](src/config/strategies.json) 與 [`src/config/workspace.json`](src/config/workspace.json)。
- **CA 憑證支援**：實單環境支援本機相對路徑載入永豐金 CA 憑證（`.pfx`），避免 Windows 中文路徑編碼陷阱。

---

## 2. 系統架構與執行模式

Shioaji Pro 終端是由 **Web 前端 (React 19 + TypeScript + Vite)** 與 **行情/交易後端 (Shioaji Server / Sidecar)** 組成。在啟動時，前端會透過 Vite 的 Proxy 將 `/api` 請求轉發至後端。

請根據您的本機環境選擇以下**其中一種**後端模式：

### 模式 A（推薦）：搭配已安裝的「Shioaji Pro 桌面版」
- **說明**：若您電腦中已安裝並啟動了 Shioaji Pro 桌面應用程式（安裝路徑如 `C:\Program Files\Shioaji Pro\`），其內建的 sidecar (`shioaji.exe`) 已在背景監聽 `127.0.0.1:21322`。
- **優勢**：不需要手動安裝 Python 或 Shioaji CLI，直接啟動 Vite 即可連線。
- **Vite 預設轉發埠**：`http://127.0.0.1:21322`（與此模式完美契合）。

### 模式 B：獨立運行「Shioaji CLI」
- **說明**：若未安裝桌面版，可透過命令列啟動獨立的 Shioaji server。
- **預設埠號**：`http://127.0.0.1:8080`。
- **注意事項**：若使用此模式，需在 `.env` 中指定 `VITE_API_TARGET=http://127.0.0.1:8080`，讓前端代理正確指向 8080 埠。

---

## 3. 前置環境準備

在啟動前，請確認本機具備以下工具：

1. **Node.js**：版本 `>= 20.0.0`
2. **包管理器**：建議使用 `pnpm`（若無亦可使用 `npm`）
3. **Git**：確認已切換至本分支
4. **永豐金 API 金鑰**：已取得 `SJ_API_KEY` 與 `SJ_SEC_KEY`（在[永豐金證券 API 管理頁](https://www.sinotrade.com.tw/newweb/PythonAPIKey/)申請）

---

## 4. 環境變數設定 (`.env`) 與防坑守則

在專案根目錄下建立或編輯 [`.env`](.env) 檔案：

```env
# ── 1. Shioaji API 帳號金鑰 (必填) ──
SJ_API_KEY=your_api_key_here
SJ_SEC_KEY=your_secret_key_here

# ── 2. 交易環境模式 ──
# 預設為模擬交易 (紙上交易)，不會動用真實資金。
# 若要進入正式環境實單交易，請取消註解並設為 true (需搭配下方 CA 憑證)
# SJ_PRODUCTION=true

# ── 3. CA 憑證設定 (正式環境才需要) ──
# 注意：請將 Sinopac.pfx 複製到本專案根目錄，使用相對路徑，切勿使用含中文字元的絕對路徑！
# SJ_CA_PATH=Sinopac.pfx
# SJ_CA_PASSWD=your_ca_password_here

# ── 4. 前端代理後端目標 (選填) ──
# 模式 A（桌面版 sidecar，預設 21322）：保持預設即可，不需設定此變數
# 模式 B（獨立 CLI，8080 埠）：請設定為 http://127.0.0.1:8080
# VITE_API_TARGET=http://127.0.0.1:8080

# ── 5. Telegram 推播通知 (選填，策略掃描與下單通知) ──
# 填入您的 Telegram Bot Token 與 Chat ID
VITE_TG_BOT_TOKEN=your_telegram_bot_token_here
VITE_TG_CHAT_ID=your_telegram_chat_id_here
```

### ⚠️ 重要避坑指南 (Critical Notes)
1. **切勿在變數同一行後方加註解**：
   - ❌ 錯誤：`VITE_TG_CHAT_ID=123456 # 我的ChatID`（Vite 會將 `# 我的ChatID` 視為字串的一部分讀入，導致 Telegram API 報錯 400）。
   - ✅ 正確：註解請獨立成行，或不加註解。
2. **修改 `.env` 必須重啟前端**：
   - Vite 僅在開發伺服器啟動時讀取 `.env`。修改後請務必將終端機中運行的 `pnpm dev` 停止 (Ctrl+C) 並重新執行。
3. **CA 憑證 Windows 編碼問題 (`os error 3`)**：
   - 如果遇到 `ReadFile Error 系統找不到指定的路徑 (os error 3)`，通常是因為憑證放置於含中文字的路徑（如桌面或使用者名稱為中文）。**請務必把 `.pfx` 檔案複製至本專案根目錄，並在 `.env` 中使用檔名相對路徑**（如 `SJ_CA_PATH=Sinopac.pfx`）。

---

## 5. 逐步啟動流程

### 步驟 1：檢驗分支與安裝相依套件

在專案根目錄開啟終端機（PowerShell 或 Bash）：

```bash
# 1. 確認當前分支為 feat/strategy-scanner
git branch --show-current

# 2. 安裝前端依賴
pnpm install
```

### 步驟 2：確認並啟動後端服務

#### 情境 A：使用 Shioaji Pro 桌面版（推薦）
1. 開啟電腦上的「Shioaji Pro」桌面程式。
2. 檢查 `21322` 埠是否正常聆聽：
   - **PowerShell**:
     ```powershell
     Get-NetTCPConnection -LocalPort 21322 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State
     ```
   - **Bash / Linux / macOS**:
     ```bash
     curl -s http://127.0.0.1:21322/api/v1/info
     ```
   若回傳 JSON 資訊（含 `version`），表示後端已就緒。

#### 情境 B：使用 Shioaji CLI
1. 安裝 CLI（若尚未安裝）：
   ```bash
   uv tool install shioaji
   ```
2. 啟動伺服器：
   ```bash
   # 模擬環境啟動（預設 8080 埠）
   shioaji server start
   
   # 確認伺服器狀態
   shioaji server check
   ```
3. 確認 `.env` 已設定 `VITE_API_TARGET=http://127.0.0.1:8080`。

### 步驟 3：啟動前端開發伺服器

執行以下指令啟動 Vite：

```bash
pnpm dev
```

終端機將輸出：
```
  VITE v8.x.x  ready in ... ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### 步驟 4：開啟瀏覽器並驗證連線

1. 打開瀏覽器訪問：[http://localhost:5173](http://localhost:5173)
2. **驗證連線指標**：
   - 頁面頂端應顯示連線狀態、帳號資訊或「模擬環境」/「正式環境」徽章。
   - 自選清單中的商品報價有即時閃爍或行情串流。

---

## 6. 本分支特有功能操作手冊 (`feat/strategy-scanner`)

### 1. 開啟「策略監控」面板
- 本分支的 [`src/config/workspace.json`](src/config/workspace.json) 預設已載入策略監控面板。
- 若畫面未出現，可點擊頂端列的 **「+ 新增面板」 ➔ 「工具」 ➔ 「策略監控」**。

### 2. 測試 Telegram 即時推播 (🔔 鈴鐺按鈕)
1. 確保 `.env` 中已填入 `VITE_TG_BOT_TOKEN` 與 `VITE_TG_CHAT_ID`，且已重啟 Vite。
2. 在「策略監控」面板中，每一筆策略右側皆有一個 **🔔 鈴鐺圖示**。
3. 點擊鈴鐺，系統會立即發送一則包含 `(測試)` 的推播訊息至您的 Telegram。
4. 檢查手機/電腦上的 Telegram 是否收到訊息，確認推播管道完全通暢。

### 3. 設定監控策略與觸發條件
1. **輸入商品代號**：例如台指期近月合約 `TXFR1`、微型台指期 `TMFR1` 或個股 `2330`。
2. **新增子條件**：
   - 支援條件：價格大於/小於、均線 (MA) 向上突破/向下突破/大於/小於、KD (K值/D值) 交叉或閥值。
   - 設定時框 (Timeframe)：1分K、5分K、15分K、60分K、日K 等。
   - 點擊「+ 加入條件」，支援複數條件 (AND 串聯)。
3. **選擇時段 (Session)**：
   - **全盤 (`all`)**：全天候監控。
   - **僅日盤 (`day`)**：僅在 08:45–13:45 監控，且在計算均線與指標時會自動剔除夜盤 K 棒，適合純日盤交易者。
   - **僅夜盤 (`night`)**：僅在夜盤時段監控與觸發。
4. **設定重複觸發 (Repeat)**：
   - 點擊循環圖示 (Repeat) 可切換單次/重複模式。
   - **單次模式**：條件滿足觸發一次後自動停止監控（防止重複操作）。
   - **重複模式**：條件滿足送出通知後維持監控，當行情脫離條件後再度滿足才會送出下一筆通知（Edge-Trigger 防止洗頻）。
5. **儲存與啟動**：
   - 點擊建立策略，策略將自動儲存至 LocalStorage，並在開發模式下自動同步寫回 [`src/config/strategies.json`](src/config/strategies.json)。

---

## 7. 與 AI 協同開發：速查 Prompt 範本

當您搭配 AI Agent (例如 Antigravity, Claude, ChatGPT 等) 進行開發或排查時，可直接複製以下 Prompt 讓 AI 快速執行指令：

### Prompt 範本 1：服務狀態與埠號檢查
> **給 AI 的指令：**
> 「請幫我檢查本機的 Shioaji 後端與 Vite 運行狀態。請檢查 21322、8080 與 5173 埠號是否正常監聽，並透過 curl 驗證 /api/v1/info 的回應。」

### Prompt 範本 2：環境變數與 Telegram 測試驗證
> **給 AI 的指令：**
> 「請檢查專案目錄下的 .env 檔案是否包含 VITE_TG_BOT_TOKEN 與 VITE_TG_CHAT_ID，確認沒有同行註解造成的解析錯誤，並確認目前 Vite 是否已載入該環境變數。」

### Prompt 範本 3：自動啟動專案
> **給 AI 的指令：**
> 「請確認目前處於 feat/strategy-scanner 分支，檢查 pnpm 依賴是否完整，確認後端 sidecar (21322 或 8080) 正在運行後，幫我啟動 pnpm dev 開發伺服器。」

### Prompt 範本 4：錯誤排查與日誌分析
> **給 AI 的指令：**
> 「目前前端遇到下單失敗或 API 502/403 錯誤，請幫我檢查 Vite 終端日誌、後端 server 回應，以及 CA 憑證設定是否符合 docs/CA_SETUP.md 的規範。」

---

## 8. 常見問題與故障排除 (Troubleshooting FAQ)

| 問題現象 | 常見原因 | 排除步驟 |
| :--- | :--- | :--- |
| **網頁打開空白或 API 502 Bad Gateway** | 後端 sidecar 未啟動，或 Vite Proxy 指向錯誤埠號 | 1. 確認 Shioaji Pro 桌面版已開啟或 CLI 已執行 `shioaji server start`。<br>2. 若使用 CLI 8080 埠，請在 `.env` 加入 `VITE_API_TARGET=http://127.0.0.1:8080` 並重啟 Vite。 |
| **Telegram 點擊鈴鐺沒有反應或跳出未設定警告** | 1. 變數名稱打錯<br>2. 同行加了 `#` 註解<br>3. 修改後未重啟 Vite | 1. 確認變數名為 `VITE_TG_BOT_TOKEN` 與 `VITE_TG_CHAT_ID`。<br>2. 移除變數同一行後面的任何註解字串。<br>3. 終端機按 `Ctrl+C` 結束 Vite 並重新執行 `pnpm dev`。 |
| **實單下單報錯 `CA not activated`** | 後端未載入永豐金 CA 憑證 | 1. 將 `Sinopac.pfx` 複製到本專案根目錄。<br>2. 在 `.env` 設定 `SJ_CA_PATH=Sinopac.pfx` 與 `SJ_CA_PASSWD=憑證密碼`。<br>3. 重啟後端服務。 |
| **後端日誌出現 `os error 3 (系統找不到指定的路徑)`** | Windows 中文編碼導致絕對路徑變亂碼 | 切勿使用 `C:\Users\...\桌面\Sinopac.pfx` 等中文絕對路徑，一律改用專案根目錄相對路徑 `SJ_CA_PATH=Sinopac.pfx`。 |
| **策略建立後重整頁面不見** | LocalStorage 被清空或檔案同步未觸發 | 開發模式下儲存會自動透過 `/dev-api/save-strategies` 備份到 `src/config/strategies.json`，可檢查該檔案內容。 |
| **Vite 提示埠號 5173 已被佔用** | 先前已有 node/Vite 行程在背景運行 | 在 PowerShell 執行 `Get-Process node | Stop-Process` 清理殘留行程後重新啟動。 |

---

## 9. 相關技術文件索引
- [DEV.md](docs/DEV.md) — 專案開發、Worktree、CI 與 Review 規範
- [RELEASE.md](docs/RELEASE.md) — 發佈流程與版本號規則
- [strategy-scanner-telegram.md](docs/strategy-scanner-telegram.md) — 策略掃描器 Telegram 推播實作細節
- [strategy-scanner-session.md](docs/strategy-scanner-session.md) — 策略日夜盤時段過濾實作細節
- [CA_SETUP.md](docs/CA_SETUP.md) — 實單 CA 憑證設定指南
