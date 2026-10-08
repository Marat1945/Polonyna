// Версия Kotlin задана ЯВНО и должна совпадать в двух местах:
//   1) kotlin-gradle-plugin ниже (его использует встроенный Kotlin в AGP 9);
//   2) плагин org.jetbrains.kotlin.plugin.compose.
// Если версии расходятся, Compose-компилятор не подходит к компилятору Kotlin
// и сборка падает. Меняйте обе цифры только вместе.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.21")
    }
}

plugins {
    id("com.android.application") version "9.2.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.21" apply false
}
