package com.axcrew.android.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.axcrew.android.data.model.Attachment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object AttachmentReader {
    fun name(context: Context, uri: Uri): String = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull() ?: "附件"
    suspend fun read(context: Context, uris: List<String>): List<Attachment> = withContext(Dispatchers.IO) {
        require(uris.size <= 4) { "每条消息最多 4 个附件" }
        var total = 0
        uris.map { value ->
            val uri = Uri.parse(value)
            require(uri.scheme == "content") { "只支持系统选择器提供的文件" }
            val bytes = context.contentResolver.openInputStream(uri)?.use { stream ->
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                while (true) {
                    val count = stream.read(chunk); if (count < 0) break
                    require(buffer.size() + count <= 8 * 1024 * 1024) { "单个附件不能超过 8 MB" }
                    buffer.write(chunk, 0, count)
                }; buffer.toByteArray()
            } ?: error("无法读取附件，请重新选择")
            total += bytes.size; require(total <= 16 * 1024 * 1024) { "附件总大小不能超过 16 MB" }
            val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
            require(!mime.startsWith("image/") || mime in listOf("image/png", "image/jpeg", "image/webp", "image/gif")) { "图片支持 PNG、JPEG、WebP、GIF" }
            Attachment(name(context, uri), mime, Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
    }
}
