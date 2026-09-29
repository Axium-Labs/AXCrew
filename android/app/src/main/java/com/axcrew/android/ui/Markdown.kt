package com.axcrew.android.ui

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography

/** 把会话消息正文按 Markdown 渲染（粗体、代码块、列表、表格、标题等）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MarkdownMessage(content: String, modifier: Modifier = Modifier) {
    Markdown(
        content = content,
        colors = markdownColor(),
        typography = markdownTypography(),
        modifier = modifier,
    )
}
