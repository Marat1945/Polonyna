$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "POLONYNA - загрузка полного проекта в GitHub" -ForegroundColor Cyan
Write-Host "Будет заменена ветка main репозитория Marat1945/Polonyna." -ForegroundColor Yellow
$answer = Read-Host "Введите YES для продолжения"
if ($answer -ne "YES") { Write-Host "Отменено."; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git не найден. Установите Git for Windows: https://git-scm.com/download/win" -ForegroundColor Red
    exit 2
}

if (Test-Path ".git") { Remove-Item ".git" -Recurse -Force }

git init
git config user.name "Marat1945"
git config user.email "marat1945@users.noreply.github.com"
git add -A
git commit -m "Polonyna complete Android project"
git branch -M main
git remote add origin "https://github.com/Marat1945/Polonyna.git"
git push -u origin main --force

Start-Process "https://github.com/Marat1945/Polonyna/actions"
Write-Host "Готово." -ForegroundColor Green
Read-Host "Нажмите Enter"
