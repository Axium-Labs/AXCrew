package com.axcrew.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

private val Dark = darkColorScheme(primary = Color(0xFFB29AF6), onPrimary = Color(0xFF251849), secondary = Color(0xFF8DA2F0), background = Color(0xFF191D26), surface = Color(0xFF242936), surfaceVariant = Color(0xFF303747), onSurface = Color(0xFFE7E9EF), onSurfaceVariant = Color(0xFFADB3C1), outline = Color(0xFF454B5B), error = Color(0xFFE88389))
private val Light = lightColorScheme(primary = Color(0xFF7051B8), secondary = Color(0xFF4765D1), background = Color(0xFFF8F9FB), surface = Color.White, surfaceVariant = Color(0xFFE9EDF5), onSurface = Color(0xFF242A35), onSurfaceVariant = Color(0xFF647085), outline = Color(0xFFCBD1DC))
@Composable fun CrewTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light,
        shapes = Shapes(small = RoundedCornerShape(11.dp), medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(20.dp)), content = content)
}
