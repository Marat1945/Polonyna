# ГОТОВО К ЗАГРУЗКЕ В GITHUB

В этом комплекте уже исправлен GitHub Actions workflow.

## Что делать

1. Распакуйте ZIP.
2. Откройте папку Lanmora.
3. Загрузите ВСЁ содержимое папки в корень вашего GitHub-репозитория.
4. Обязательно должна попасть скрытая папка:
   `.github/workflows/android.yml`
5. Подтвердите Commit changes.
6. Откройте GitHub → Actions → Build Android APK.
7. Если автоматический запуск уже начался — дождитесь результата.
   Иначе нажмите Run workflow.
8. При успешной сборке откройте запуск → Artifacts → Lanmora-debug-apk.
9. Внутри ZIP-артефакта будет `app-debug.apk`.

## Что исправлено

- android-actions/setup-android обновлён до v4.
- Убран запрос удалённого Android SDK package `tools`.
- Явно устанавливается `platform-tools`.
- JDK action обновлён.
- Checkout action обновлён.
- Устанавливаются Android API 37 и Build Tools 36.0.0.
- Gradle 9.4.1.
- APK автоматически публикуется как GitHub Actions artifact.

Если сборка снова упадёт, это уже будет отдельная ошибка проекта/зависимостей.
Откройте красный шаг Build debug APK и сохраните последние строки лога.
