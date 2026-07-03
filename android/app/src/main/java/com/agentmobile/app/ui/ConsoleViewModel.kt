package com.agentmobile.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentmobile.app.model.ApprovalRequest
import com.agentmobile.app.model.ConnectionInfo
import com.agentmobile.app.model.ConsoleLine
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
    val session: SessionSummary? = null,
    val lines: List<ConsoleLine> = emptyList(),
    val approvals: List<ApprovalRequest> = emptyList(),
    val lastSeq: Long = 0,
    val error: String? = null,
    val connected: Boolean = false
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
                val sessions = client.listSessions(connection)
                connection to sessions.maxByOrNull { it.lastSeq }
            }.onSuccess { (connection, session) ->
                _state.update {
                    it.copy(
                        connection = connection,
                        session = session,
                        lastSeq = maxOf(it.lastSeq, session?.lastSeq ?: 0),
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

    fun createSession() {
        _state.update { it.copy(error = "Start Codex sessions on the desktop first") }
    }

    fun send(text: String) {
        val connection = _state.value.connection ?: return
        val session = _state.value.session ?: return
        if (text.isBlank() || session.status != "running") return
        viewModelScope.launch(ioDispatcher) {
            runCatching { client.sendInput(connection, session.id, text) }
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
                if (type == "agent.output") {
                    val output = event.getJSONObject("payload").getString("text")
                    _state.update {
                        it.copy(lastSeq = seq, connected = true, lines = it.lines + ConsoleLine(seq, output), error = null)
                    }
                } else if (type == "session.started") {
                    val item = event.getJSONObject("payload").getJSONObject("session")
                    _state.update { it.copy(lastSeq = seq, connected = true, session = parseSession(item), error = null) }
                } else if (type == "session.finished") {
                    _state.update {
                        val current = it.session
                        it.copy(
                            lastSeq = seq,
                            connected = true,
                            session = current?.copy(status = "exited", lastSeq = seq),
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
            workspace = item.getString("workspace"),
            status = item.getString("status"),
            startedAt = item.getString("startedAt"),
            lastSeq = item.getLong("lastSeq")
        )

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
