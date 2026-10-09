@echo off
chcp 65001 >nul
title Polonyna PC - upload to GitHub
cd /d "%~dp0"
set REPO=https://github.com/Marat1945/Polonyna-PC.git
echo ============================================================
echo  ПОЛОНИНА ДЛЯ ПК - ЗАГРУЗКА НА GITHUB
echo ============================================================
echo.
echo Репозиторий: %REPO%
echo Сначала создайте на GitHub ПУСТОЙ репозиторий Polonyna-PC.
echo Внимание: ветка main в нём будет заменена содержимым этой папки.
echo.
set /p ANSWER=Введите YES и нажмите Enter: 
if /I not "%ANSWER%"=="YES" (
  echo Отменено.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git не найден. Установите: https://git-scm.com/download/win
  pause
  exit /b 2
)
if exist ".git" rmdir /s /q ".git"
git init || goto :error
git config user.name "Marat1945"
git config user.email "marat1945@users.noreply.github.com"
git add -A || goto :error
git commit -m "Polonyna PC 0.1.0" || goto :error
git branch -M main
git remote add origin %REPO%
git push -u origin main --force || goto :error
echo.
echo ГОТОВО. Открываю GitHub Actions...
start "" "https://github.com/Marat1945/Polonyna-PC/actions"
pause
exit /b 0
:error
echo.
echo Загрузка не завершена. Скопируйте текст ошибки из этого окна.
pause
exit /b 10
