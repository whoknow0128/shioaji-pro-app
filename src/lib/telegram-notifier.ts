import { onNotice } from './trade';

export function initTelegramNotifier() {
    onNotice((n) => {
        // 過濾只推播「雷達警示」或「委託下單」相關的通知
        if (n.title.includes('策略') || n.title.includes('委託') || n.title.includes('下單')) {
            // 從 .env 設定檔中讀取環境變數 (加上 VITE_ 前綴才能在前端使用)
            const token = import.meta.env.VITE_TG_BOT_TOKEN;
            const chatId = import.meta.env.VITE_TG_CHAT_ID;
            
            console.log('【Telegram Debug】準備發送通知:', n.title);
            console.log('【Telegram Debug】讀取到的 Token:', token ? '已設定' : '未設定 (undefined)');
            console.log('【Telegram Debug】讀取到的 ChatID:', chatId ? '已設定' : '未設定 (undefined)');

            // 只有當設定檔有填寫 Token 與 ChatID 時才發送
            if (token && chatId) {
                const icon = n.kind === 'err' ? '❌' : n.kind === 'ok' ? '✅' : '🔔';
                sendToTelegram(token, chatId, `${icon} 【${n.title}】\n${n.body || ''}`);
            } else {
                console.warn('【Telegram Debug】因為 Token 或 ChatID 未設定，因此跳過發送！(請確認 npm run dev 有重開)');
            }
        }
    });
}

async function sendToTelegram(token: string, chatId: string, text: string) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
        if (!res.ok) {
            const err = await res.text();
            console.error('Telegram API 拒絕了推播要求:', err);
        }
    } catch (e) {
        console.error('Telegram 推播網路錯誤:', e);
    }
}
