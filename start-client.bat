@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js 20 或更高版本。
  pause
  exit /b 1
)
start "Voxel Link Client Server" cmd /k node tools\serve-client.mjs . 8080
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8080/?v=0.6.4
exit /b 0
