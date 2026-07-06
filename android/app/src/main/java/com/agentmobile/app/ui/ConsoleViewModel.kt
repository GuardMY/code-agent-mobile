package com.agentmobile.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentmobile.app.model.ApprovalRequest
import com.agentmobile.app.model.AgentCapabilitySummary
import com.agentmobile.app.model.ConnectionInfo
import com.agentmobile.app.model.ConsoleLine
import com.agentmobile.app.model.ConsoleLineRole
import com.agentmobile.app.model.PairingPayload
import com.agentmobile.app.model.SessionSummary
import com.agentmobile.app.net.AgentMobileApi
import com.agentmobile.app.net.AgentMobileClient
import com.agentmobile.app.net.PairingParser
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

data class ConsoleUiState(
    val connection: ConnectionInfo? = null,
    val agents: List<AgentCapabilitySummary> = emptyList(),
    val sessions: List<SessionSummary> = emptyList(),
    val session: SessionSummary? = null,
    val lines: List<ConsoleLine> = emptyList(),
    val approvals: List<ApprovalRequest> = emptyList(),
    val lastSeq: Long = 0,
    val error: String? = null,
    val connected: Boolean = false,
    val showingSessionDetail: Boolean = false
)

class ConsoleViewModel(
    private val client: AgentMobileApi = AgentMobileClient(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val reconnectDelayMs: Long = 1_000,
    private val maxReconnectAttempts: Int = 3
) : ViewModel() {
    private val _state = MutableStateFlow(ConsoleUiState())
    val state: StateFlow<ConsoleUiState> = _state
    private var socket: WebSocket? = null
    private var reconnectAttempts = 0

    fun connect(pairingJson: String) {
        viewModelScope.launch(ioDispatcher) {
            runCatching {
                val payload: PairingPayload = PairingParser.parse(pairingJson)
                val connection = client.pair(payload.host, payload.port, payload.pairingToken, "android")
                val status = client.getStatus(connection)
                connection to status
            }.onSuccess { (connection, status) ->
                val lastSeq = status.sessions.maxOfOrNull { it.lastSeq } ?: 0
                _state.update {
                    it.copy(
                        connection = connection,
                        agents = status.agents,
                        sessions = status.sessions,
                        session = null,
                        showingSessionDetail = false,
                        lastSeq = maxOf(it.lastSeq, lastSeq),
                        connected = true,
                        error = null
                    )
                }
                reconnectStream(connection)
            }.onFailure { error ->
                _state.update { it.copy(error = error.message, connected = false) }
            }
        }
    }

    fun selectSession(sessionId: String) {
        val connection = _state.value.connection ?: return
        val selected = _state.value.sessions.firstOrNull { it.id == sessionId } ?: return
        _state.update { it.copy(session = selected, showingSessionDetail = true, error = null) }
        viewModelScope.launch(ioDispatcher) {
            runCatching {
                val history = client.listEvents(connection, 0)
                    .filter { it.sessionId == null || it.sessionId == sessionId }
                client.attachSession(connection, sessionId)
                history
            }.onSuccess { history ->
                _state.update {
                    it.copy(
                        lines = mergeLines(it.lines, history),
                        lastSeq = maxOf(it.lastSeq, history.maxOfOrNull { line -> line.seq } ?: 0),
                        error = null
                    )
                }
            }
                .onFailure { error -> _state.update { it.copy(error = error.message) } }
        }
    }

    fun showSessionList() {
        _state.update { it.copy(showingSessionDetail = false, session = null, error = null) }
    }

    fun createSession() {
        _state.update { it.copy(error = "Start Codex sessions on the desktop first") }
    }

    fun send(text: String) {
        val connection = _state.value.connection ?: return
        val session = _state.value.session ?: return
        if (text.isBlank() || session.status != "running") return
        val trimmedText = text.trim()
        _state.update {
            it.copy(lines = it.lines + ConsoleLine(nextLocalSeq(it.lines), trimmedText, ConsoleLineRole.USER, session.id), error = null)
        }
        viewModelScope.launch(ioDispatcher) {
            runCatching { client.sendInput(connection, session.id, trimmedText) }
                .onFailure { error -> _state.update { it.copy(error = error.message) } }
        }
    }

    fun stop() {
        val connection = _state.value.connection ?: return
        val session = _state.value.session ?: return
        if (session.status != "running") return
        viewModelScope.launch(ioDispatcher) {
            runCatching { client.stopSession(connection, session.id) }
                .onFailure { error -> _state.update { it.copy(error = error.message) } }
        }
    }

    fun respondApproval(approvalId: String, decision: String) {
        val connection = _state.value.connection ?: return
        viewModelScope.launch(ioDispatcher) {
            runCatching { client.respondApproval(connection, approvalId, decision) }
                .onSuccess {
                    _state.update { state ->
                        state.copy(approvals = state.approvals.filterNot { it.approvalId == approvalId }, error = null)
                    }
                }
                .onFailure { error -> _state.update { it.copy(error = error.message) } }
        }
    }

    private fun reconnectStream(connection: ConnectionInfo) {
        socket?.cancel()
        socket = client.openStream(connection, _state.value.lastSeq, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                reconnectAttempts = 0
                val event = JSONObject(text)
                val seq = event.getLong("seq")
                val type = event.getString("type")
                if (type == "agent.output" || type == "agent.input") {
                    val output = event.getJSONObject("payload").getString("text")
                    val sessionId = event.optString("sessionId").ifBlank { null }
                    val role = if (type == "agent.input") ConsoleLineRole.USER else ConsoleLineRole.AGENT
                    _state.update {
                        it.copy(
                            lastSeq = seq,
                            connected = true,
                            lines = mergeLines(it.lines, listOf(ConsoleLine(seq, output, role, sessionId))),
                            error = null
                        )
                    }
                } else if (type == "session.started") {
                    val item = event.getJSONObject("payload").getJSONObject("session")
                    val session = parseSession(item)
                    _state.update {
                        it.copy(
                            lastSeq = seq,
                            connected = true,
                            sessions = upsertSession(it.sessions, session),
                            session = if (it.session?.id == session.id) session else it.session,
                            error = null
                        )
                    }
                } else if (type == "session.finished") {
                    _state.update {
                        val current = it.session
                        val sessionId = event.optString("sessionId").ifBlank { current?.id }
                        it.copy(
                            lastSeq = seq,
                            connected = true,
                            sessions = it.sessions.map { session ->
                                if (session.id == sessionId) session.copy(status = "exited", lastSeq = seq) else session
                            },
                            session = current?.let { session ->
                                if (session.id == sessionId) session.copy(status = "exited", lastSeq = seq) else session
                            },
                            error = null
                        )
                    }
                } else if (type == "approval.required") {
                    val approval = parseApproval(event.getJSONObject("payload").getJSONObject("approval"))
                    _state.update {
                        it.copy(
                            lastSeq = seq,
                            connected = true,
                            approvals = (it.approvals.filterNot { existing -> existing.approvalId == approval.approvalId } + approval),
                            error = null
                        )
                    }
                } else if (type == "approval.approve" || type == "approval.deny") {
                    val approval = parseApproval(event.getJSONObject("payload").getJSONObject("approval"))
                    _state.update {
                        it.copy(
                            lastSeq = seq,
                            connected = true,
                            approvals = it.approvals.filterNot { existing -> existing.approvalId == approval.approvalId },
                            error = null
                        )
                    }
                } else {
                    _state.update { it.copy(lastSeq = seq, connected = true) }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _state.update { it.copy(connected = false, error = t.message) }
                scheduleReconnect(connection)
            }
        })
    }

    private fun scheduleReconnect(connection: ConnectionInfo) {
        if (reconnectAttempts >= maxReconnectAttempts) {
            return
        }
        reconnectAttempts += 1
        viewModelScope.launch(ioDispatcher) {
            delay(reconnectDelayMs)
            reconnectStream(connection)
        }
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

    private fun upsertSession(sessions: List<SessionSummary>, session: SessionSummary): List<SessionSummary> =
        if (sessions.any { it.id == session.id }) {
            sessions.map { if (it.id == session.id) session else it }
        } else {
            sessions + session
        }

    private fun mergeLines(current: List<ConsoleLine>, incoming: List<ConsoleLine>): List<ConsoleLine> =
        (current + incoming)
            .distinctBy { line -> "${line.seq}:${line.sessionId}:${line.role}:${line.text}" }
            .sortedBy { line -> line.seq }

    private fun nextLocalSeq(lines: List<ConsoleLine>): Long =
        lines.map { it.seq }
            .filter { it < 0 }
            .minOrNull()
            ?.minus(1)
            ?: -1L

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
