#!/bin/bash
# Cloudflare Tunnel 自動起動セットアップ
set -e

WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r\n')
CF_WIN=$(where.exe cloudflared 2>/dev/null | tr -d '\r\n')
STARTUP="/mnt/c/Users/${WIN_USER}/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup"
CONFIG="C:\\Users\\${WIN_USER}\\.cloudflared\\config.yml"
PS1_PATH="/mnt/c/Users/${WIN_USER}/cf.ps1"
VBS_PATH="/mnt/c/Users/${WIN_USER}/cf.vbs"

echo "Windows User: $WIN_USER"
echo "cloudflared: $CF_WIN"

# cf.ps1 作成
cat > "$PS1_PATH" << PSEOF
\$cf = (& where.exe cloudflared).Trim()
\$config = "${CONFIG}"
while (\$true) {
    & \$cf tunnel --config \$config run
    Start-Sleep -Seconds 10
}
PSEOF

# cf.vbs 作成
cat > "$VBS_PATH" << VBEOF
Set ws = CreateObject("WScript.Shell")
ws.Run "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\\${WIN_USER}\cf.ps1", 0, False
VBEOF

# スタートアップフォルダにコピー
cp "$VBS_PATH" "$STARTUP/"
echo "スタートアップフォルダに登録しました"

# 既存のcloudflaredを停止
taskkill.exe /F /IM cloudflared.exe 2>/dev/null || true

# 起動
cmd.exe /c "wscript.exe \"C:\\Users\\${WIN_USER}\\cf.vbs\""
echo "cloudflared を起動しました"

sleep 5
tasklist.exe | grep -i cloudflared && echo "起動確認OK" || echo "起動失敗"
