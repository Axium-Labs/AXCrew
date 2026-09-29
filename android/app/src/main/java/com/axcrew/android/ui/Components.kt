package com.axcrew.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable fun Page(title: String, subtitle: String, content: LazyListScope.() -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold); Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
        content()
        item { Spacer(Modifier.height(24.dp)) }
    }
}
@Composable fun Panel(content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content) }
}
@Composable fun Entry(title: String, detail: String, status: String = "", click: () -> Unit) {
    OutlinedCard(onClick = click, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(title, fontWeight = FontWeight.Medium)
            if (detail.isNotBlank()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (status.isNotBlank()) Status(status)
        }
    }
}
@Composable fun Status(value: String) {
    val color = when (value) { "online", "completed", "已连接" -> Color(0xFF69BB91); "failed", "offline", "cancelled" -> MaterialTheme.colorScheme.error; "waiting_permission" -> Color(0xFFD7AE6B); else -> MaterialTheme.colorScheme.primary }
    Text("●  $value", color = color, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
}
@Composable fun Code(text: String) { SelectionContainer { Text(text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) } }
@Composable fun Field(label: String, value: String, onValue: (String) -> Unit, lines: Int = 1) {
    OutlinedTextField(value, onValue, Modifier.fillMaxWidth(), label = { Text(label) }, minLines = lines, singleLine = lines == 1)
}
@Composable fun Picker(label: String, value: String, choices: List<Pair<String, String>>, select: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth(), enabled = choices.isNotEmpty()) {
                Text(choices.find { it.first == value }?.second ?: "请选择", modifier = Modifier.weight(1f)); Text("⌄")
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                choices.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { select(id); open = false }) }
            }
        }
    }
}
