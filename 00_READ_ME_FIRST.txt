POLONYNA — ГОТОВЫЙ ПОЛНЫЙ ПРОЕКТ
==================================

СТАРЫЕ АРХИВЫ БОЛЬШЕ НЕ ИСПОЛЬЗУЙТЕ.

Самый простой вариант загрузки без потери папки .github:

1. Распакуйте ZIP полностью.
2. Откройте папку Polonyna_COMPLETE.
3. Дважды нажмите 1_UPLOAD_TO_GITHUB.bat
4. Введите YES.
5. Если GitHub попросит войти — войдите.
6. После загрузки браузер откроет GitHub Actions.
7. Дождитесь Build Android APK.
8. Если сборка зелёная:
   Actions → запуск → Artifacts → Polonyna-debug-apk.
9. Внутри скачанного artifact будет app-debug.apk.

Почему этот вариант лучше браузерной загрузки:
git add -A гарантированно добавляет .github/workflows/android.yml.
Никакая скрытая папка не потеряется.

ВАЖНО:
Скрипт использует --force и заменяет текущую ветку main репозитория
https://github.com/Marat1945/Polonyna
содержимым этого комплекта.

Если на компьютере нет Git:
https://git-scm.com/download/win
После установки снова запустите 1_UPLOAD_TO_GITHUB.bat.

ТЕХНИЧЕСКИЙ СТАТУС:
- Android 6+ (minSdk 23)
- compileSdk/targetSdk 36 для стабильной сборки
- приложение продолжает запускаться на Android 17 как обычное Android-приложение
- Java 17
- Gradle 9.4.1
- AGP 9.2.0
- GitHub Actions использует setup-android@v4
- 4 языка: українська, русский, Polski, English
