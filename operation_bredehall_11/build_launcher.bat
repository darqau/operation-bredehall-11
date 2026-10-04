@echo off
title Bygg Start Bredehall.exe
cd /d "%~dp0"

py -3.10 -m pip install pyinstaller --quiet
py -3.10 -m PyInstaller --onefile --console --clean ^
  --name "Start Bredehall" ^
  --distpath . ^
  --specpath build ^
  --workpath build ^
  launch.py

if exist "Start Bredehall.exe" (
  echo.
  echo Klar: Start Bredehall.exe
) else (
  echo Bygget misslyckades.
)
pause
