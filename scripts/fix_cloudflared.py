#!/usr/bin/env python3
import subprocess, os, time, sys

def run(cmd, **kw):
    return subprocess.run(cmd, text=True, capture_output=True, **kw)

# Find cloudflared and Windows username
cf_win = run(['where.exe', 'cloudflared']).stdout.strip().split('\n')[0].strip()
win_user = run(['cmd.exe', '/c', 'echo %USERNAME%']).stdout.strip()

print(f"cloudflared: {cf_win}")
print(f"user: {win_user}")

if not cf_win:
    print("ERROR: cloudflared not found")
    sys.exit(1)

# Write Task Scheduler setup script
ps1_content = f"""$a = New-ScheduledTaskAction -Execute '{cf_win}' -Argument 'tunnel run'
$t = New-ScheduledTaskTrigger -AtLogOn
$s = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'CloudflaredAuto' -Action $a -Trigger $t -Settings $s -RunLevel Highest -Force
Start-ScheduledTask -TaskName 'CloudflaredAuto'
"""

ps1_path = f'/mnt/c/Users/{win_user}/setup_cf_task.ps1'
with open(ps1_path, 'w', newline='\r\n') as f:
    f.write(ps1_content)

print("Task Schedulerに登録中... (UACが出たら「はい」)")
subprocess.run([
    'powershell.exe', '-Command',
    f"Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File C:\\Users\\{win_user}\\setup_cf_task.ps1' -Wait"
])

time.sleep(5)

# Check result
result = run(['tasklist.exe'])
if 'cloudflared' in result.stdout.lower():
    print("OK: cloudflared起動確認")
else:
    print("Task Scheduler失敗。nohupで起動します...")
    cf_wsl = run(['wslpath', cf_win]).stdout.strip()
    os.system(f'nohup bash -c "while true; do \\"{cf_wsl}\\" tunnel run; sleep 10; done" > ~/cf.log 2>&1 &')
    time.sleep(3)
    result2 = run(['tasklist.exe'])
    if 'cloudflared' in result2.stdout.lower():
        print("OK: cloudflaredをバックグラウンドで起動しました")
    else:
        print("ERROR: 起動失敗")
        sys.exit(1)

print("\n完了! https://sys.yskmail.jp を確認してください")
