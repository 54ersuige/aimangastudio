@echo off
:: Wrapper for silent launch (no black console window)
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\\26_Agent_Project\\AI_comicstart.ps1" --silent
