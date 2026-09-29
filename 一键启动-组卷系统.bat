@echo off
chcp 65001 >nul
title 国际课程组卷系统 - 服务端模式
cd /d "%~dp0"

echo ============================================
echo   成都智慧象留学 · 国际课程组卷系统
echo   服务端模式（数据持久化，端口 8687）
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 python，请先安装 Python 3.11+
    pause
    exit /b 1
)

start "" http://localhost:8687
python backend/app.py
pause
