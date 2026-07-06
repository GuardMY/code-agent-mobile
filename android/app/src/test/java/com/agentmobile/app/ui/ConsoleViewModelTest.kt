package com.agentmobile.app.ui

import com.agentmobile.app.model.ConnectionInfo
import com.agentmobile.app.model.AgentCapabilitySummary
import com.agentmobile.app.model.ApprovalRequest
import com.agentmobile.app.model.ConsoleLine
import com.agentmobile.app.model.ConsoleLineRole
import com.agentmobile.app.model.DeviceSummary
import com.agentmobile.app.model.HostDashboardStatus
import com.agentmobile.app.model.SessionSummary
import com.agentmobile.app.net.AgentMobileApi
import com.agentmobile.app.net.UnauthorizedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
    fun connectLoadsDesktopDashboardAndStartsOnSessionList() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(
            sessions = listOf(
                session("sess_old", "exited", 3),
                session("sess_new", "running", 9)
            )
        )
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()

        assertEquals(listOf("sess_old", "sess_new"), viewModel.state.value.sessions.map { it.id })
        assertEquals("Codex", viewModel.state.value.agents.single().displayName)
        assertNull(viewModel.state.value.session)
        assertEquals(false, viewModel.state.value.showingSessionDetail)
        assertEquals(9L, viewModel.state.value.lastSeq)
        assertEquals(1, client.openStreamCalls)
        assertEquals(0, client.createSessionCalls)
    }

    @Test
    fun connectReauthsAfter401AndRetriesStatus() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(
            sessions = listOf(session("sess_new", "running", 9)),
            failStatusOnceWith401 = true
        )
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()

        assertTrue(client.reauthCalled)
        assertEquals("access_456", viewModel.state.value.connection?.accessToken)
        assertEquals(listOf("access_123", "access_456"), client.statusAccessTokens)
        assertEquals(true, viewModel.state.value.connected)
    }

    @Test
    fun streamReauthUsesLatestRotatedDeviceCredentialsInsteadOfCapturedConnection() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(
            sessions = listOf(session("sess_1", "running", 5)),
            failSendOnceWith401 = true,
            rotateCredentialsOnReauth = true
        )
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        val staleListener = client.listener
        viewModel.selectSession("sess_1")
        advanceUntilIdle()

        viewModel.send("hello")
        advanceUntilIdle()

        staleListener!!.onFailure(FakeWebSocket(), RuntimeException("expired"), unauthorizedResponse())
        advanceUntilIdle()

        assertEquals(listOf("secret_123", "secret_456"), client.reauthDeviceSecrets)
        assertEquals("secret_789", viewModel.state.value.connection?.deviceSecret)
    }

    @Test
    fun connectReplacesOlderStateConnectionWithFreshlyPairedConnection() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(
            sessions = listOf(session("sess_1", "running", 5)),
            pairResponses = listOf(
                ConnectionInfo("127.0.0.1", 17365, "access_old", deviceId = "android-old", deviceSecret = "secret_old"),
                ConnectionInfo("10.0.0.8", 18444, "access_new", deviceId = "android-new", deviceSecret = "secret_new")
            )
        )
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson(host = "127.0.0.1", port = 17365))
        advanceUntilIdle()
        viewModel.connect(pairingJson(host = "10.0.0.8", port = 18444))
        advanceUntilIdle()

        assertEquals("10.0.0.8", viewModel.state.value.connection?.host)
        assertEquals(18444, viewModel.state.value.connection?.port)
        assertEquals("access_new", viewModel.state.value.connection?.accessToken)
        assertEquals("secret_new", viewModel.state.value.connection?.deviceSecret)
    }

    @Test
    fun connectResetsLastSeqWhenReconnectingToDifferentHost() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(
            sessionsByPair = listOf(
                listOf(session("sess_old", "running", 50)),
                listOf(session("sess_new", "running", 5))
            ),
            pairResponses = listOf(
                ConnectionInfo("127.0.0.1", 17365, "access_old", deviceId = "android-old", deviceSecret = "secret_old"),
                ConnectionInfo("10.0.0.8", 18444, "access_new", deviceId = "android-new", deviceSecret = "secret_new")
            )
        )
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson(host = "127.0.0.1", port = 17365))
        advanceUntilIdle()
        viewModel.connect(pairingJson(host = "10.0.0.8", port = 18444))
        advanceUntilIdle()

        assertEquals(5L, viewModel.state.value.lastSeq)
        assertEquals(5L, client.lastSeqs.last())
    }

    @Test
    fun selectSessionOpensSessionDetail() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(
            sessions = listOf(
                session("sess_old", "exited", 3),
                session("sess_new", "running", 9)
            )
        )
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        viewModel.selectSession("sess_new")

        assertEquals("sess_new", viewModel.state.value.session?.id)
        assertEquals(true, viewModel.state.value.showingSessionDetail)
    }

    @Test
    fun showSessionListReturnsFromSessionDetail() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("sess_new", "running", 9)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        viewModel.selectSession("sess_new")
        viewModel.showSessionList()

        assertNull(viewModel.state.value.session)
        assertEquals(false, viewModel.state.value.showingSessionDetail)
    }

    @Test
    fun selectSessionLoadsCachedHistoryForThatSession() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(
            sessions = listOf(
                session("sess_old", "running", 3),
                session("sess_new", "running", 9)
            ),
            events = listOf(
                ConsoleLine(2, "old session output", ConsoleLineRole.AGENT, "sess_old"),
                ConsoleLine(7, "new session history", ConsoleLineRole.AGENT, "sess_new")
            )
        )
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        viewModel.selectSession("sess_new")
        advanceUntilIdle()

        assertEquals(listOf("new session history"), viewModel.state.value.lines.map { it.text })
        assertEquals(0L, client.listEventsLastSeqs.single())
    }

    @Test
    fun createSessionDoesNotCreateMobileCodexSessions() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("codex_thr_1", "running", 5)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        viewModel.selectSession("codex_thr_1")
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
        viewModel.selectSession("sess_done")
        viewModel.send("hello")
        advanceUntilIdle()

        assertNull(client.sentText)
    }

    @Test
    fun sendAddsUserLineToConversation() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("sess_1", "running", 5)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        viewModel.selectSession("sess_1")
        viewModel.send("show **status**")
        advanceUntilIdle()

        assertEquals("show **status**", client.sentText)
        assertEquals(ConsoleLineRole.USER, viewModel.state.value.lines.single().role)
        assertEquals("show **status**", viewModel.state.value.lines.single().text)
    }

    @Test
    fun agentOutputAddsAgentLineToConversation() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("sess_1", "running", 5)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        client.listener!!.onMessage(
            FakeWebSocket(),
            """
            {
              "type": "agent.output",
              "seq": 6,
              "payload": {
                "text": "## Done\n- Built APK"
              }
            }
            """.trimIndent()
        )

        assertEquals(ConsoleLineRole.AGENT, viewModel.state.value.lines.single().role)
        assertEquals("## Done\n- Built APK", viewModel.state.value.lines.single().text)
    }

    @Test
    fun agentInputAddsUserLineFromStream() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("sess_1", "running", 5)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        client.listener!!.onMessage(
            FakeWebSocket(),
            """
            {
              "type": "agent.input",
              "sessionId": "sess_1",
              "seq": 6,
              "payload": {
                "text": "你好"
              }
            }
            """.trimIndent()
        )

        assertEquals(ConsoleLineRole.USER, viewModel.state.value.lines.single().role)
        assertEquals("你好", viewModel.state.value.lines.single().text)
    }

    @Test
    fun sendKeepsLocalUserLineAheadOfNextAgentOutput() = runTest(dispatcher) {
        val client = FakeAgentMobileApi(sessions = listOf(session("sess_1", "running", 5)))
        val viewModel = ConsoleViewModel(client, dispatcher, reconnectDelayMs = 1)

        viewModel.connect(pairingJson())
        advanceUntilIdle()
        viewModel.selectSession("sess_1")
        advanceUntilIdle()
        viewModel.send("你好")
        client.listener!!.onMessage(
            FakeWebSocket(),
            """
            {
              "type": "agent.output",
              "sessionId": "sess_1",
              "seq": 6,
              "payload": {
                "text": "你好。请直接说需求。"
              }
            }
            """.trimIndent()
        )

        assertEquals(2, viewModel.state.value.lines.size)
        assertEquals(ConsoleLineRole.USER, viewModel.state.value.lines[0].role)
        assertEquals("你好", viewModel.state.value.lines[0].text)
        assertEquals(ConsoleLineRole.AGENT, viewModel.state.value.lines[1].role)
        assertEquals("你好。请直接说需求。", viewModel.state.value.lines[1].text)
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

    private fun pairingJson(
        host: String = "127.0.0.1",
        port: Int = 17365
    ): String =
        """
        {
          "host": "$host",
          "port": $port,
          "pairingToken": "pairing-token-123",
          "deviceName": "VS Code"
        }
        """.trimIndent()

    private fun unauthorizedResponse(): Response =
        Response.Builder()
            .request(Request.Builder().url("http://127.0.0.1").build())
            .protocol(Protocol.HTTP_1_1)
            .code(401)
            .message("Unauthorized")
            .build()

    private fun session(id: String, status: String, lastSeq: Long): SessionSummary =
        SessionSummary(
            id = id,
            adapterId = "codex",
            workspace = "E:/repo",
            status = status,
            startedAt = "2026-06-30T14:30:00.000Z",
            lastSeq = lastSeq
        )
}

private class FakeAgentMobileApi(
    private val sessions: List<SessionSummary> = emptyList(),
    private val events: List<ConsoleLine> = emptyList(),
    var failStatusOnceWith401: Boolean = false,
    var failSendOnceWith401: Boolean = false,
    var rotateCredentialsOnReauth: Boolean = false,
    sessionsByPair: List<List<SessionSummary>> = emptyList(),
    pairResponses: List<ConnectionInfo> = emptyList()
) : AgentMobileApi {
    private val pairQueue = ArrayDeque(pairResponses)
    private val sessionQueue = ArrayDeque(sessionsByPair)
    var sentText: String? = null
    var listener: WebSocketListener? = null
    var openStreamCalls = 0
    var createSessionCalls = 0
    var approvalDecision: String? = null
    var reauthCalled = false
    var reauthCount = 0
    val lastSeqs = mutableListOf<Long>()
    val listEventsLastSeqs = mutableListOf<Long>()
    val statusAccessTokens = mutableListOf<String>()
    val reauthDeviceSecrets = mutableListOf<String>()

    override fun pair(host: String, port: Int, pairingToken: String, deviceId: String): ConnectionInfo =
        pairQueue.removeFirstOrNull()
            ?: ConnectionInfo(host, port, "access_123", deviceId = "android-001", deviceSecret = "secret_123")

    override fun reauth(connection: ConnectionInfo): ConnectionInfo {
        reauthCalled = true
        reauthCount += 1
        reauthDeviceSecrets += connection.deviceSecret.orEmpty()
        return if (rotateCredentialsOnReauth) {
            when (reauthCount) {
                1 -> connection.copy(accessToken = "access_456", deviceSecret = "secret_456")
                else -> connection.copy(accessToken = "access_789", deviceSecret = "secret_789")
            }
        } else {
            connection.copy(accessToken = "access_456")
        }
    }

    override fun listSessions(connection: ConnectionInfo): List<SessionSummary> = sessions

    override fun listEvents(connection: ConnectionInfo, lastSeq: Long): List<ConsoleLine> {
        listEventsLastSeqs += lastSeq
        return events.filter { it.seq > lastSeq }
    }

    override fun getStatus(connection: ConnectionInfo): HostDashboardStatus =
        run {
            statusAccessTokens += connection.accessToken
            if (failStatusOnceWith401) {
                failStatusOnceWith401 = false
                throw UnauthorizedException("Get status failed: 401")
            }
            val currentSessions = sessionQueue.removeFirstOrNull() ?: sessions
            HostDashboardStatus(
                agents = listOf(AgentCapabilitySummary("codex", "Codex", "available", 1, "running")),
                sessions = currentSessions
            )
        }

    override fun createSession(connection: ConnectionInfo): SessionSummary {
        createSessionCalls += 1
        return sessions.first()
    }

    override fun attachSession(connection: ConnectionInfo, sessionId: String) = Unit

    override fun sendInput(connection: ConnectionInfo, sessionId: String, text: String) {
        if (failSendOnceWith401) {
            failSendOnceWith401 = false
            throw UnauthorizedException("Send input failed: 401")
        }
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
