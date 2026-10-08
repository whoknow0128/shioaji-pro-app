# CA 憑證設定指南

在正式環境下（Production Mode），Shioaji Pro 需要載入有效的永豐金證券 CA 憑證 (`.pfx`) 才能進行實單交易。

## 設定步驟

1. 取得您的憑證檔案（通常命名為 `Sinopac.pfx` 或是您的身分證字號 `.pfx`）。
2. 將憑證檔案**複製到本專案的根目錄**（與 `package.json` 同層）。
3. 建立或修改專案根目錄的 `.env` 檔案，填入以下內容：

```env
SJ_CA_PATH=Sinopac.pfx
SJ_CA_PASSWD=您的憑證密碼(通常是身分證字號)
```

## 常見問題與除錯 (Troubleshooting)

### 1. `CA not activated for: <ID>` (HTTP 400)
如果您在下單時遇到此錯誤，代表後台連線程式（sidecar）未能成功載入您的 CA 憑證。

### 2. `os error 3` (系統找不到指定的路徑)
如果您在連線程式的日誌中看到：
`Failed to activate CA certificate: CA error: ReadFile Error 系統找不到指定的路徑。 (os error 3)`

**原因**：
這是 Windows 環境下非常常見的**中文編碼問題**。如果您將 CA 憑證放在帶有中文字的路徑下（例如 `C:\Users\username\OneDrive\桌面\Sinopac.pfx`），在 `.env` 檔案儲存時若未採用 UTF-8 編碼，中文字元（如「桌面」）會變成亂碼（例如 `????`）。連線程式讀取到亂碼路徑就會報錯。

**解決方案**：
**不要在 `.env` 中使用中文的絕對路徑！**
請一律將 `.pfx` 檔案複製到專案根目錄，並在 `.env` 中使用相對路徑（例如 `SJ_CA_PATH=Sinopac.pfx`），這可以 100% 避免 Windows 編碼造成的讀取失敗。

### 3. 注意事項
- **安全警告**：`.pfx` 檔案包含您的私鑰，絕對**不可以** commit 到 Git 儲存庫中。專案的 `.gitignore` 已經預設排除了 `*.pfx`。
- `.env` 檔案也同樣應被排除在版控之外。
