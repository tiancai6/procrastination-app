@echo off
chcp 65001 >nul
title 拖延记录应用 - 远程测试模式

cd /d "%~dp0"

echo ============================================
echo   拖延记录应用 - 远程测试模式
echo ============================================
echo.

REM 检查 node 是否安装
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM 检查 package.json 是否存在
if not exist "package.json" (
    echo [错误] 未找到 package.json
    echo 当前目录: %CD%
    echo 请确认 bat 文件位于 procrastination-app 目录下
    echo.
    pause
    exit /b 1
)

REM 检查 node_modules 是否存在
if not exist "node_modules" (
    echo [提示] 未检测到依赖，正在安装依赖...
    call npm install --legacy-peer-deps
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        echo.
        pause
        exit /b 1
    )
    echo.
)

echo 正在启动远程测试服务器...
echo 请确保您的iPhone已安装 Expo Go 应用
echo 启动后使用 Expo Go 扫描二维码即可测试
echo.
echo 提示: 首次使用 --tunnel 模式可能需要登录 Expo 账号
echo        如提示登录，请按提示在浏览器完成授权
echo.

call npx expo start --tunnel --clear

echo.
echo ============================================
echo 服务器已停止
echo ============================================
pause
