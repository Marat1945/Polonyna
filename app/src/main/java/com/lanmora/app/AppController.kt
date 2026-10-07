package com.lanmora.app

import android.content.Context
import android.net.Uri
import android.os.Build
import com.lanmora.app.data.*
import com.lanmora.app.network.LanTransport
import com.lanmora.app.network.VoiceCallEngine
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.io.File
import java.util.UUID

class AppController(private val context: Context) : LanTransport.Listener {
    private val prefs = context.getSharedPreferences("identity", Context.MODE_PRIVATE)
    private val store = ChatStore(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val voice = VoiceCallEngine(context)

    private val _peers = MutableStateFlow<List<Peer>>(emptyList())
    val peers: StateFlow<List<Peer>> = _peers

    private val _messages = MutableStateFlow(store.all())
    val messages: StateFlow<List<ChatMessage>> = _messages

    private val _callState = MutableStateFlow<CallState?>(null)
    val callState: StateFlow<CallState?> = _callState

    private val transport = LanTransport(context, ::identity).also { it.listener = this }

    fun identity(): Identity {
        val existingId = prefs.getString("deviceId", null)
        val id = existingId ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("deviceId", it).apply()
        }
        val name = prefs.getString("displayName", null)
            ?: Build.MODEL.orEmpty().ifBlank { "Android" }
        return Identity(id, name)
    }

    fun start() = transport.start()
    fun stop() {
        voice.stop()
        transport.stop()
    }

    fun updateDisplayName(name: String) {
        val clean = name.trim().take(40).ifBlank { Build.MODEL.orEmpty().ifBlank { "Android" } }
        prefs.edit().putString("displayName", clean).apply()
        transport.restart()
    }

    override fun onPeer(peer: Peer) {
        _peers.value = (_peers.value.filterNot { it.id == peer.id } + peer)
            .sortedBy { it.name.lowercase() }
    }

    override fun onEnvelope(json: JSONObject, payloadFile: File?, remoteHost: String) {
        val senderId = json.optString("senderId")
        if (senderId.isBlank() || senderId == identity().deviceId) return

        val senderName = json.optString("senderName", senderId)
        val senderPort = json.optInt("senderPort", 0)
        val peer = Peer(senderId, senderName, remoteHost, senderPort)
        if (senderPort > 0) onPeer(peer)

        when (json.optString("type")) {
            "message" -> {
                val kind = runCatching {
                    MessageKind.valueOf(json.optString("messageKind", "TEXT"))
                }.getOrDefault(MessageKind.TEXT)

                val message = ChatMessage(
                    id = json.optString("messageId", UUID.randomUUID().toString()),
                    chatId = senderId,
                    senderId = senderId,
                    senderName = senderName,
                    outgoing = false,
                    kind = kind,
                    text = json.optString("text", ""),
                    filePath = payloadFile?.absolutePath,
                    mimeType = json.optString("mimeType").takeIf { it.isNotBlank() },
                    timestamp = json.optLong("timestamp", System.currentTimeMillis()),
                )
                storeAndPublish(message)
            }

            "call_offer" -> _callState.value = CallState.Incoming(peer)

            "call_accept" -> {
                startAudio(peer)
                _callState.value = CallState.Active(peer)
            }

            "call_decline", "call_end" -> {
                voice.stop()
                _callState.value = null
            }
        }
    }

    override fun onTransportError(error: Throwable) {
        // MVP: errors are intentionally non-fatal. Add a diagnostics screen before release.
    }

    fun sendText(peer: Peer, text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        sendMessage(peer, MessageKind.TEXT, clean, null, null)
    }

    fun sendUri(peer: Peer, uri: Uri, kind: MessageKind, mimeType: String?) {
        scope.launch(Dispatchers.IO) {
            val ext = when (kind) {
                MessageKind.PHOTO -> ".jpg"
                MessageKind.AUDIO -> ".m4a"
                MessageKind.VIDEO -> ".mp4"
                else -> ".bin"
            }
            val folder = File(context.filesDir, "sent/imported").apply { mkdirs() }
            val file = File(folder, "${UUID.randomUUID()}$ext")
            context.contentResolver.openInputStream(uri)?.use { input ->
                file.outputStream().buffered().use { output -> input.copyTo(output) }
            } ?: return@launch
            withContext(Dispatchers.Main) {
                sendFile(peer, file, kind, mimeType)
            }
        }
    }

    fun sendFile(peer: Peer, file: File, kind: MessageKind, mimeType: String?) {
        sendMessage(peer, kind, "", file, mimeType)
    }

    private fun sendMessage(
        peer: Peer,
        kind: MessageKind,
        text: String,
        payload: File?,
        mimeType: String?,
    ) {
        val id = UUID.randomUUID().toString()
        val time = System.currentTimeMillis()
        val me = identity()

        val localMessage = ChatMessage(
            id = id,
            chatId = peer.id,
            senderId = me.deviceId,
            senderName = me.displayName,
            outgoing = true,
            kind = kind,
            text = text,
            filePath = payload?.absolutePath,
            mimeType = mimeType,
            timestamp = time,
        )

        scope.launch {
            val json = JSONObject()
                .put("type", "message")
                .put("messageId", id)
                .put("messageKind", kind.name)
                .put("text", text)
                .put("mimeType", mimeType ?: "")
                .put("fileName", payload?.name ?: "")
                .put("timestamp", time)

            if (transport.send(peer, json, payload)) {
                storeAndPublish(localMessage)
            }
        }
    }

    fun startCall(peer: Peer) {
        _callState.value = CallState.Outgoing(peer)
        scope.launch {
            val ok = transport.send(peer, JSONObject().put("type", "call_offer"))
            if (!ok) _callState.value = null
        }
    }

    fun acceptCall() {
        val peer = (_callState.value as? CallState.Incoming)?.peer ?: return
        scope.launch {
            if (transport.send(peer, JSONObject().put("type", "call_accept"))) {
                startAudio(peer)
                _callState.value = CallState.Active(peer)
            }
        }
    }

    fun declineCall() {
        val peer = _callState.value?.peer ?: return
        scope.launch { transport.send(peer, JSONObject().put("type", "call_decline")) }
        voice.stop()
        _callState.value = null
    }

    fun endCall() {
        val peer = _callState.value?.peer ?: return
        scope.launch { transport.send(peer, JSONObject().put("type", "call_end")) }
        voice.stop()
        _callState.value = null
    }

    fun setSpeakerEnabled(enabled: Boolean) = voice.setSpeakerEnabled(enabled)

    private fun startAudio(peer: Peer) {
        if (peer.port <= 0 || transport.localPort <= 0) return
        runCatching { voice.start(peer.host, peer.port, transport.localPort) }
    }

    private fun storeAndPublish(message: ChatMessage) {
        store.insert(message)
        _messages.value = (_messages.value.filterNot { it.id == message.id } + message)
            .sortedBy { it.timestamp }
    }
}
