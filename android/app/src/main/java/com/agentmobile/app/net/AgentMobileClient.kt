package com.agentmobile.app.net

import com.agentmobile.app.model.ApprovalRequest
import com.agentmobile.app.model.ConnectionInfo
import com.agentmobile.app.model.ConsoleLine
import com.agentmobile.app.model.ConsoleLineRole
import com.agentmobile.app.model.DeviceSummary
import com.agentmobile.app.model.AgentCapabilitySummary
import com.agentmobile.app.model.HostDashboardStatus
import com.agentmobile.app.model.SessionSummary
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

interface AgentMobileApi {
    fun pair(host: String, port: Int, pairingToken: String, deviceId: String): ConnectionInfo
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
    private val jsonType = "application/json".toMediaType()

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
            check(response.isSuccessful) { "Pairing failed: ${response.code}" }
            val body = JSONObject(response.body!!.string())
            return ConnectionInfo(host, port, body.getString("accessToken"))
        }
    }

    override fun getStatus(connection: ConnectionInfo): HostDashboardStatus {
        val request = authorized(connection, "/status").get().build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Get status failed: ${response.code}" }
            val body = JSONObject(response.body!!.string())
            val agents = body.getJSONArray("agents")
            val sessions = body.getJSONArray("sessions")
            return HostDashboardStatus(
                agents = (0 until agents.length()).map { index -> parseAgent(agents.getJSONObject(index)) },
                sessions = (0 until sessions.length()).map { index -> parseSession(sessions.getJSONObject(index)) }
            )
        }
    }

    override fun listSessions(connection: ConnectionInfo): List<SessionSummary> {
        val request = authorized(connection, "/sessions").get().build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "List sessions failed: ${response.code}" }
            val items = JSONArray(response.body!!.string())
            return (0 until items.length()).map { index ->
                val item = items.getJSONObject(index)
                parseSession(item)
            }
        }
    }

    override fun listEvents(connection: ConnectionInfo, lastSeq: Long): List<ConsoleLine> {
        val request = authorized(connection, "/events?lastSeq=$lastSeq").get().build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "List events failed: ${response.code}" }
            val items = JSONArray(response.body!!.string())
            return (0 until items.length()).mapNotNull { index ->
                parseConsoleLine(items.getJSONObject(index))
            }
        }
    }

    override fun createSession(connection: ConnectionInfo): SessionSummary {
        val request = authorized(connection, "/sessions").post("{}".toRequestBody(jsonType)).build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Create session failed: ${response.code}" }
            val item = JSONObject(response.body!!.string())
            return parseSession(item)
        }
    }

    override fun attachSession(connection: ConnectionInfo, sessionId: String) {
        val request = authorized(connection, "/sessions/$sessionId/attach")
            .post("{}".toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Attach session failed: ${response.code}" }
        }
    }

    override fun sendInput(connection: ConnectionInfo, sessionId: String, text: String) {
        val payload = JSONObject().put("text", text).toString()
        val request = authorized(connection, "/sessions/$sessionId/input")
            .post(payload.toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Send input failed: ${response.code}" }
        }
    }

    override fun stopSession(connection: ConnectionInfo, sessionId: String) {
        val payload = JSONObject().put("command", "stop").toString()
        val request = authorized(connection, "/sessions/$sessionId/control")
            .post(payload.toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Stop session failed: ${response.code}" }
        }
    }

    override fun listApprovals(connection: ConnectionInfo): List<ApprovalRequest> {
        val request = authorized(connection, "/approvals").get().build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "List approvals failed: ${response.code}" }
            val items = JSONArray(response.body!!.string())
            return (0 until items.length()).map { index -> parseApproval(items.getJSONObject(index)) }
        }
    }

    override fun respondApproval(connection: ConnectionInfo, approvalId: String, decision: String) {
        val payload = JSONObject().put("decision", decision).toString()
        val request = authorized(connection, "/approvals/$approvalId/respond")
            .post(payload.toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Respond approval failed: ${response.code}" }
        }
    }

    override fun listDevices(connection: ConnectionInfo): List<DeviceSummary> {
        val request = authorized(connection, "/devices").get().build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "List devices failed: ${response.code}" }
            val items = JSONArray(response.body!!.string())
            return (0 until items.length()).map { index ->
                val item = items.getJSONObject(index)
                DeviceSummary(
                    deviceId = item.getString("deviceId"),
                    pairedAt = item.getString("pairedAt"),
                    revokedAt = item.optString("revokedAt").ifBlank { null }
                )
            }
        }
    }

    override fun revokeDevice(connection: ConnectionInfo, deviceId: String) {
        val request = authorized(connection, "/devices/$deviceId/revoke")
            .post("{}".toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Revoke device failed: ${response.code}" }
        }
    }

    override fun openStream(connection: ConnectionInfo, lastSeq: Long, listener: WebSocketListener): WebSocket {
        val request = Request.Builder()
            .url("ws://${connection.host}:${connection.port}/stream?token=${connection.accessToken}&lastSeq=$lastSeq")
            .build()
        return http.newWebSocket(request, listener)
    }

    private fun authorized(connection: ConnectionInfo, path: String): Request.Builder =
        Request.Builder()
            .url("http://${connection.host}:${connection.port}$path")
            .header("Authorization", "Bearer ${connection.accessToken}")

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
        if (item.getString("type") != "agent.output") {
            return null
        }
        return ConsoleLine(
            seq = item.getLong("seq"),
            text = item.getJSONObject("payload").getString("text"),
            role = ConsoleLineRole.AGENT,
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
            timeoutSeconds = if (item.has("timeoutSeconds")) item.getInt("timeoutSeconds") else null
        )
}
