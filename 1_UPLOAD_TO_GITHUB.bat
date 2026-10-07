@echo off
chcp 65001 >nul
title Polonyna - upload to GitHub
cd /d "%~dp0"

echo ============================================================
echo  POLONYNA - ЗАГРУЗКА ПОЛНОГО ПРОЕКТА В GITHUB
echo ============================================================
echo.
echo Этот скрипт отправит ВСЕ файлы, включая .github/workflows,
echo в репозиторий:
echo https://github.com/Marat1945/Polonyna.git
echo.
echo ВНИМАНИЕ: текущая ветка main в Polonyna будет заменена
echo содержимым этой папки.
echo.
set /p ANSWER=Введите YES и нажмите Enter для продолжения: 
if /I not "%ANSWER%"=="YES" (
  echo Отменено.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo ОШИБКА: Git не найден.
  echo Установите Git for Windows: https://git-scm.com/download/win
  echo После установки снова запустите этот файл.
  pause
  exit /b 2
)

if exist ".git" rmdir /s /q ".git"

git init
if errorlevel 1 goto :error

git config user.name "Marat1945"
git config user.email "marat1945@users.noreply.github.com"

git add -A
if errorlevel 1 goto :error

git commit -m "Polonyna complete Android project"
if errorlevel 1 goto :error

git branch -M main
git remote add origin https://github.com/Marat1945/Polonyna.git

echo.
echo Сейчас GitHub может открыть окно авторизации.
echo Войдите в свой аккаунт GitHub, если будет запрос.
echo.

git push -u origin main --force
if errorlevel 1 goto :error

echo.
echo ============================================================
echo ГОТОВО.
echo Теперь откройте:
echo https://github.com/Marat1945/Polonyna/actions
echo ============================================================
start "" "https://github.com/Marat1945/Polonyna/actions"
pause
exit /b 0

:error
echo.
echo Загрузка не завершена. Скопируйте текст ошибки из этого окна.
pause
exit /b 10
