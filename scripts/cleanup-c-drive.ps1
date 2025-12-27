# Cleanup Script for Old C Drive Caches
# Deletes old npm and pnpm caches from C: users directory
# PRE-REQUISITE: Ensure you have successfully moved your cache config to F: drive before running this.

$NpmCachePath = "C:\Users\93152\AppData\Local\npm-cache"
$PnpmCachePath = "C:\Users\93152\AppData\Local\pnpm"

Write-Host "⚠️  注意: 此脚本将会永久删除 C 盘的旧 npm 和 pnpm 缓存文件。" -ForegroundColor Yellow
Write-Host "⚠️  请确保您已经将 npm/pnpm 配置迁移到了新盘符 (F:)。" -ForegroundColor Yellow
Write-Host ""

$confirmation = Read-Host "确认删除吗? (y/n)"
if ($confirmation -ne 'y') { exit }

# 1. Remove npm cache
if (Test-Path $NpmCachePath) {
    Write-Host "🗑️  正在删除旧 npm 缓存: $NpmCachePath ..."
    Remove-Item -Recurse -Force $NpmCachePath -ErrorAction SilentlyContinue
    Write-Host "✅ npm 缓存已删除" -ForegroundColor Green
} else {
    Write-Host "ℹ️  npm 缓存路径不存在，跳过。"
}

# 2. Remove pnpm cache
if (Test-Path $PnpmCachePath) {
    Write-Host "🗑️  正在删除旧 pnpm 缓存: $PnpmCachePath ..."
    Remove-Item -Recurse -Force $PnpmCachePath -ErrorAction SilentlyContinue
    Write-Host "✅ pnpm 缓存已删除" -ForegroundColor Green
} else {
    Write-Host "ℹ️  pnpm 缓存路径不存在，跳过。"
}

Write-Host ""
Write-Host "🎉 清理完成！C 盘空间已释放。" -ForegroundColor Green
Write-Host "你可以按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
