package com.agentmobile.app.ui

import com.agentmobile.app.model.ConnectionInfo
import com.agentmobile.app.model.ApprovalRequest
import com.agentmobile.app.model.DeviceSummary
import com.agentmobile.app.model.SessionSummary
import com.agentmobile.app.net.AgentMobileApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConsoleViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun connectLoadsSessionsAndSelectsMostRecent() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(
            sessions = listOf(
                session("sess_old", "exited", 3),
                session("sess_new", "running", 9)
            )
        )
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()

        assertEquals("sess_new", viewModel.state.value.session?.id)
        assertEquals(9L, viewModel.state.value.lastSeq)
        assertEquals(1, client.openStreamCalls)
        assertEquals(0, client.createSessionCalls)
    }

    @Test
    fun createSessionDoesNotCreateMobileCodexSessions() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("codex_thr_1", "running", 5)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        viewModel.createSession()
        advanceUntilIdle()

        assertEquals(0, client.createSessionCalls)
        assertEquals("codex_thr_1", viewModel.state.value.session?.id)
    }

    @Test
    fun sendIgnoresNonRunningSession() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("sess_done", "exited", 4)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        viewModel.send("hello")
        advanceUntilIdle()

        assertNull(client.sentText)
    }

    @Test
    fun streamFailureSchedulesReconnectWithLastSeq() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("sess_1", "running", 5)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        client.listener!!.onFailure(FakeWebSocket(), RuntimeException("offline"), null)
        advanceUntilIdle()

        assertEquals(2, client.openStreamCalls)
        assertEquals(5L, client.lastSeqs.last())
    }

    @Test
    fun approvalRequiredAddsPendingApproval() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("sess_1", "running", 5)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        client.listener!!.onMessage(
            FakeWebSocket(),
            """
            {
              "type": "approval.required",
              "seq": 6,
              "payload": {
                "approval": {
                  "approvalId": "appr_1",
                  "sessionId": "sess_1",
                  "risk": "high",
                  "action": "shell.execute",
                  "summary": "npm install",
                  "status": "pending",
                  "createdAt": "2026-06-30T14:30:00.000Z",
                  "timeoutSeconds": 300
                }
              }
            }
            """.trimIndent()
        )

        assertEquals("appr_1", viewModel.state.value.approvals.single().approvalId)
    }

    @Test
    fun respondApprovalRemovesPendingApproval() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("sess_1", "running", 5)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        client.listener!!.onMessage(
            FakeWebSocket(),
            """
            {
              "type": "approval.required",
              "seq": 6,
              "payload": {
                "approval": {
                  "approvalId": "appr_1",
                  "sessionId": "sess_1",
                  "risk": "high",
                  "action": "shell.execute",
                  "summary": "npm install",
                  "status": "pending",
                  "createdAt": "2026-06-30T14:30:00.000Z"
                }
              }
            }
            """.trimIndent()
        )
        viewModel.respondApproval("appr_1", "approve")
        advanceUntilIdle()

        assertEquals("approve", client.approvalDecision)
        assertEquals(0, viewModel.state.value.approvals.size)
    }

    private fun pairingJson(): String =
        """
        {
          "host": "127.0.0.1",
          "port": 17365,
          "pairingToken": "pairing-token-123",
          "deviceName": "VS Code",
          "expiresAt": "2026-06-30T14:30:00.000Z"
        }
        """.trimIndent()

    private fun session(id: String, status: String, lastSeq: Long): SessionSummary =
        SessionSummary(id, "codex", "E:/repo", status, "2026-06-30T14:30:00.000Z", lastSeq)
}

private class FakeAgentMobileApi(
    private val sessions: List<SessionSummary>
) : AgentMobileApi {
    var sentText: String? = null
    var listener: WebSocketListener? = null
    var openStreamCalls = 0
    var createSessionCalls = 0
    var approvalDecision: String? = null
    val lastSeqs = mutableListOf<Long>()

    override fun pair(host: String, port: Int, pairingToken: String, deviceId: String): ConnectionInfo =
        ConnectionInfo(host, port, "access_123")

    override fun listSessions(connection: ConnectionInfo): List<SessionSummary> = sessions

    override fun createSession(connection: ConnectionInfo): SessionSummary {
        createSessionCalls += 1
        return sessions.first()
    }

    override fun sendInput(connection: ConnectionInfo, sessionId: String, text: String) {
        sentText = text
    }

    override fun stopSession(connection: ConnectionInfo, sessionId: String) = Unit

    override fun listApprovals(connection: ConnectionInfo): List<ApprovalRequest> = emptyList()

    override fun respondApproval(connection: ConnectionInfo, approvalId: String, decision: String) {
        approvalDecision = decision
    }

    override fun listDevices(connection: ConnectionInfo): List<DeviceSummary> = emptyList()

    override fun revokeDevice(connection: ConnectionInfo, deviceId: String) = Unit

    override fun openStream(connection: ConnectionInfo, lastSeq: Long, listener: WebSocketListener): WebSocket {
        openStreamCalls += 1
        lastSeqs += lastSeq
        this.listener = listener
        return FakeWebSocket()
    }
}

private class FakeWebSocket : WebSocket {
    override fun request(): okhttp3.Request = okhttp3.Request.Builder().url("ws://127.0.0.1").build()
    override fun queueSize(): Long = 0
    override fun send(text: String): Boolean = true
    override fun send(bytes: okio.ByteString): Boolean = true
    override fun close(code: Int, reason: String?): Boolean = true
    override fun cancel() = Unit
}
