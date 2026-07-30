Write-Host "================================================"
Write-Host "   拖延记录应用 - 远程测试模式"
Write-Host "================================================"
Write-Host ""
Write-Host "正在启动远程测试服务器..."
Write-Host "请确保您的iPhone已安装 Expo Go 应用"
Write-Host "启动后使用 Expo Go 扫描二维码即可测试"
Write-Host ""

cd $PSScriptRoot
npx expo start --tunnel --clear
