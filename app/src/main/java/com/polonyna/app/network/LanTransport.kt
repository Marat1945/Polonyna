package com.polonyna.app.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import com.polonyna.app.data.Identity
import com.polonyna.app.data.Peer
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.*
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

class LanTransport(
    private val context: Context,
    private val identityProvider: () -> Identity,
) {
    interface Listener {
        fun onPeer(peer: Peer)
        fun onEnvelope(json: JSONObject, payloadFile: File?, remoteHost: String)
        fun onTransportError(error: Throwable)
    }

    companion object {
        private const val SERVICE_TYPE = "_polonyna._tcp."
        private const val MAX_HEADER = 256 * 1024
        private const val MAX_PAYLOAD = 200L * 1024L * 1024L
    }

    var listener: Listener? = null
    var localPort: Int = 0
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private var serverSocket: ServerSocket? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    private val resolveQueue = ConcurrentLinkedQueue<NsdServiceInfo>()
    private val resolving = AtomicBoolean(false)
    private val started = AtomicBoolean(false)

    fun start() {
        if (!started.compareAndSet(false, true)) return

        runCatching {
            multicastLock = wifi.createMulticastLock("polonyna-mdns").apply {
                setReferenceCounted(false)
                acquire()
            }
        }

        scope.launch {
            try {
                val server = ServerSocket(0)
                serverSocket = server
                localPort = server.localPort
                withContext(Dispatchers.Main) {
                    registerService()
                    discover()
                }
                while (isActive) {
                    val socket = server.accept()
                    launch { receive(socket) }
                }
            } catch (t: Throwable) {
                if (started.get()) listener?.onTransportError(t)
            }
        }
    }

    fun stop() {
        if (!started.compareAndSet(true, false)) return
        runCatching { discoveryListener?.let(nsd::stopServiceDiscovery) }
        runCatching { registrationListener?.let(nsd::unregisterService) }
        runCatching { serverSocket?.close() }
        runCatching {
            if (multicastLock?.isHeld == true) multicastLock?.release()
        }
        localPort = 0
    }

    fun restart() {
        stop()
        start()
    }

    private fun registerService() {
        val identity = identityProvider()
        val service = NsdServiceInfo().apply {
            serviceName = "Polonyna-${identity.deviceId.take(12)}"
            serviceType = SERVICE_TYPE
            port = localPort
            runCatching { setAttribute("id", identity.deviceId) }
            runCatching { setAttribute("name", identity.displayName) }
            runCatching { setAttribute("v", "1") }
        }

        registrationListener = object : NsdManager.RegistrationListener {
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) = Unit
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) = Unit
        }.also {
            runCatching { nsd.registerService(service, NsdManager.PROTOCOL_DNS_SD, it) }
                .onFailure { error -> listener?.onTransportError(error) }
        }
    }

    private fun discover() {
        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType == SERVICE_TYPE) {
                    resolveQueue.add(serviceInfo)
                    resolveNext()
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                runCatching { nsd.stopServiceDiscovery(this) }
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                runCatching { nsd.stopServiceDiscovery(this) }
            }
        }.also {
            runCatching { nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, it) }
                .onFailure { error -> listener?.onTransportError(error) }
        }
    }

    @Suppress("DEPRECATION")
    private fun resolveNext() {
        if (!resolving.compareAndSet(false, true)) return
        val item = resolveQueue.poll()
        if (item == null) {
            resolving.set(false)
            return
        }

        runCatching {
            nsd.resolveService(item, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    resolving.set(false)
                    resolveNext()
                }

                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    try {
                        val myId = identityProvider().deviceId
                        val id = attribute(serviceInfo, "id")
                            ?: serviceInfo.serviceName.removePrefix("Polonyna-")
                        if (id != myId) {
                            val name = attribute(serviceInfo, "name") ?: id
                            val host = serviceInfo.host?.hostAddress
                            if (!host.isNullOrBlank() && serviceInfo.port > 0) {
                                listener?.onPeer(
                                    Peer(
                                        id = id,
                                        name = name,
                                        host = host,
                                        port = serviceInfo.port
                                    )
                                )
                            }
                        }
                    } finally {
                        resolving.set(false)
                        resolveNext()
                    }
                }
            })
        }.onFailure {
            resolving.set(false)
            resolveNext()
        }
    }

    private fun attribute(info: NsdServiceInfo, key: String): String? =
        runCatching {
            info.attributes[key]?.toString(Charsets.UTF_8)
        }.getOrNull()

    suspend fun send(
        peer: Peer,
        json: JSONObject,
        payload: File? = null
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val identity = identityProvider()
            val payloadLength = payload?.length() ?: 0L

            json.put("senderId", identity.deviceId)
            json.put("senderName", identity.displayName)
            json.put("senderPort", localPort)
            json.put("payloadLength", payloadLength)

            val header = json.toString().toByteArray(Charsets.UTF_8)
            require(header.size <= MAX_HEADER)
            require(payloadLength <= MAX_PAYLOAD)

            Socket().use { socket ->
                socket.connect(InetSocketAddress(peer.host, peer.port), 5_000)
                DataOutputStream(BufferedOutputStream(socket.getOutputStream())).use { out ->
                    out.writeInt(header.size)
                    out.write(header)
                    payload?.inputStream()?.buffered()?.use { input ->
                        input.copyTo(out, 64 * 1024)
                    }
                    out.flush()
                }
            }
            true
        } catch (t: Throwable) {
            listener?.onTransportError(t)
            false
        }
    }

    private fun receive(socket: Socket) {
        socket.use { s ->
            try {
                val remoteHost = s.inetAddress?.hostAddress.orEmpty()
                DataInputStream(BufferedInputStream(s.getInputStream())).use { input ->
                    val headerSize = input.readInt()
                    require(headerSize in 1..MAX_HEADER)

                    val headerBytes = ByteArray(headerSize)
                    input.readFully(headerBytes)
                    val json = JSONObject(String(headerBytes, Charsets.UTF_8))
                    val payloadLength = json.optLong("payloadLength", 0L)
                    require(payloadLength in 0..MAX_PAYLOAD)

                    val payloadFile = if (payloadLength > 0) {
                        val folder = File(context.filesDir, "received").apply { mkdirs() }
                        val rawName = json.optString("fileName", "payload.bin")
                        val safeName = rawName.replace(Regex("[^A-Za-z0-9._-]"), "_")
                        val file = File(folder, "${json.optString("messageId", System.nanoTime().toString())}-$safeName")
                        FileOutputStream(file).buffered().use { out ->
                            var remaining = payloadLength
                            val buffer = ByteArray(64 * 1024)
                            while (remaining > 0) {
                                val n = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                                if (n < 0) throw EOFException("Payload ended early")
                                out.write(buffer, 0, n)
                                remaining -= n
                            }
                        }
                        file
                    } else null

                    listener?.onEnvelope(json, payloadFile, remoteHost)
                }
            } catch (t: Throwable) {
                listener?.onTransportError(t)
            }
        }
    }
}
