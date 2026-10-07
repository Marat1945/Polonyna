package com.lanmora.app

import android.app.Application

class LanmoraApplication : Application() {
    lateinit var controller: AppController
        private set

    override fun onCreate() {
        super.onCreate()
        controller = AppController(this)
    }
}
