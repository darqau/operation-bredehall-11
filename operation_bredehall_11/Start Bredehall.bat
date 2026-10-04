@echo off
title Operation Bredehall 11
cd /d "%~dp0"

for %%P in (py -3.10 py -3.11 py -3.12 py -3.13 python python3) do (
  %%P --version >nul 2>&1 && (
    %%P launch.py
    if errorlevel 1 pause
    goto :done
  )
)

echo Hittade inte Python. Installera Python 3.10+ och kör:
echo   py -3.10 -m pip install -r requirements.txt
pause

:done
