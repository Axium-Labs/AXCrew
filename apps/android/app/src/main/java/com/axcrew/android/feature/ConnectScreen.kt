package com.axcrew.android.feature

import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.axcrew.android.ui.*

@Composable fun ConnectScreen(vm: CrewViewModel, state: ClientState) {
    var address by rememberSaveable { mutableStateOf(state.endpoint) }
    // Pairing code deliberately never enters saved instance state or navigation arguments.
    var code by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var scanning by remember { mutableStateOf(false) }
    var showLegacy by remember { mutableStateOf(false) }
    val pairingBusy = state.pairing
    Box {
        Page("AX CREW", "CONTROL CLIENT / ANDROID") {
            item { Panel {
                Text("连接你的 Crew", style = MaterialTheme.typography.headlineSmall)
                Text("扫描或输入桌面端生成的配对码，在电脑上确认授权后即可连接。")
                Field("Gateway 地址", address, { address = it })
                OutlinedTextField(code, { code = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("配对码") }, supportingText = { Text("例如 AX-7K3M；配对码 5 分钟有效、一次性") })
                Button(
                    onClick = { vm.pair(address, code, Build.MODEL.ifBlank { "Android 手机" }, "Android") },
                    enabled = address.isNotBlank() && code.isNotBlank() && !state.connecting && !pairingBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (pairingBusy) "等待电脑确认授权…" else if (state.connecting) "正在连接…" else "配对并连接")
                }
                OutlinedButton(onClick = { scanning = true }, enabled = !state.connecting && !pairingBusy, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.QrCodeScanner, null); Spacer(Modifier.width(8.dp)); Text("扫描二维码配对") }
                if (pairingBusy) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text("已提交配对，请在电脑端「连接手机」页点击「允许」。", style = MaterialTheme.typography.bodySmall)
                }
                HorizontalDivider()
                TextButton(onClick = { showLegacy = !showLegacy }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Key, null); Spacer(Modifier.width(6.dp)); Text(if (showLegacy) "收起：使用已有凭证" else "使用已有凭证 / 手动连接") }
                if (showLegacy) {
                    OutlinedTextField(token, { token = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("连接凭证 (Token)") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false))
                    Button(onClick = { vm.connect(address, token) }, enabled = address.isNotBlank() && token.isNotBlank() && !state.connecting, modifier = Modifier.fillMaxWidth()) { Text("连接 Gateway") }
                }
            } }
            item { Panel {
                Text("如何配对", style = MaterialTheme.typography.titleMedium)
                Text("在桌面端「连接手机」页点击「生成配对码」，用手机扫码或输入配对码；然后在桌面端点「允许」完成授权。")
                Text("配对成功后，设备凭证用 Android Keystore 加密保存，之后自动连接、无需重复配对；在桌面端可随时撤销某台设备的访问。", style = MaterialTheme.typography.bodySmall)
            } }
        }
        if (scanning) {
            ScanQrOverlay(
                onDismiss = { scanning = false },
                onResult = { host, pairingCode ->
                    scanning = false
                    address = host
                    code = pairingCode
                    vm.pair(host, pairingCode, Build.MODEL.ifBlank { "Android 手机" }, "Android")
                },
            )
        }
    }
}
