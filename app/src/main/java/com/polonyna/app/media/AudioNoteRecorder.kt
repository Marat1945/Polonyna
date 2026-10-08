package com.polonyna.app.media

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

class AudioNoteRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var output: File? = null

    fun start(): File {
        stopSilently()

        val folder = File(context.filesDir, "sent/audio").apply { mkdirs() }
        val file = File(folder, "voice-${System.currentTimeMillis()}.m4a")

        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }

        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioSamplingRate(44_100)
        r.setAudioEncodingBitRate(96_000)
        r.setMaxDuration(5 * 60 * 1000)
        r.setOutputFile(file.absolutePath)
        r.prepare()
        r.start()

        recorder = r
        output = file
        return file
    }

    fun stop(): File? {
        val file = output
        // MediaRecorder.stop() бросает исключение, если запись слишком короткая
        // (нажали и сразу отпустили). Такой файл битый: раньше он всё равно
        // отправлялся и «ронял» приложение у получателя при воспроизведении.
        val stoppedOk = runCatching { recorder?.stop() }.isSuccess
        runCatching { recorder?.release() }
        recorder = null
        output = null
        if (!stoppedOk) {
            file?.delete()
            return null
        }
        return file?.takeIf { it.exists() && it.length() > 0 }
    }

    fun stopSilently() {
        runCatching { recorder?.stop() }
        runCatching { recorder?.release() }
        recorder = null
        output = null
    }
}
