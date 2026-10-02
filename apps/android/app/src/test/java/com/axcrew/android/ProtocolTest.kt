package com.axcrew.android

import com.axcrew.android.data.model.*
import com.axcrew.android.data.model.Connection
import com.axcrew.android.data.network.*
import com.axcrew.android.data.repository.CrewRepository
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.*
import okhttp3.tls.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

class ProtocolTest {
    private fun task(id: String = "t", status: String = "running", parent: String? = null) = Task(id, "c", "Test", assigned_member = "m", assigned_device = "local", status = status, input = JsonPrimitive("hello"), parent_id = parent)
    private fun update(role: String, text: String, id: String = role) = buildJsonObject { put("sessionUpdate", role); put("messageId", id); put("content", buildJsonObject { put("text", text) }) }

    @Test fun rejectsInsecureAndCredentialBearingEndpoints() {
        // 公网/非私网地址拒绝明文；私网地址允许局域网明文直连
        listOf("http://crew.example.com", "http://8.8.8.8", "https://user:password@host", "https://host?token=secret", "https://host/api", "https://host/#secret").forEach { endpoint -> assertTrue(endpoint, runCatching { validatedEndpoint(endpoint) }.isFailure) }
        assertEquals("http://192.168.1.5/", validatedEndpoint("http://192.168.1.5").toString())
        assertEquals("http://10.0.0.8/", validatedEndpoint("http://10.0.0.8").toString())
        assertEquals("http://172.20.1.9/", validatedEndpoint("http://172.20.1.9").toString())
        assertEquals("http://localhost/", validatedEndpoint("http://localhost").toString())
        assertEquals("http://127.0.0.1:8765/", validatedEndpoint("http://127.0.0.1:8765").toString())
        assertEquals("https://crew.example.com/", validatedEndpoint("https://crew.example.com").toString())
    }
    @Test fun replayDoesNotDuplicateCurrentTurnOrRegressText() {
        val history = History("t", "s", listOf(HistoryUpdate(update("user_message_chunk", "hello")), HistoryUpdate(update("agent_message_chunk", "answer"))))
        val result = reconcile(history, listOf(update("agent_message_chunk", "answer extended")), task(), false)
        assertEquals(listOf("hello", "answer extended"), result.map { it.text })
        assertEquals("answer", reconcile(history, listOf(update("agent_message_chunk", "ans")), task(), false).last().text)
        assertEquals("answer", reconcile(history, listOf(update("agent_message_chunk", "answer extended")), task(status = "completed"), true).last().text)
    }
    @Test fun conversationsGroupByDeviceAndAxSessionAndKeepTurnOrder() {
        val snapshot = Snapshot(tasks = listOf(task("z"), task("a", parent = "z")), sessions = listOf(Session("z", "m", "local", "s"), Session("a", "m", "local", "s")))
        val groups = conversations(snapshot)
        assertEquals(1, groups.size); assertEquals("z", groups[0].root.id); assertEquals("a", groups[0].latest.id)
    }
    @Test fun unknownFieldsAreForwardCompatibleAndPermissionUsesExistingShape() {
        val permission = wireJson.decodeFromString<Permission>("""{"request_id":"p","request":{"sessionId":"s","toolCall":{"title":"shell","rawInput":{"command":"echo ok"}},"options":[{"optionId":"allow_once","name":"Allow once"}]},"future":true}""")
        assertEquals("shell", permission.request.toolCall.title)
        assertEquals("allow_once", permission.request.options.single().optionId)
        val event = wireJson.decodeFromString<CrewEvent>("""{"event_id":"e","kind":"agent.message.delta","task_id":"t","payload":{"sessionUpdate":"agent_message_chunk","content":{"text":"live"}},"new_field":1}""")
        assertEquals("live", transcript(listOf(event.payload)).single().text)
    }

    private fun tlsServer(block: (MockWebServer, GatewayApi) -> Unit) {
        val certificate = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverCerts = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientCerts = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        val server = MockWebServer()
        server.useHttps(serverCerts.sslSocketFactory(), false); server.start()
        val client = GatewayApi.defaultClient().newBuilder().proxy(java.net.Proxy.NO_PROXY).sslSocketFactory(clientCerts.sslSocketFactory(), clientCerts.trustManager).build()
        // Windows hosts files can reverse-resolve loopback as kubernetes.docker.internal.
        // Pin the test hostname to the certificate SAN; keep hostname verification enabled.
        try { block(server, GatewayApi(Connection(server.url("/").newBuilder().host("localhost").build().toString(), "test-only-token"), client)) }
        finally { client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll(); server.shutdown() }
    }
    @Test fun httpsPostsPreserveCrewProtocolAndAskDoesNotUpgradeDeny() = tlsServer { server, api -> runBlocking {
        val repo = CrewRepository(api)
        val response = """{"id":"t","crew_id":"c","title":"Title","assigned_member":"m","assigned_device":"local","status":"pending"}"""
        server.enqueue(MockResponse().setBody(response))
        repo.createTask(Member("m", "c", "AX", device_id = "local", cwd = "C:/work", permission_profile = "allow"), "Title", "hello", emptyList(), 0)
        val request = server.takeRequest(3, TimeUnit.SECONDS)!!
        assertEquals("/api/tasks", request.path); assertEquals("Bearer test-only-token", request.getHeader("Authorization"))
        val body = wireJson.parseToJsonElement(request.body.readUtf8()).obj()
        assertEquals("ask", body["input"].obj().str("permission_profile"))
        server.enqueue(MockResponse().setBody(response))
        repo.createTask(Member("m", "c", "AX", device_id = "local", cwd = "C:/work", permission_profile = "deny"), "Title", "hello", emptyList(), 0)
        assertNull(wireJson.parseToJsonElement(server.takeRequest().body.readUtf8()).obj()["input"].obj()["permission_profile"])
        for (choice in listOf("allow_once", "allow_session", "reject_once")) {
            server.enqueue(MockResponse().setBody("""{"resolved":true}"""))
            repo.resolve("p", choice)
            val resolution = server.takeRequest()
            assertEquals("/api/permissions/p/resolve", resolution.path)
            assertEquals(choice, wireJson.parseToJsonElement(resolution.body.readUtf8()).obj().str("option_id"))
        }
    } }
    @Test fun nativeWebSocketUsesHeaderAndStreamsCrewEvents() = tlsServer { server, api -> runBlocking {
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send("""{"event_id":"1","kind":"permission.requested","task_id":"t","payload":{"request_id":"p"}}""")
            }
        }))
        val frames = withTimeout(5000) { api.events().take(2).toList() }
        assertTrue(frames[0] is SocketFrame.Open)
        assertEquals("permission.requested", (frames[1] as SocketFrame.Event).event.kind)
        val request = server.takeRequest()
        assertEquals("/api/ws", request.path)
        assertEquals("Bearer test-only-token", request.getHeader("Authorization"))
    } }
    @Test fun redirectsDoNotForwardCredentials() = tlsServer { server, api -> runBlocking {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://example.com/"))
        assertTrue(runCatching { api.get<List<Device>>("devices") }.isFailure)
        assertEquals(1, server.requestCount)
    } }
    @Test fun reconnectAndForegroundRestartResynchronizePermissionsAndDeduplicateEvents() = tlsServer { server, api -> runBlocking {
        val opens = java.util.concurrent.atomic.AtomicInteger()
        val pending = java.util.concurrent.atomic.AtomicBoolean(true)
        val sockets = java.util.concurrent.CopyOnWriteArrayList<WebSocket>()
        server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                "/api/ws" -> MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        sockets.add(webSocket); opens.incrementAndGet()
                        val event = """{"event_id":"same","kind":"agent.message.delta","task_id":"t","payload":{"sessionUpdate":"agent_message_chunk","content":{"text":"hello"}}}"""
                        webSocket.send(event); webSocket.send(event)
                    }
                })
                "/api/settings" -> MockResponse().setBody("""{"protocol_version":1}""")
                "/api/permissions" -> MockResponse().setBody(if (pending.get()) """[{"request_id":"p","request":{"sessionId":"s","toolCall":{"title":"shell"}}}]""" else "[]")
                else -> MockResponse().setBody("[]")
            }
        }
        val repo = CrewRepository(api)
        val first = launch { repo.run() }
        try {
            withTimeout(8000) { repo.state.first { it.snapshot.permissions.size == 1 && it.streams["t"] != null } }
            assertEquals("hello", transcript(repo.state.value.streams["t"].orEmpty()).single().text)
            pending.set(false); sockets.first().close(1012, "restart")
            withTimeout(12000) { repo.state.first { opens.get() >= 2 && it.snapshot.permissions.isEmpty() } }
        } finally { first.cancelAndJoin() }
        assertEquals("后台暂停", repo.state.value.connection)
        pending.set(true)
        val resumed = launch { repo.run() }
        try { withTimeout(8000) { repo.state.first { opens.get() >= 3 && it.snapshot.permissions.size == 1 } } }
        finally { resumed.cancelAndJoin() }
    } }

    @Test fun chatUsesSessionProtocolWithModelAndImagesAndRejectsUnsupportedFiles() = tlsServer { server, api -> runBlocking {
        val repo = CrewRepository(api)
        server.enqueue(MockResponse().setBody("""{"id":"t","crew_id":"c","title":"photo","assigned_member":"m","assigned_device":"local","status":"running"}"""))
        repo.chat(null, "local", "C:/project", "provider", "model", "high", "review", listOf(Attachment("photo.png", "image/png", "aW1hZ2U=")))
        val request = server.takeRequest()
        assertEquals("/api/sessions", request.path)
        val body = wireJson.parseToJsonElement(request.body.readUtf8()).obj()
        assertEquals("model", body.str("model")); assertEquals("provider", body.str("provider"))
        assertEquals("high", body.str("reasoning_effort"))
        assertEquals("ask", body.str("permission_profile")); assertEquals("C:/project", body.str("cwd"))
        assertEquals("photo.png", (body["images"] as JsonArray).single().obj().str("name"))
        val failure = runCatching { repo.chat(null, "local", "C:/project", null, null, null, "review", listOf(Attachment("a.txt", "text/plain", "dGV4dA=="))) }
        assertTrue(failure.isFailure); assertEquals(1, server.requestCount)
    } }
    @Test fun scheduleEditingPreservesExistingOptionsAndUsesAutomationEndpoints() = tlsServer { server, api -> runBlocking {
        val repo = CrewRepository(api)
        val plan = Automation(id = "a", name = "Build", message = "test", schedule_kind = "weekly", weekdays = "1,3", approval = "ask", silent = true, model = "existing-model")
        server.enqueue(MockResponse().setBody("{}"))
        repo.saveAutomation(plan)
        val request = server.takeRequest()
        assertEquals("PUT", request.method); assertEquals("/api/automations/a", request.path)
        val body = wireJson.parseToJsonElement(request.body.readUtf8()).obj()
        assertEquals("1,3", body.str("weekdays")); assertEquals("existing-model", body.str("model")); assertEquals(JsonPrimitive(true), body["silent"])
        server.enqueue(MockResponse().setBody("{}"))
        repo.deleteAutomation("a")
        assertEquals("DELETE", server.takeRequest().method)
    } }
}
