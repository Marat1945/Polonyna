package com.polonyna.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.compose.ui.platform.ComposeView
import com.polonyna.app.ui.PolonynaRoot
import com.polonyna.app.ui.theme.PolonynaTheme

class MainActivity : AppCompatActivity() {
    private val controller by lazy {
        (application as PolonynaApplication).controller
    }

    private val networkPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            controller.start()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContentView(
            ComposeView(this).apply {
                setContent {
                    PolonynaTheme {
                        PolonynaRoot(controller)
                    }
                }
            }
        )

        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 37) {
            val localNetwork = "android.permission.ACCESS_LOCAL_NETWORK"
            if (ContextCompat.checkSelfPermission(this, localNetwork) != PackageManager.PERMISSION_GRANTED) {
                needed += localNetwork
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.NEARBY_WIFI_DEVICES
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                needed += Manifest.permission.NEARBY_WIFI_DEVICES
            }
        }

        if (needed.isEmpty()) controller.start()
        else networkPermissionLauncher.launch(needed.toTypedArray())
    }
}
