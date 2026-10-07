package com.lanmora.app.media

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.*
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.lanmora.app.ui.theme.LanmoraTheme
import java.io.File

class VideoNoteActivity : ComponentActivity() {
    companion object {
        const val EXTRA_PATH = "video_path"
    }

    private var videoCapture: VideoCapture<Recorder>? = null
    private var recording: Recording? = null
    private var currentFile: File? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            LanmoraTheme {
                VideoNoteScreen()
            }
        }
    }

    @Composable
    private fun VideoNoteScreen() {
        var isRecording by remember { mutableStateOf(false) }
        val context = LocalContext.current

        Surface(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                AndroidView(
                    factory = {
                        PreviewView(it).also(::bindCamera)
                    },
                    modifier = Modifier
                        .size(320.dp)
                        .clip(CircleShape)
                )

                IconButton(
                    onClick = {
                        val active = recording
                        if (active != null) {
                            active.stop()
                        } else {
                            finish()
                        }
                    },
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(20.dp)
                ) {
                    Icon(Icons.Default.Close, contentDescription = null)
                }

                FilledIconButton(
                    onClick = {
                        if (isRecording) {
                            recording?.stop()
                            isRecording = false
                        } else {
                            startRecording()
                            isRecording = true
                        }
                    },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 52.dp)
                        .size(72.dp)
                ) {
                    Icon(
                        if (isRecording) Icons.Default.Stop else Icons.Default.FiberManualRecord,
                        contentDescription = null,
                        modifier = Modifier.size(38.dp)
                    )
                }
            }
        }
    }

    private fun bindCamera(previewView: PreviewView) {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val recorder = Recorder.Builder()
                .setQualitySelector(
                    QualitySelector.from(
                        Quality.SD,
                        FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)
                    )
                )
                .build()
            val capture = VideoCapture.withOutput(recorder)
            videoCapture = capture

            provider.unbindAll()
            val selector = if (provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
                CameraSelector.DEFAULT_FRONT_CAMERA
            } else CameraSelector.DEFAULT_BACK_CAMERA
            provider.bindToLifecycle(this, selector, preview, capture)
        }, ContextCompat.getMainExecutor(this))
    }

    private fun startRecording() {
        val capture = videoCapture ?: return
        val folder = File(filesDir, "sent/video").apply { mkdirs() }
        val file = File(folder, "video-${System.currentTimeMillis()}.mp4")
        currentFile = file

        var pending = capture.output.prepareRecording(
            this,
            FileOutputOptions.Builder(file).build()
        )

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            pending = pending.withAudioEnabled()
        }

        recording = pending.start(ContextCompat.getMainExecutor(this)) { event ->
            if (event is VideoRecordEvent.Finalize) {
                recording = null
                if (!event.hasError() && file.exists() && file.length() > 0) {
                    setResult(
                        RESULT_OK,
                        Intent().putExtra(EXTRA_PATH, file.absolutePath)
                    )
                } else {
                    file.delete()
                    setResult(RESULT_CANCELED)
                }
                finish()
            }
        }
    }

    override fun onDestroy() {
        runCatching { recording?.close() }
        recording = null
        super.onDestroy()
    }
}
