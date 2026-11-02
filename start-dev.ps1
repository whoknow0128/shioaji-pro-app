# Shioaji Pro App — 一鍵啟動開發服務腳本 (Windows PowerShell)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ApiPort = 21322
$WebPort = 5173
$ApiUrl = "http://127.0.0.1:$ApiPort/api/v1/info"
$WebUrl = "http://127.0.0.1:$WebPort/"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Shioaji Pro App 服務啟動程序" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. 檢查並啟動 Shioaji API Server (Port 21322)
$apiListening = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
if ($apiListening) {
    Write-Host "[✓] Shioaji API Server 已在 127.0.0.1:$ApiPort 運行中 (PID: $($apiListening[0].OwningProcess))" -ForegroundColor Green
} else {
    Write-Host "[*] 正在啟動 Shioaji API Server (127.0.0.1:$ApiPort)..." -ForegroundColor Yellow
    $env:SJ_HTTP_ADDR = "127.0.0.1:$ApiPort"
    Start-Process -FilePath "shioaji" -ArgumentList "server", "start", "--no-open" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized

    # 等待 API Server 就緒 (最多等待 15 秒)
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $null = Invoke-RestMethod -Uri $ApiUrl -TimeoutSec 1 -ErrorAction Stop
            $ready = $true
            break
        } catch {
            # 繼續等待
        }
    }

    if ($ready) {
        Write-Host "[✓] Shioaji API Server 啟動成功！" -ForegroundColor Green
    } else {
        Write-Host "[!] Shioaji API Server 尚未回應，請檢查 .env 憑證與金鑰設定。" -ForegroundColor Red
    }
}

# 2. 檢查並啟動前端 Vite 開發伺服器 (Port 5173)
$webListening = Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue
if ($webListening) {
    Write-Host "[✓] 前端 Vite 伺服器已在 $WebUrl 運行中 (PID: $($webListening[0].OwningProcess))" -ForegroundColor Green
    Write-Host "[*] 正在開啟瀏覽器: $WebUrl" -ForegroundColor Cyan
    Start-Process $WebUrl
} else {
    Write-Host "[*] 正在啟動前端 Vite 開發伺服器 ($WebUrl)..." -ForegroundColor Yellow
    # 延遲 2 秒後自動打開瀏覽器
    Start-Job -ScriptBlock {
        param($url)
        Start-Sleep -Seconds 2
        Start-Process $url
    } -ArgumentList $WebUrl | Out-Null

    # 在當前視窗執行 pnpm dev (按 Ctrl+C 可停止前端)
    pnpm dev
}
