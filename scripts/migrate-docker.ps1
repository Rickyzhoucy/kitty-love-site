# Docker Data Migration Script
# Migrates Docker WSL data from C: to F:\DevData\Docker

$TargetDir = "F:\DevData\Docker"
$BackupFile = "F:\DevData\docker-desktop-data.tar"
$NotDefaultDataParams = $False

Write-Host "⚠️  注意: 此脚本将会停止 Docker Desktop 并移动所有镜像和容器数据。" -ForegroundColor Yellow
Write-Host "⚠️  目标路径: $TargetDir" -ForegroundColor Yellow
$confirmation = Read-Host "是否继续? (y/n)"
if ($confirmation -ne 'y') { exit }

# 1. Ensure Target Directory Exists
if (!(Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir | Out-Null
    Write-Host "✅ 创建目录 $TargetDir" -ForegroundColor Green
}

# 2. Stop Docker Desktop
Write-Host "⏳ 正在停止 Docker Desktop..."
& "C:\Program Files\Docker\Docker\DockerCli.exe" -SwitchDaemon
Stop-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
Stop-Process -Name "com.docker.backend" -ErrorAction SilentlyContinue
Stop-Process -Name "com.docker.proxy" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5
wsl --shutdown
Write-Host "✅ Docker Desktop 已停止" -ForegroundColor Green

# 3. Export Data
Write-Host "⏳ 正在导出 Docker 数据 (这可能需要几分钟)..."
if (Test-Path $BackupFile) { Remove-Item $BackupFile }

# Check if docker-desktop-data exists
$wslList = wsl --list --quiet
if ($wslList -match "docker-desktop-data") {
    wsl --export docker-desktop-data $BackupFile
    Write-Host "✅ 数据导出完成: $BackupFile" -ForegroundColor Green
} else {
    Write-Error "❌ 未找到 docker-desktop-data 发行版，无法迁移。"
    exit
}

# 4. Unregister Old Data
Write-Host "⏳ 正在注销旧数据..."
wsl --unregister docker-desktop-data
Write-Host "✅ 旧数据已清除" -ForegroundColor Green

# 5. Import to New Location
Write-Host "⏳ 正在导入数据到新位置..."
wsl --import docker-desktop-data $TargetDir $BackupFile --version 2
Write-Host "✅ 数据导入完成" -ForegroundColor Green

# 6. Cleanup
Write-Host "🧹 清理临时备份文件..."
Remove-Item $BackupFile
Write-Host "✅ 备份文件已删除" -ForegroundColor Green

Write-Host ""
Write-Host "🎉 迁移成功！" -ForegroundColor Green
Write-Host "请手动重新启动 Docker Desktop。"
