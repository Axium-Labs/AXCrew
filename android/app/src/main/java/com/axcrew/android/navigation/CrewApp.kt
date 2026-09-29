package com.axcrew.android.navigation

import android.net.Uri
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.axcrew.android.feature.*
import com.axcrew.android.ui.*
import com.axcrew.android.data.model.conversations
import kotlinx.coroutines.launch

private data class Destination(val route: String, val title: String, val icon: ImageVector)
private val destinations = listOf(Destination("sessions", "会话", Icons.AutoMirrored.Outlined.Chat), Destination("schedule", "计划", Icons.Outlined.CalendarMonth), Destination("devices", "设备", Icons.Outlined.Devices), Destination("more", "更多", Icons.Outlined.MoreHoriz))

/**
 * 导航过渡只做很短的淡入淡出。
 *
 * Navigation 的默认值是 700ms 的淡入 + 淡出，整个过渡期间前后两个页面同时处于组合中：
 * 会话页要重放 Markdown、抽屉要重算会话分组，于是每次切换都卡一下。缩短到 140ms 后
 * 视觉上依然连贯，但两页同时存在的窗口小得多。
 */
private val fastEnter: EnterTransition = fadeIn(tween(140))
private val fastExit: ExitTransition = fadeOut(tween(110))

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun CrewApp(vm: CrewViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val call by vm.call.collectAsStateWithLifecycle()
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // Keep the shell and draft alive while connection state changes.
        key(Unit) {
            val nav = rememberNavController()
            val drawer = rememberDrawerState(DrawerValue.Closed)
            val scope = rememberCoroutineScope()
            var connectionSheet by remember { mutableStateOf(false) }
            var selectedDevice by rememberSaveable { mutableStateOf("local") }
            val snapshot = state.crew.snapshot
            val device = snapshot.devices.find { it.id == selectedDevice }
            val entry by nav.currentBackStackEntryAsState()
            val route = entry?.destination?.route ?: "sessions"
            val topLevel = destinations.any { it.route == route }
            // 抽屉在每一次滑动帧里都会重组，而 conversations() 要遍历全部任务并做分组排序。
            // 按数据而不是按帧缓存，滑动手感才不会随会话数量下降。
            val drawerGroups = remember(snapshot, selectedDevice) {
                conversations(snapshot).filter { it.latest.assigned_device == selectedDevice }
            }
            val drawerByDate = remember(drawerGroups) {
                drawerGroups.groupBy { group ->
                    java.time.Instant.ofEpochSecond(group.latest.created_at).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
                }
            }
            fun go(path: String) { nav.navigate(path) { launchSingleTop = true } }
            fun openTask(id: String) { go("task/${Uri.encode(id)}") }
            fun openChat(id: String) { go("chat/${Uri.encode(id)}") }
            fun connect() { scope.launch { drawer.close(); connectionSheet = true } }
            fun openDrawer() { scope.launch { drawer.open() } }
            LaunchedEffect(state.configured) {
                if (state.configured) connectionSheet = false
                else nav.navigate("sessions") { popUpTo("sessions") { inclusive = true }; launchSingleTop = true }
            }
            LaunchedEffect(snapshot.devices) {
                if (snapshot.devices.isNotEmpty() && device == null) selectedDevice = snapshot.devices.first().id
            }
            ModalNavigationDrawer(drawerState = drawer, drawerContent = {
                ModalDrawerSheet(Modifier.fillMaxWidth(.86f).widthIn(max = 380.dp)) {
                    var deviceMenu by remember { mutableStateOf(false) }
                    Box(Modifier.padding(horizontal = 20.dp, vertical = 22.dp)) {
                        Row(Modifier.fillMaxWidth().clickable { deviceMenu = true }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            BadgedBox(badge = { if (device?.status in listOf("online", "busy")) Badge(containerColor = MaterialTheme.colorScheme.tertiary) }) { Icon(Icons.Outlined.Computer, null, Modifier.size(30.dp)) }
                            Text(device?.name ?: "连接你的电脑", Modifier.weight(1f).padding(start = 12.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Icon(Icons.Outlined.ExpandMore, "切换电脑")
                        }
                        DropdownMenu(expanded = deviceMenu, onDismissRequest = { deviceMenu = false }) {
                            snapshot.devices.forEach { item -> DropdownMenuItem(text = { Text("${item.name} · ${item.status}") }, onClick = { selectedDevice = item.id; deviceMenu = false; go("sessions") }) }
                            DropdownMenuItem(text = { Text(if (state.configured) "管理 Gateway 连接" else "连接电脑 / Gateway") }, onClick = { deviceMenu = false; connect() })
                        }
                    }
                    OutlinedButton(onClick = { scope.launch { drawer.close(); go("sessions") } }, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).height(54.dp), shape = RoundedCornerShape(18.dp)) { Icon(Icons.Outlined.AddComment, null); Spacer(Modifier.width(10.dp)); Text("新建会话", style = MaterialTheme.typography.titleMedium) }
                    Spacer(Modifier.height(24.dp))
                    LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        val today = java.time.LocalDate.now()
                        drawerByDate.forEach { (date, entries) ->
                            item { Text(if (date == today) "今天" else if (date == today.minusDays(1)) "昨天" else date.toString(), Modifier.padding(14.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            items(entries, key = { it.root.id }) { group ->
                                NavigationDrawerItem(label = { Text(group.root.title, maxLines = 2, overflow = TextOverflow.Ellipsis) }, selected = entry?.arguments?.getString("id") in listOf(group.latest.id, group.root.id), onClick = { scope.launch { drawer.close(); openChat(group.latest.id) } })
                            }
                        }
                        if (drawerGroups.isEmpty()) item { Text(if (state.configured) "还没有会话，开始新的工作吧。" else "连接电脑后同步最近会话。", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .4f))
                    Row(Modifier.fillMaxWidth().clickable(onClick = ::connect).padding(24.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(48.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape), contentAlignment = Alignment.Center) { Text("AX", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold) }
                        Column(Modifier.weight(1f).padding(start = 14.dp)) {
                            Text("AX Crew", style = MaterialTheme.typography.titleMedium)
                            Text(if (state.configured) state.crew.connection + " · 管理连接" else "连接电脑 / Gateway", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Outlined.ChevronRight, null)
                    }
                }
            }) {
            BoxWithConstraints {
                val wide = maxWidth >= 700.dp
                Scaffold(topBar = {
                    TopAppBar(title = { Column { Text("AX CREW", style = MaterialTheme.typography.titleMedium); Text(if (state.configured) "${device?.name ?: "Gateway"} · ${state.crew.connection}" else "未连接 · 随时开始会话", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }, navigationIcon = {
                        if (topLevel || route == "chat/{id}") FilledTonalIconButton(onClick = ::openDrawer) { Icon(Icons.Outlined.Menu, "打开会话与连接侧栏") }
                        else IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") }
                    }, actions = {
                        IconButton(onClick = { if (state.configured) vm.refresh() else connect() }) { Icon(Icons.Outlined.Refresh, "刷新连接") }
                        IconButton(onClick = { go("permissions") }) {
                            BadgedBox(badge = { if (state.crew.snapshot.permissions.isNotEmpty()) Badge { Text(state.crew.snapshot.permissions.size.toString()) } }) { Icon(Icons.Outlined.Shield, "权限审批") }
                        }
                    })
                }, bottomBar = {
                    if (!wide) NavigationBar {
                        destinations.forEach { destination -> NavigationBarItem(selected = route == destination.route || destination.route == "sessions" && route == "chat/{id}", onClick = { nav.navigate(destination.route) { popUpTo("sessions") { saveState = true }; launchSingleTop = true; restoreState = true } }, icon = { Icon(destination.icon, destination.title) }, label = { Text(destination.title) }) }
                    }
                }) { padding ->
                    Row(Modifier.padding(padding).imePadding()) {
                        if (wide) NavigationRail { destinations.forEach { destination -> NavigationRailItem(selected = route == destination.route, onClick = { go(destination.route) }, icon = { Icon(destination.icon, destination.title) }, label = { Text(destination.title) }) } }
                        Column(Modifier.weight(1f)) {
                            if (!state.configured && route != "sessions") TextButton(onClick = ::connect, modifier = Modifier.fillMaxWidth()) { Text("连接 Gateway，同步你的设备与任务 →") }
                            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                            (state.error ?: state.crew.error)?.let { ErrorBanner(it) { vm.clearError(); vm.refresh() } }
                            if (state.crew.snapshot.permissions.isNotEmpty() && route != "permissions") TextButton(onClick = { go("permissions") }, modifier = Modifier.fillMaxWidth()) { Text("${state.crew.snapshot.permissions.size} 项工具请求等待审批 →") }
                            NavHost(nav, startDestination = "sessions", modifier = Modifier.weight(1f),
                                enterTransition = { fastEnter }, exitTransition = { fastExit },
                                popEnterTransition = { fastEnter }, popExitTransition = { fastExit }) {
                                composable("sessions") { SessionScreen(vm, state, null, selectedDevice, ::connect, ::openChat) }
                                composable("chat/{id}") { back -> SessionScreen(vm, state, back.arguments?.getString("id"), selectedDevice, ::connect, ::openChat) }
                                composable("schedule") { ScheduleScreen(vm, state, ::openTask) }
                                composable("tasks") { TaskList(state, ::openTask) { go("newTask") } }
                                composable("newTask?device={device}", arguments = listOf(navArgument("device") { type = NavType.StringType; defaultValue = "" })) { back -> CreateTaskScreen(vm, state, back.arguments?.getString("device").orEmpty()) { id -> nav.popBackStack(); openTask(id) } }
                                composable("task/{id}") { back -> TaskScreen(vm, state, back.arguments?.getString("id").orEmpty(), ::openTask) }
                                composable("devices") { DevicesScreen(state) { go("device/${Uri.encode(it)}") } }
                                composable("device/{id}") { back -> val id = back.arguments?.getString("id").orEmpty(); DeviceScreen(vm, state, id, { selectedDevice = id; go("sessions") }, ::openTask) }
                                composable("agent/{id}") { back -> AgentScreen(state, back.arguments?.getString("id").orEmpty(), ::openTask) }
                                composable("permissions") { PermissionsScreen(vm, state) }
                                composable("activity") { ActivityScreen(state, ::openTask) }
                                composable("artifacts") { ArtifactsScreen(state, ::openTask) }
                                composable("more") {
                                    Page("工作区", "GATEWAY / ${state.crew.snapshot.settings.version}") {
                                        item { Entry("权限审批", "Allow Once / Allow Session / Reject") { go("permissions") } }
                                        item { Entry("动态", "设备、任务与 Agent 事件") { go("activity") } }
                                        item { Entry("产物", "任务和会话生成的内容") { go("artifacts") } }
                                        item { Panel { Text("连接与系统", style = MaterialTheme.typography.titleMedium); Code(state.endpoint); Status(if (state.configured) state.crew.connection else "未连接"); Text("回到前台自动重连并同步。后台期间远程任务继续运行，工具请求仍受 AX 审批超时约束。", style = MaterialTheme.typography.bodySmall); OutlinedButton(onClick = ::connect) { Text(if (state.configured) "管理连接" else "连接 Gateway") } } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            }
            call?.let { active -> VoiceCallScreen(vm, state, active) {
                val taskId = vm.endCall()
                taskId?.let { openChat(it) }
            } }
            if (connectionSheet) ModalBottomSheet(onDismissRequest = { connectionSheet = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
                Column(Modifier.fillMaxHeight(.92f).imePadding()) {
                    if (state.configured) Page("Gateway 连接", "当前桌面端控制服务") {
                        item { Panel { Code(state.endpoint); Status(state.crew.connection); Text("更换 Gateway 前请断开当前连接。断开手机不会停止远程任务。"); OutlinedButton(onClick = vm::disconnect, enabled = !state.busy) { Text("断开并清除凭据") } } }
                    } else {
                        state.error?.let { ErrorBanner(it, vm::clearError) }
                        ConnectScreen(vm, state)
                    }
                }
            }
        }
    }
}

@Composable private fun ErrorBanner(message: String, dismiss: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.errorContainer) {
        Row(Modifier.fillMaxWidth().padding(12.dp)) { Text(message, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall); TextButton(onClick = dismiss) { Text("重试 / 关闭") } }
    }
}
