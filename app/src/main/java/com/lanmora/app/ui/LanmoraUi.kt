package com.lanmora.app.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaController
import android.media.MediaPlayer
import android.net.Uri
import android.provider.Settings
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.lanmora.app.AppController
import com.lanmora.app.R
import com.lanmora.app.data.*
import com.lanmora.app.media.AudioNoteRecorder
import com.lanmora.app.media.VideoNoteActivity
import java.io.File
import java.text.DateFormat
import java.util.Date

private enum class HomeTab { CHATS, CONTACTS, SETTINGS, PROFILE }

@Composable
fun LanmoraRoot(controller: AppController) {
    val peers by controller.peers.collectAsStateWithLifecycle()
    val messages by controller.messages.collectAsStateWithLifecycle()
    val callState by controller.callState.collectAsStateWithLifecycle()

    var selectedPeer by remember { mutableStateOf<Peer?>(null) }

    if (selectedPeer == null) {
        HomeScreen(
            controller = controller,
            peers = peers,
            messages = messages,
            onOpenPeer = { selectedPeer = it }
        )
    } else {
        ChatScreen(
            controller = controller,
            peer = selectedPeer!!,
            messages = messages.filter { it.chatId == selectedPeer!!.id },
            onBack = { selectedPeer = null }
        )
    }

    callState?.let {
        CallDialog(controller, it)
    }
}

@Composable
private fun HomeScreen(
    controller: AppController,
    peers: List<Peer>,
    messages: List<ChatMessage>,
    onOpenPeer: (Peer) -> Unit,
) {
    var tab by remember { mutableStateOf(HomeTab.CHATS) }

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == HomeTab.CHATS,
                    onClick = { tab = HomeTab.CHATS },
                    icon = { Icon(Icons.Default.Chat, null) },
                    label = { Text(stringResource(R.string.chats)) }
                )
                NavigationBarItem(
                    selected = tab == HomeTab.CONTACTS,
                    onClick = { tab = HomeTab.CONTACTS },
                    icon = { Icon(Icons.Default.People, null) },
                    label = { Text(stringResource(R.string.contacts)) }
                )
                NavigationBarItem(
                    selected = tab == HomeTab.SETTINGS,
                    onClick = { tab = HomeTab.SETTINGS },
                    icon = { Icon(Icons.Default.Settings, null) },
                    label = { Text(stringResource(R.string.settings)) }
                )
                NavigationBarItem(
                    selected = tab == HomeTab.PROFILE,
                    onClick = { tab = HomeTab.PROFILE },
                    icon = { Icon(Icons.Default.Person, null) },
                    label = { Text(stringResource(R.string.profile)) }
                )
            }
        }
    ) { padding ->
        when (tab) {
            HomeTab.CHATS -> ChatsTab(
                Modifier.padding(padding),
                peers,
                messages,
                onOpenPeer
            )
            HomeTab.CONTACTS -> ContactsTab(
                Modifier.padding(padding),
                peers,
                onOpenPeer
            )
            HomeTab.SETTINGS -> SettingsTab(Modifier.padding(padding))
            HomeTab.PROFILE -> ProfileTab(Modifier.padding(padding), controller)
        }
    }
}

@Composable
private fun ChatsTab(
    modifier: Modifier,
    peers: List<Peer>,
    messages: List<ChatMessage>,
    onOpenPeer: (Peer) -> Unit
) {
    var query by remember { mutableStateOf("") }
    var privateOnly by remember { mutableStateOf(false) }

    val filtered = peers.filter {
        query.isBlank() || it.name.contains(query, ignoreCase = true)
    }

    Column(modifier.fillMaxSize()) {
        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 20.dp, top = 18.dp, bottom = 10.dp)
        )

        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            placeholder = { Text(stringResource(R.string.search_chats)) },
            singleLine = true,
            shape = RoundedCornerShape(28.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
        )

        Row(
            Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            FilterChip(
                selected = !privateOnly,
                onClick = { privateOnly = false },
                label = { Text(stringResource(R.string.all_chats)) },
                modifier = Modifier.weight(1f)
            )
            FilterChip(
                selected = privateOnly,
                onClick = { privateOnly = true },
                label = { Text(stringResource(R.string.private_chats)) },
                modifier = Modifier.weight(1f)
            )
        }

        if (filtered.isEmpty()) {
            EmptyPeers()
        } else {
            LazyColumn {
                items(filtered, key = { it.id }) { peer ->
                    val last = messages.lastOrNull { it.chatId == peer.id }
                    PeerRow(peer, last) { onOpenPeer(peer) }
                    HorizontalDivider(modifier = Modifier.padding(start = 76.dp))
                }
            }
        }
    }
}

@Composable
private fun ContactsTab(
    modifier: Modifier,
    peers: List<Peer>,
    onOpenPeer: (Peer) -> Unit
) {
    Column(modifier.fillMaxSize()) {
        Text(
            stringResource(R.string.nearby_devices),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(20.dp)
        )
        if (peers.isEmpty()) {
            EmptyPeers()
        } else {
            LazyColumn {
                items(peers, key = { it.id }) { peer ->
                    PeerRow(peer, null) { onOpenPeer(peer) }
                }
            }
        }
    }
}

@Composable
private fun EmptyPeers() {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            Icons.Default.Wifi,
            contentDescription = null,
            modifier = Modifier.size(52.dp)
        )
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.no_devices))
        Spacer(Modifier.height(6.dp))
        Text(
            stringResource(R.string.same_wifi_hint),
            style = MaterialTheme.typography.bodySmall
        )
    }
}

@Composable
private fun PeerRow(peer: Peer, last: ChatMessage?, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(52.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center
        ) {
            Text(
                peer.name.take(2).uppercase(),
                fontWeight = FontWeight.Bold
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                peer.name,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                lastPreview(last),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        if (last != null) {
            Text(
                DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(last.timestamp)),
                style = MaterialTheme.typography.labelSmall
            )
        }
    }
}

private fun lastPreview(message: ChatMessage?): String = when (message?.kind) {
    MessageKind.TEXT -> message.text
    MessageKind.PHOTO -> "📷"
    MessageKind.AUDIO -> "🎙"
    MessageKind.VIDEO -> "◉"
    null -> "Wi‑Fi"
}

@Composable
private fun SettingsTab(modifier: Modifier) {
    val context = LocalContext.current

    Column(
        modifier
            .fillMaxSize()
            .padding(20.dp)
    ) {
        Text(
            stringResource(R.string.settings),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.language), fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))

        LanguageButton("en", stringResource(R.string.english))
        LanguageButton("uk", stringResource(R.string.ukrainian))
        LanguageButton("ru", stringResource(R.string.russian))
        LanguageButton("pl", stringResource(R.string.polish))

        Spacer(Modifier.height(24.dp))
        OutlinedButton(
            onClick = {
                context.startActivity(Intent(Settings.ACTION_WIFI_SETTINGS))
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Default.WifiTethering, null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.wifi_settings))
        }

        Spacer(Modifier.height(18.dp))
        Text(
            stringResource(R.string.prototype_notice),
            style = MaterialTheme.typography.bodySmall
        )
    }
}

@Composable
private fun LanguageButton(tag: String, label: String) {
    TextButton(
        onClick = {
            AppCompatDelegate.setApplicationLocales(
                LocaleListCompat.forLanguageTags(tag)
            )
        },
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(label)
    }
}

@Composable
private fun ProfileTab(modifier: Modifier, controller: AppController) {
    var name by remember { mutableStateOf(controller.identity().displayName) }

    Column(
        modifier
            .fillMaxSize()
            .padding(20.dp)
    ) {
        Text(
            stringResource(R.string.profile),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text(stringResource(R.string.display_name)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = { controller.updateDisplayName(name) },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(stringResource(R.string.save))
        }
        Spacer(Modifier.height(24.dp))
        Text(stringResource(R.string.offline_mode))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatScreen(
    controller: AppController,
    peer: Peer,
    messages: List<ChatMessage>,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val recorder = remember { AudioNoteRecorder(context) }
    var text by remember { mutableStateOf("") }
    var recording by remember { mutableStateOf(false) }
    var pendingMicAction by remember { mutableStateOf<(() -> Unit)?>(null) }

    val micPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) pendingMicAction?.invoke()
        pendingMicAction = null
    }

    fun withMicPermission(action: () -> Unit) {
        if (ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            action()
        } else {
            pendingMicAction = action
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    val photoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) {
            controller.sendUri(
                peer,
                uri,
                MessageKind.PHOTO,
                context.contentResolver.getType(uri) ?: "image/*"
            )
        }
    }

    val videoLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val path = result.data?.getStringExtra(VideoNoteActivity.EXTRA_PATH)
            if (!path.isNullOrBlank()) {
                controller.sendFile(
                    peer,
                    File(path),
                    MessageKind.VIDEO,
                    "video/mp4"
                )
            }
        }
    }

    val videoPermissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        if (result[Manifest.permission.CAMERA] == true &&
            result[Manifest.permission.RECORD_AUDIO] == true
        ) {
            videoLauncher.launch(Intent(context, VideoNoteActivity::class.java))
        }
    }

    DisposableEffect(Unit) {
        onDispose { recorder.stopSilently() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(peer.name, maxLines = 1)
                        Text(
                            peer.host,
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, null)
                    }
                },
                actions = {
                    IconButton(
                        onClick = {
                            withMicPermission {
                                controller.startCall(peer)
                            }
                        }
                    ) {
                        Icon(Icons.Default.Call, stringResource(R.string.call))
                    }
                }
            )
        },
        bottomBar = {
            Column {
                if (recording) {
                    Text(
                        stringResource(R.string.recording),
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = {
                            photoPicker.launch(
                                PickVisualMediaRequest(
                                    ActivityResultContracts.PickVisualMedia.ImageOnly
                                )
                            )
                        }
                    ) {
                        Icon(Icons.Default.Image, stringResource(R.string.photo))
                    }

                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it },
                        placeholder = { Text(stringResource(R.string.message_hint)) },
                        maxLines = 4,
                        shape = RoundedCornerShape(24.dp),
                        modifier = Modifier.weight(1f)
                    )

                    IconButton(
                        onClick = {
                            withMicPermission {
                                if (recording) {
                                    recorder.stop()?.let {
                                        controller.sendFile(
                                            peer,
                                            it,
                                            MessageKind.AUDIO,
                                            "audio/mp4"
                                        )
                                    }
                                    recording = false
                                } else {
                                    runCatching { recorder.start() }
                                        .onSuccess { recording = true }
                                }
                            }
                        }
                    ) {
                        Icon(
                            if (recording) Icons.Default.Stop else Icons.Default.Mic,
                            stringResource(R.string.voice_message)
                        )
                    }

                    IconButton(
                        onClick = {
                            val cameraOk = ContextCompat.checkSelfPermission(
                                context,
                                Manifest.permission.CAMERA
                            ) == PackageManager.PERMISSION_GRANTED
                            val micOk = ContextCompat.checkSelfPermission(
                                context,
                                Manifest.permission.RECORD_AUDIO
                            ) == PackageManager.PERMISSION_GRANTED

                            if (cameraOk && micOk) {
                                videoLauncher.launch(Intent(context, VideoNoteActivity::class.java))
                            } else {
                                videoPermissions.launch(
                                    arrayOf(
                                        Manifest.permission.CAMERA,
                                        Manifest.permission.RECORD_AUDIO
                                    )
                                )
                            }
                        }
                    ) {
                        Icon(Icons.Default.Videocam, stringResource(R.string.video_note))
                    }

                    if (text.isNotBlank()) {
                        IconButton(
                            onClick = {
                                controller.sendText(peer, text)
                                text = ""
                            }
                        ) {
                            Icon(Icons.Default.Send, stringResource(R.string.send))
                        }
                    }
                }
            }
        }
    ) { padding ->
        if (messages.isEmpty()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text(stringResource(R.string.same_wifi_hint))
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                reverseLayout = true,
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(messages.asReversed(), key = { it.id }) { message ->
                    MessageBubble(message)
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.outgoing) Arrangement.End else Arrangement.Start
    ) {
        Surface(
            shape = RoundedCornerShape(
                topStart = 18.dp,
                topEnd = 18.dp,
                bottomStart = if (message.outgoing) 18.dp else 4.dp,
                bottomEnd = if (message.outgoing) 4.dp else 18.dp
            ),
            color = if (message.outgoing) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
            modifier = Modifier.widthIn(max = 300.dp)
        ) {
            Column(Modifier.padding(10.dp)) {
                when (message.kind) {
                    MessageKind.TEXT -> Text(message.text)
                    MessageKind.PHOTO -> PhotoMessage(message.filePath)
                    MessageKind.AUDIO -> AudioMessage(message.filePath)
                    MessageKind.VIDEO -> VideoMessage(message.filePath)
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    DateFormat.getTimeInstance(DateFormat.SHORT)
                        .format(Date(message.timestamp)),
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.align(Alignment.End)
                )
            }
        }
    }
}

@Composable
private fun PhotoMessage(path: String?) {
    if (path.isNullOrBlank()) return
    AsyncImage(
        model = File(path),
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier
            .sizeIn(maxWidth = 260.dp, maxHeight = 320.dp)
            .clip(RoundedCornerShape(14.dp))
    )
}

@Composable
private fun AudioMessage(path: String?) {
    if (path.isNullOrBlank()) return
    val context = LocalContext.current
    var playing by remember { mutableStateOf(false) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }

    DisposableEffect(path) {
        onDispose {
            runCatching { player?.release() }
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(
            onClick = {
                if (playing) {
                    player?.pause()
                    playing = false
                } else {
                    val p = player ?: MediaPlayer().also {
                        it.setDataSource(path)
                        it.prepare()
                        it.setOnCompletionListener { _ -> playing = false }
                        player = it
                    }
                    p.start()
                    playing = true
                }
            }
        ) {
            Icon(
                if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                null
            )
        }
        Text("Audio")
    }
}

@Composable
private fun VideoMessage(path: String?) {
    if (path.isNullOrBlank()) return
    AndroidView(
        factory = { context ->
            VideoView(context).apply {
                setVideoPath(path)
                setMediaController(MediaController(context))
                setOnPreparedListener { it.seekTo(1) }
            }
        },
        modifier = Modifier
            .size(190.dp)
            .clip(CircleShape)
    )
}

@Composable
private fun CallDialog(controller: AppController, state: CallState) {
    val context = LocalContext.current
    var speaker by remember(state) { mutableStateOf(false) }

    val acceptPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) controller.acceptCall()
    }

    fun acceptWithPermission() {
        if (ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            controller.acceptCall()
        } else {
            acceptPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    AlertDialog(
        onDismissRequest = { },
        title = {
            Text(
                when (state) {
                    is CallState.Incoming -> stringResource(R.string.incoming_call)
                    is CallState.Outgoing -> stringResource(R.string.calling)
                    is CallState.Active -> stringResource(R.string.call_active)
                }
            )
        },
        text = {
            Column {
                Text(state.peer.name, fontWeight = FontWeight.Bold)
                if (state is CallState.Active) {
                    Spacer(Modifier.height(12.dp))
                    FilterChip(
                        selected = speaker,
                        onClick = {
                            speaker = !speaker
                            controller.setSpeakerEnabled(speaker)
                        },
                        label = { Text(stringResource(R.string.speaker)) },
                        leadingIcon = { Icon(Icons.Default.VolumeUp, null) }
                    )
                }
            }
        },
        confirmButton = {
            when (state) {
                is CallState.Incoming -> Button(onClick = ::acceptWithPermission) {
                    Text(stringResource(R.string.accept))
                }
                is CallState.Outgoing -> TextButton(onClick = controller::endCall) {
                    Text(stringResource(R.string.end_call))
                }
                is CallState.Active -> Button(onClick = controller::endCall) {
                    Text(stringResource(R.string.end_call))
                }
            }
        },
        dismissButton = {
            if (state is CallState.Incoming) {
                TextButton(onClick = controller::declineCall) {
                    Text(stringResource(R.string.decline))
                }
            }
        }
    )
}
