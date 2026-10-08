package com.polonyna.app.network

import android.content.Context
import android.media.*
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import kotlinx.coroutines.*
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicBoolean

class VoiceCallEngine(private val context: Context) {
    companion object {
        private const val SAMPLE_RATE = 16_000
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = AtomicBoolean(false)

    private var socket: DatagramSocket? = null
    private var recorder: AudioRecord? = null
    private var player: AudioTrack? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null

    fun start(remoteHost: String, remotePort: Int, localPort: Int) {
        if (!running.compareAndSet(false, true)) return
        try {
            startInternal(remoteHost, remotePort, localPort)
        } catch (t: Throwable) {
            // Если микрофон, динамик или порт не запустились, освобождаем всё.
            // Раньше флаг running оставался true, и все следующие звонки шли без звука
            // до перезапуска приложения.
            releaseAll()
            running.set(false)
            throw t
        }
    }

    private fun startInternal(remoteHost: String, remotePort: Int, localPort: Int) {
        val minRecord = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(2048)

        val minPlay = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(2048)

        val audioRecord = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .build()
            )
            .setBufferSizeInBytes(minRecord * 2)
            .build()
        recorder = audioRecord
        check(audioRecord.state == AudioRecord.STATE_INITIALIZED) { "Microphone is not available" }

        val audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(minPlay * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        player = audioTrack
        check(audioTrack.state == AudioTrack.STATE_INITIALIZED) { "Speaker is not available" }

        echoCanceler = if (AcousticEchoCanceler.isAvailable()) {
            AcousticEchoCanceler.create(audioRecord.audioSessionId)?.apply { enabled = true }
        } else null
        noiseSuppressor = if (NoiseSuppressor.isAvailable()) {
            NoiseSuppressor.create(audioRecord.audioSessionId)?.apply { enabled = true }
        } else null

        val udp = DatagramSocket(null).apply {
            reuseAddress = true
            bind(InetSocketAddress(localPort))
            soTimeout = 500
        }
        socket = udp

        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        audioRecord.startRecording()
        audioTrack.play()

        val address = InetAddress.getByName(remoteHost)

        scope.launch {
            val buffer = ByteArray(640) // ~20 ms PCM at 16 kHz mono/16-bit
            while (running.get()) {
                val read = audioRecord.read(buffer, 0, buffer.size)
                if (read > 0) {
                    runCatching {
                        udp.send(DatagramPacket(buffer, read, address, remotePort))
                    }
                } else if (read < 0) {
                    break // микрофон остановлен или потерян — не крутим пустой цикл
                }
            }
        }

        scope.launch {
            val buffer = ByteArray(2048)
            while (running.get()) {
                try {
                    val packet = DatagramPacket(buffer, buffer.size)
                    udp.receive(packet)
                    if (packet.length > 0) {
                        audioTrack.write(packet.data, packet.offset, packet.length)
                    }
                } catch (_: SocketTimeoutException) {
                    // Lets the loop notice stop().
                } catch (_: Throwable) {
                    if (!running.get()) break
                }
            }
        }
    }

    fun setSpeakerEnabled(enabled: Boolean) {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= 31) {
            if (enabled) {
                val speaker = audioManager.availableCommunicationDevices.firstOrNull {
                    it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                }
                if (speaker != null) audioManager.setCommunicationDevice(speaker)
            } else {
                audioManager.clearCommunicationDevice()
            }
        } else {
            @Suppress("DEPRECATION")
            run { audioManager.isSpeakerphoneOn = enabled }
        }
    }

    fun stop() {
        if (!running.compareAndSet(true, false)) return
        releaseAll()
    }

    private fun releaseAll() {
        runCatching { recorder?.stop() }
        runCatching { player?.stop() }
        runCatching { recorder?.release() }
        runCatching { player?.release() }
        runCatching { echoCanceler?.release() }
        runCatching { noiseSuppressor?.release() }
        runCatching { socket?.close() }
        recorder = null
        player = null
        echoCanceler = null
        noiseSuppressor = null
        socket = null

        runCatching {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (Build.VERSION.SDK_INT >= 31) audioManager.clearCommunicationDevice()
            audioManager.mode = AudioManager.MODE_NORMAL
        }
    }
}
