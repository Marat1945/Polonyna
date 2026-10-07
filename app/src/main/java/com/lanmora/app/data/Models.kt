package com.lanmora.app.data

data class Identity(
    val deviceId: String,
    val displayName: String,
)

data class Peer(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
)

enum class MessageKind {
    TEXT, PHOTO, AUDIO, VIDEO
}

data class ChatMessage(
    val id: String,
    val chatId: String,
    val senderId: String,
    val senderName: String,
    val outgoing: Boolean,
    val kind: MessageKind,
    val text: String = "",
    val filePath: String? = null,
    val mimeType: String? = null,
    val timestamp: Long = System.currentTimeMillis(),
)

sealed interface CallState {
    val peer: Peer

    data class Incoming(override val peer: Peer) : CallState
    data class Outgoing(override val peer: Peer) : CallState
    data class Active(override val peer: Peer) : CallState
}
