# NAS同期スクリプト
# WSLのnas_outputフォルダからNAS（Z:ドライブ）へ同期する
# タスクスケジューラで1分ごとに実行してください

$source = "\\wsl$\Ubuntu\home\pc\nas_output"
$dest   = "Z:\emailsys\automation"

if (-not (Test-Path $source)) {
    Write-Host "同期元が見つかりません: $source"
    exit 1
}

if (-not (Test-Path $dest)) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
}

robocopy $source $dest /E /COPYALL /NJH /NJS /NDL /NC /NS
Write-Host "同期完了: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
