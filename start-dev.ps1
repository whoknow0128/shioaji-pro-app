# Shioaji Pro App — 一鍵啟動開發服務腳本 (Windows PowerShell)
$ErrorActionPreference = "Stop"
if ($PSScriptRoot) { Set-Location $PSScriptRoot } else { Set-Location (Get-Location) }
$ScriptDir = (Get-Location).Path

$ApiPort = 21322
$WebPort = 5173
$HealthUrl = "http://127.0.0.1:$ApiPort/api/v1/health"
$WebUrl = "http://127.0.0.1:$WebPort/"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Shioaji Pro App 服務啟動程序" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. 檢查並啟動 Shioaji API Server (Port 21322)
$needStart = $true
$apiProc = Get-Process -Name "shioaji*" -ErrorAction SilentlyContinue
if ($apiProc) {
    $existingPid = ($apiProc | Select-Object -First 1).Id
    try {
        $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3 -ErrorAction Stop
        if ($health.status -eq "healthy" -and -not $health.token_stale) {
            Write-Host "[✓] Shioaji API Server 已在 127.0.0.1:$ApiPort 健康運行中 (PID: $existingPid)" -ForegroundColor Green
            $needStart = $false
        } else {
            Write-Host "[!] 偵測到舊的 Shioaji API Server 狀態異常或 Token 已過期 (PID: $existingPid)，正在重新啟動..." -ForegroundColor Yellow
            $apiProc | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
    } catch {
        Write-Host "[!] 偵測到 Shioaji API Server 健康檢查失敗 (PID: $existingPid)，正在終止並重新啟動..." -ForegroundColor Yellow
        $apiProc | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

if ($needStart) {
    Write-Host "[*] 正在啟動 Shioaji API Server (127.0.0.1:$ApiPort)..." -ForegroundColor Yellow
    $env:SJ_BIND_ADDR = "127.0.0.1:$ApiPort"
    $env:SJ_HTTP_ADDR = "127.0.0.1:$ApiPort"
    Start-Process -FilePath "shioaji" -ArgumentList "server", "start", "--no-open" -WorkingDirectory $ScriptDir -WindowStyle Minimized

    # 等待 API Server 就緒且健康 (最多等待 20 秒)
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2 -ErrorAction Stop
            if ($health.status -eq "healthy") {
                $ready = $true
                break
            }
        } catch {
            # 繼續等待
        }
    }

    if ($ready) {
        Write-Host "[✓] Shioaji API Server 啟動成功且連線健康！" -ForegroundColor Green
    } else {
        Write-Host "[!] Shioaji API Server 尚未就緒或健康檢查未通過，請檢查 .env 憑證與金鑰設定。" -ForegroundColor Red
    }
}

# 2. 檢查並啟動前端 Vite 開發伺服器 (Port 5173)
$webListening = Get-NetTCPConnection -LocalPort $WebPort -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 }
if ($webListening) {
    $webPid = ($webListening | Select-Object -First 1).OwningProcess
    Write-Host "[✓] 前端 Vite 伺服器已在 $WebUrl 運行中 (PID: $webPid)" -ForegroundColor Green
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
