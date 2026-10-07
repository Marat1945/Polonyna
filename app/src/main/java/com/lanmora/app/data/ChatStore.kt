package com.lanmora.app.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class ChatStore(context: Context) :
    SQLiteOpenHelper(context, "lanmora.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE messages(
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                outgoing INTEGER NOT NULL,
                kind TEXT NOT NULL,
                text_value TEXT NOT NULL,
                file_path TEXT,
                mime_type TEXT,
                timestamp INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX idx_messages_chat_time ON messages(chat_id, timestamp)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun insert(message: ChatMessage) {
        writableDatabase.insertWithOnConflict(
            "messages",
            null,
            ContentValues().apply {
                put("id", message.id)
                put("chat_id", message.chatId)
                put("sender_id", message.senderId)
                put("sender_name", message.senderName)
                put("outgoing", if (message.outgoing) 1 else 0)
                put("kind", message.kind.name)
                put("text_value", message.text)
                put("file_path", message.filePath)
                put("mime_type", message.mimeType)
                put("timestamp", message.timestamp)
            },
            SQLiteDatabase.CONFLICT_REPLACE
        )
    }

    fun all(): List<ChatMessage> {
        val result = mutableListOf<ChatMessage>()
        readableDatabase.query(
            "messages",
            null,
            null,
            null,
            null,
            null,
            "timestamp ASC"
        ).use { c ->
            val id = c.getColumnIndexOrThrow("id")
            val chat = c.getColumnIndexOrThrow("chat_id")
            val sender = c.getColumnIndexOrThrow("sender_id")
            val senderName = c.getColumnIndexOrThrow("sender_name")
            val outgoing = c.getColumnIndexOrThrow("outgoing")
            val kind = c.getColumnIndexOrThrow("kind")
            val text = c.getColumnIndexOrThrow("text_value")
            val path = c.getColumnIndexOrThrow("file_path")
            val mime = c.getColumnIndexOrThrow("mime_type")
            val time = c.getColumnIndexOrThrow("timestamp")

            while (c.moveToNext()) {
                result += ChatMessage(
                    id = c.getString(id),
                    chatId = c.getString(chat),
                    senderId = c.getString(sender),
                    senderName = c.getString(senderName),
                    outgoing = c.getInt(outgoing) == 1,
                    kind = runCatching { MessageKind.valueOf(c.getString(kind)) }
                        .getOrDefault(MessageKind.TEXT),
                    text = c.getString(text),
                    filePath = if (c.isNull(path)) null else c.getString(path),
                    mimeType = if (c.isNull(mime)) null else c.getString(mime),
                    timestamp = c.getLong(time),
                )
            }
        }
        return result
    }
}
