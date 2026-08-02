package com.agentmobile.app.net

import com.agentmobile.app.model.ApprovalRequest
import com.agentmobile.app.model.ConnectionInfo
import com.agentmobile.app.model.ConsoleLine
import com.agentmobile.app.model.ConsoleLineRole
import com.agentmobile.app.model.DeviceSummary
import com.agentmobile.app.model.AgentCapabilitySummary
import com.agentmobile.app.model.HostDashboardStatus
import com.agentmobile.app.model.PairingPayload
import com.agentmobile.app.model.SessionSummary
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

interface AgentMobileApi {
    fun pair(host: String, port: Int, pairingToken: String, deviceId: String): ConnectionInfo
    fun pair(payload: PairingPayload, deviceId: String): ConnectionInfo =
        pair(payload.host, payload.port, payload.pairingToken, deviceId).copy(
            relayUrl = payload.relayUrl,
            hostId = payload.hostId,
            relayToken = payload.relayToken
        )
    fun reauth(connection: ConnectionInfo): ConnectionInfo
    fun getStatus(connection: ConnectionInfo): HostDashboardStatus
    fun listSessions(connection: ConnectionInfo): List<SessionSummary>
    fun listEvents(connection: ConnectionInfo, lastSeq: Long): List<ConsoleLine>
    fun createSession(connection: ConnectionInfo): SessionSummary
    fun attachSession(connection: ConnectionInfo, sessionId: String)
    fun sendInput(connection: ConnectionInfo, sessionId: String, text: String)
    fun stopSession(connection: ConnectionInfo, sessionId: String)
    fun listApprovals(connection: ConnectionInfo): List<ApprovalRequest>
    fun respondApproval(connection: ConnectionInfo, approvalId: String, decision: String)
    fun listDevices(connection: ConnectionInfo): List<DeviceSummary>
    fun revokeDevice(connection: ConnectionInfo, deviceId: String)
    fun openStream(connection: ConnectionInfo, lastSeq: Long, listener: WebSocketListener): WebSocket
}

class AgentMobileClient(
    private val http: OkHttpClient = OkHttpClient()
) : AgentMobileApi {
    private companion object {
        const val RELAY_RESPONSE_TIMEOUT_SECONDS = 30L
    }

    private val jsonType = "application/json".toMediaType()

    private data class RelayResponse(
        val status: Int,
        val body: String,
        val error: String?
    )

    override fun pair(host: String, port: Int, pairingToken: String, deviceId: String): ConnectionInfo {
        val payload = JSONObject()
            .put("pairingToken", pairingToken)
            .put("deviceId", deviceId)
            .toString()
        val request = Request.Builder()
            .url("http://$host:$port/pair")
            .post(payload.toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            requireSuccessful(response, "Pairing failed")
            val body = JSONObject(response.body!!.string())
            return ConnectionInfo(
                host = host,
                port = port,
                accessToken = body.getString("accessToken"),
                deviceId = body.getString("deviceId"),
                deviceSecret = body.optString("deviceSecret").ifBlank { null }
            )
        }
    }

    override fun pair(payload: PairingPayload, deviceId: String): ConnectionInfo {
        if (payload.relayUrl == null) {
            return super<AgentMobileApi>.pair(payload, deviceId)
        }
        val connection = ConnectionInfo(
            host = payload.host,
            port = payload.port,
            accessToken = "",
            deviceId = deviceId,
            relayUrl = payload.relayUrl,
            hostId = payload.hostId,
            relayToken = payload.relayToken
        )
        val body = JSONObject(
            execute(
                connection = connection,
                method = "POST",
                path = "/pair",
                body = JSONObject()
                    .put("pairingToken", payload.pairingToken)
                    .put("deviceId", deviceId)
                    .toString(),
                message = "Pairing failed"
            )
        )
        return connection.copy(
            accessToken = body.getString("accessToken"),
            deviceId = body.getString("deviceId"),
            deviceSecret = body.optString("deviceSecret").ifBlank { null }
        )
    }

    override fun reauth(connection: ConnectionInfo): ConnectionInfo {
        val payload = JSONObject()
            .put("deviceId", requireNotNull(connection.deviceId) { "Missing deviceId for reauth" })
            .put("deviceSecret", requireNotNull(connection.deviceSecret) { "Missing deviceSecret for reauth" })
            .toString()
        val body = JSONObject(
            execute(
                connection = connection,
                method = "POST",
                path = "/devices/reauth",
                body = payload,
                message = "Reauth failed"
            )
        )
        return connection.copy(
            accessToken = body.getString("accessToken"),
            deviceId = body.optString("deviceId").ifBlank { connection.deviceId },
            deviceSecret = body.optString("deviceSecret").ifBlank { connection.deviceSecret }
        )
    }

    override fun getStatus(connection: ConnectionInfo): HostDashboardStatus {
        val body = JSONObject(executeAuthorized(connection, "GET", "/status", message = "Get status failed"))
        val agents = body.getJSONArray("agents")
        val sessions = body.getJSONArray("sessions")
        return HostDashboardStatus(
            agents = (0 until agents.length()).map { index -> parseAgent(agents.getJSONObject(index)) },
            sessions = (0 until sessions.length()).map { index -> parseSession(sessions.getJSONObject(index)) }
        )
    }

    override fun listSessions(connection: ConnectionInfo): List<SessionSummary> {
        val items = JSONArray(executeAuthorized(connection, "GET", "/sessions", message = "List sessions failed"))
        return (0 until items.length()).map { index ->
            val item = items.getJSONObject(index)
            parseSession(item)
        }
    }

    override fun listEvents(connection: ConnectionInfo, lastSeq: Long): List<ConsoleLine> {
        val items = JSONArray(
            executeAuthorized(connection, "GET", "/events?lastSeq=$lastSeq", message = "List events failed")
        )
        return (0 until items.length()).mapNotNull { index ->
            parseConsoleLine(items.getJSONObject(index))
        }
    }

    override fun createSession(connection: ConnectionInfo): SessionSummary {
        val item = JSONObject(
            executeAuthorized(connection, "POST", "/sessions", "{}", "Create session failed")
        )
        return parseSession(item)
    }

    override fun attachSession(connection: ConnectionInfo, sessionId: String) {
        executeAuthorized(connection, "POST", "/sessions/$sessionId/attach", "{}", "Attach session failed")
    }

    override fun sendInput(connection: ConnectionInfo, sessionId: String, text: String) {
        val payload = JSONObject().put("text", text).toString()
        executeAuthorized(connection, "POST", "/sessions/$sessionId/input", payload, "Send input failed")
    }

    override fun stopSession(connection: ConnectionInfo, sessionId: String) {
        val payload = JSONObject().put("command", "stop").toString()
        executeAuthorized(connection, "POST", "/sessions/$sessionId/control", payload, "Stop session failed")
    }

    override fun listApprovals(connection: ConnectionInfo): List<ApprovalRequest> {
        val items = JSONArray(executeAuthorized(connection, "GET", "/approvals", message = "List approvals failed"))
        return (0 until items.length()).map { index -> parseApproval(items.getJSONObject(index)) }
    }

    override fun respondApproval(connection: ConnectionInfo, approvalId: String, decision: String) {
        val payload = JSONObject().put("decision", decision).toString()
        executeAuthorized(connection, "POST", "/approvals/$approvalId/respond", payload, "Respond approval failed")
    }

    override fun listDevices(connection: ConnectionInfo): List<DeviceSummary> {
        val items = JSONArray(executeAuthorized(connection, "GET", "/devices", message = "List devices failed"))
        return (0 until items.length()).map { index ->
            val item = items.getJSONObject(index)
            DeviceSummary(
                deviceId = item.getString("deviceId"),
                pairedAt = item.getString("pairedAt"),
                revokedAt = item.optString("revokedAt").ifBlank { null }
            )
        }
    }

    override fun revokeDevice(connection: ConnectionInfo, deviceId: String) {
        executeAuthorized(connection, "POST", "/devices/$deviceId/revoke", "{}", "Revoke device failed")
    }

    override fun openStream(connection: ConnectionInfo, lastSeq: Long, listener: WebSocketListener): WebSocket {
        if (connection.relayUrl != null) {
            val requestId = UUID.randomUUID().toString()
            return http.newWebSocket(
                Request.Builder().url(relayAppUrl(connection)).build(),
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        listener.onOpen(webSocket, response)
                        val request = createRelayRequestEnvelope(
                            connection = connection,
                            requestId = requestId,
                            method = "GET",
                            path = "/events?lastSeq=$lastSeq",
                            headers = mapOf("Authorization" to "Bearer ${connection.accessToken}")
                        )
                        if (!webSocket.send(request.toString())) {
                            listener.onFailure(
                                webSocket,
                                IllegalStateException("Unable to request relay event history"),
                                response
                            )
                        }
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        val message = runCatching { JSONObject(text) }.getOrNull()
                        val payload = message?.takeIf { it.optString("type") == "relay.response" }?.optJSONObject("payload")
                        if (payload?.optString("requestId") == requestId) {
                            val events = when (val body = payload.opt("body")) {
                                is JSONArray -> body
                                is String -> runCatching { JSONArray(body) }.getOrNull()
                                else -> null
                            }
                            if (events != null) {
                                for (index in 0 until events.length()) {
                                    events.optJSONObject(index)?.let { event ->
                                        listener.onMessage(webSocket, event.toString())
                                    }
                                }
                            }
                            return
                        }
                        listener.onMessage(webSocket, text)
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        listener.onFailure(webSocket, t, response)
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        listener.onClosed(webSocket, code, reason)
                    }
                }
            )
        }
        val request = Request.Builder()
            .url("ws://${connection.host}:${connection.port}/stream?token=${connection.accessToken}&lastSeq=$lastSeq")
            .build()
        return http.newWebSocket(request, listener)
    }

    private fun executeAuthorized(
        connection: ConnectionInfo,
        method: String,
        path: String,
        body: String? = null,
        message: String
    ): String = execute(
        connection = connection,
        method = method,
        path = path,
        body = body,
        headers = mapOf("Authorization" to "Bearer ${connection.accessToken}"),
        message = message
    )

    private fun execute(
        connection: ConnectionInfo,
        method: String,
        path: String,
        body: String? = null,
        headers: Map<String, String> = emptyMap(),
        message: String
    ): String {
        val requestHeaders = if (body == null) headers else headers + ("Content-Type" to "application/json")
        if (connection.relayUrl != null) {
            val response = executeRelayRequest(connection, method, path, requestHeaders, body)
            requireSuccessful(response.status, response.error ?: message)
            return response.body
        }

        val builder = Request.Builder().url("http://${connection.host}:${connection.port}$path")
        requestHeaders.forEach { (name, value) -> builder.header(name, value) }
        val request = when (method) {
            "GET" -> builder.get().build()
            "POST" -> builder.post((body ?: "").toRequestBody(jsonType)).build()
            else -> throw IllegalArgumentException("Unsupported request method: $method")
        }
        http.newCall(request).execute().use { response ->
            requireSuccessful(response, message)
            return response.body?.string().orEmpty()
        }
    }

    private fun executeRelayRequest(
        connection: ConnectionInfo,
        method: String,
        path: String,
        headers: Map<String, String>,
        body: String?
    ): RelayResponse {
        val requestId = UUID.randomUUID().toString()
        val latch = CountDownLatch(1)
        val result = AtomicReference<RelayResponse?>()
        val failure = AtomicReference<Throwable?>()
        val socket = http.newWebSocket(
            Request.Builder().url(relayAppUrl(connection)).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    val envelope = createRelayRequestEnvelope(
                        connection = connection,
                        requestId = requestId,
                        method = method,
                        path = path,
                        headers = headers,
                        body = body
                    )
                    if (!webSocket.send(envelope.toString())) {
                        failure.compareAndSet(null, IllegalStateException("Unable to send relay request"))
                        latch.countDown()
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                    if (message.optString("type") != "relay.response") {
                        return
                    }
                    val payload = message.optJSONObject("payload") ?: return
                    if (payload.optString("requestId") != requestId) {
                        return
                    }
                    val responseBody = when (val value = payload.opt("body")) {
                        null, JSONObject.NULL -> ""
                        is String -> value
                        else -> value.toString()
                    }
                    result.compareAndSet(
                        null,
                        RelayResponse(
                            status = payload.optInt("status", 500),
                            body = responseBody,
                            error = payload.optString("error").ifBlank { null }
                        )
                    )
                    latch.countDown()
                }

                override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) {
                    failure.compareAndSet(null, throwable)
                    latch.countDown()
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (result.get() == null) {
                        failure.compareAndSet(null, IllegalStateException("Relay WebSocket closed: $code $reason"))
                        latch.countDown()
                    }
                }
            }
        )
        try {
            if (!latch.await(RELAY_RESPONSE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                throw IllegalStateException("Relay request timed out")
            }
            failure.get()?.let { throw IllegalStateException("Relay request failed", it) }
            return result.get() ?: throw IllegalStateException("Relay closed without a response")
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            throw IllegalStateException("Relay request interrupted", error)
        } finally {
            socket.cancel()
        }
    }

    private fun relayAppUrl(connection: ConnectionInfo): HttpUrl {
        val relayUrl = requireNotNull(connection.relayUrl) { "Missing relay URL" }
        val hostId = requireNotNull(connection.hostId) { "Missing relay host ID" }
        val relayToken = requireNotNull(connection.relayToken) { "Missing relay token" }
        require(relayUrl.startsWith("wss://", ignoreCase = true)) { "Relay URL must use wss://" }
        // OkHttp's HttpUrl only models HTTP(S); newWebSocket upgrades this HTTPS request to WSS.
        val base = ("https://" + relayUrl.substringAfter("://")).toHttpUrl()
        return base.newBuilder()
            .encodedPath("/app")
            .query(null)
            .addQueryParameter("hostId", hostId)
            .addQueryParameter("token", relayToken)
            .build()
    }

    private fun createRelayRequestEnvelope(
        connection: ConnectionInfo,
        requestId: String,
        method: String,
        path: String,
        headers: Map<String, String>,
        body: String? = null
    ): JSONObject {
        val payload = JSONObject()
            .put("requestId", requestId)
            .put("method", method)
            .put("path", path)
            .put("headers", JSONObject(headers))
        if (body != null) {
            payload.put("body", body)
        }
        return JSONObject()
            .put("id", "relay_$requestId")
            .put("type", "relay.request")
            .put("deviceId", connection.deviceId ?: "android")
            .put("timestamp", Instant.now().toString())
            .put("seq", 0)
            .put("payload", payload)
    }

    private fun requireSuccessful(response: okhttp3.Response, message: String) {
        requireSuccessful(response.code, message)
    }

    private fun requireSuccessful(statusCode: Int, message: String) {
        if (statusCode in 200..299) {
            return
        }
        if (statusCode == 401) {
            throw UnauthorizedException("$message: $statusCode")
        }
        throw IllegalStateException("$message: $statusCode")
    }

    private fun parseSession(item: JSONObject): SessionSummary =
        SessionSummary(
            id = item.getString("id"),
            adapterId = item.getString("adapterId"),
            title = item.optString("title").ifBlank { null },
            workspace = item.getString("workspace"),
            status = item.getString("status"),
            startedAt = item.getString("startedAt"),
            lastSeq = item.getLong("lastSeq")
        )

    private fun parseAgent(item: JSONObject): AgentCapabilitySummary =
        AgentCapabilitySummary(
            id = item.getString("id"),
            displayName = item.getString("displayName"),
            availability = item.getString("availability"),
            activeSessions = item.getInt("activeSessions"),
            latestSessionStatus = item.optString("latestSessionStatus").ifBlank { null }
        )

    private fun parseConsoleLine(item: JSONObject): ConsoleLine? {
        val type = item.getString("type")
        val role = when (type) {
            "agent.input" -> ConsoleLineRole.USER
            "agent.output" -> ConsoleLineRole.AGENT
            else -> return null
        }
        return ConsoleLine(
            seq = item.getLong("seq"),
            text = item.getJSONObject("payload").getString("text"),
            role = role,
            sessionId = item.optString("sessionId").ifBlank { null }
        )
    }

    private fun parseApproval(item: JSONObject): ApprovalRequest =
        ApprovalRequest(
            approvalId = item.getString("approvalId"),
            sessionId = item.getString("sessionId"),
            risk = item.getString("risk"),
            action = item.getString("action"),
            summary = item.getString("summary"),
            status = item.getString("status"),
            createdAt = item.getString("createdAt"),
            timeoutSeconds = if (item.has("timeoutSeconds")) item.getInt("timeoutSeconds") else null,
            details = item.optString("details").ifBlank { null },
            respondedBy = item.optString("respondedBy").ifBlank { null },
            respondedAt = item.optString("respondedAt").ifBlank { null }
        )
}

class UnauthorizedException(message: String) : IllegalStateException(message)
