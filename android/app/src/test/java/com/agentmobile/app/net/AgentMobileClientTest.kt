package com.agentmobile.app.net

import com.agentmobile.app.model.PairingPayload
import okhttp3.OkHttpClient
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import com.agentmobile.app.model.ConnectionInfo
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class AgentMobileClientTest {
    @Test
    fun relayPairAuthorizedRequestAndStreamUseAppWebSocket() {
        val certificate = HeldCertificate.Builder()
            .addSubjectAlternativeName("localhost")
            .addSubjectAlternativeName("127.0.0.1")
            .build()
        val serverCertificates = HandshakeCertificates.Builder()
            .heldCertificate(certificate)
            .build()
        val clientCertificates = HandshakeCertificates.Builder()
            .addTrustedCertificate(certificate.certificate)
            .build()
        val envelopes = LinkedBlockingQueue<JSONObject>()
        val streamedEvents = CountDownLatch(2)

        MockWebServer().use { server ->
            server.useHttps(serverCertificates.sslSocketFactory(), false)
            server.enqueue(relayResponse(envelopes) { request ->
                JSONObject()
                    .put("accessToken", "access_123")
                    .put("deviceId", "android_installation")
                    .put("deviceSecret", "secret_123")
            })
            server.enqueue(relayResponse(envelopes) {
                JSONObject()
                    .put("agents", org.json.JSONArray())
                    .put("sessions", org.json.JSONArray())
            })
            server.enqueue(
                MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                        webSocket.send(
                            """{"type":"agent.output","seq":9,"payload":{"text":"relay event"}}"""
                        )
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        val envelope = JSONObject(text)
                        envelopes.offer(envelope)
                        val request = envelope.getJSONObject("payload")
                        webSocket.send(
                            JSONObject()
                                .put("type", "relay.response")
                                .put(
                                    "payload",
                                    JSONObject()
                                        .put("requestId", request.getString("requestId"))
                                        .put("status", 200)
                                        .put(
                                            "body",
                                            org.json.JSONArray().put(
                                                JSONObject()
                                                    .put("type", "agent.output")
                                                    .put("seq", 8)
                                                    .put("payload", JSONObject().put("text", "relay backlog"))
                                            )
                                        )
                                )
                                .toString()
                        )
                    }
                })
            )
            server.start()
            val http = OkHttpClient.Builder()
                .sslSocketFactory(clientCertificates.sslSocketFactory(), clientCertificates.trustManager)
                .build()
            val client = AgentMobileClient(http)
            val relayUrl = server.url("/").toString().replaceFirst("https://", "wss://")
            val pairing = PairingPayload(
                host = "127.0.0.1",
                port = 17365,
                pairingToken = "pairing-token-123",
                deviceName = "VS Code",
                relayUrl = relayUrl,
                hostId = "host_12345678",
                relayToken = "relay-token-123456"
            )

            val connection = client.pair(pairing, "android_installation")
            val status = client.getStatus(connection)
            val stream = client.openStream(connection, 7, object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (text.contains("relay event") || text.contains("relay backlog")) {
                        streamedEvents.countDown()
                    }
                }
            })

            val pairHandshake = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            val statusHandshake = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            val streamHandshake = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            val pairEnvelope = requireNotNull(envelopes.poll(5, TimeUnit.SECONDS))
            val statusEnvelope = requireNotNull(envelopes.poll(5, TimeUnit.SECONDS))

            assertEquals("access_123", connection.accessToken)
            assertEquals("secret_123", connection.deviceSecret)
            assertTrue(status.agents.isEmpty())
            assertTrue(status.sessions.isEmpty())
            assertTrue(streamedEvents.await(5, TimeUnit.SECONDS))
            listOf(pairHandshake, statusHandshake, streamHandshake).forEach { handshake ->
                assertEquals("/app", handshake.requestUrl!!.encodedPath)
                assertEquals("host_12345678", handshake.requestUrl!!.queryParameter("hostId"))
                assertEquals("relay-token-123456", handshake.requestUrl!!.queryParameter("token"))
            }
            assertEquals("relay.request", pairEnvelope.getString("type"))
            assertEquals("android_installation", pairEnvelope.getString("deviceId"))
            val pairRequest = pairEnvelope.getJSONObject("payload")
            assertEquals("POST", pairRequest.getString("method"))
            assertEquals("/pair", pairRequest.getString("path"))
            assertEquals("pairing-token-123", JSONObject(pairRequest.getString("body")).getString("pairingToken"))
            val statusRequest = statusEnvelope.getJSONObject("payload")
            assertEquals("GET", statusRequest.getString("method"))
            assertEquals("/status", statusRequest.getString("path"))
            assertEquals("Bearer access_123", statusRequest.getJSONObject("headers").getString("Authorization"))
            val streamEnvelope = requireNotNull(envelopes.poll(5, TimeUnit.SECONDS))
            val streamRequest = streamEnvelope.getJSONObject("payload")
            assertEquals("GET", streamRequest.getString("method"))
            assertEquals("/events?lastSeq=7", streamRequest.getString("path"))
            assertEquals("Bearer access_123", streamRequest.getJSONObject("headers").getString("Authorization"))
            stream.cancel()
            http.dispatcher.executorService.shutdown()
        }
    }

    @Test
    fun pairCallsPairEndpointAndReturnsDeviceCredentials() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"accessToken":"access_123","deviceId":"android-001","deviceSecret":"secret_123"}"""
                )
            )
            server.start()
            val client = AgentMobileClient()

            val info = client.pair(server.hostName, server.port, "pairing-token-123", "android")

            assertEquals("access_123", info.accessToken)
            assertEquals("android-001", info.deviceId)
            assertEquals("secret_123", info.deviceSecret)
            assertEquals("/pair", server.takeRequest().path)
        }
    }

    @Test
    fun reauthCallsDevicesReauthEndpointAndReturnsFreshAccessToken() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"accessToken":"access_456"}"""))
            server.start()
            val client = AgentMobileClient()

            val info = client.reauth(
                ConnectionInfo(
                    host = server.hostName,
                    port = server.port,
                    accessToken = "stale_access",
                    deviceId = "android-001",
                    deviceSecret = "secret_123"
                )
            )

            assertEquals("access_456", info.accessToken)
            assertEquals("android-001", info.deviceId)
            assertEquals("secret_123", info.deviceSecret)
            val request = server.takeRequest()
            assertEquals("/devices/reauth", request.path)
            val payload = JSONObject(request.body.readUtf8())
            assertEquals("android-001", payload.getString("deviceId"))
            assertEquals("secret_123", payload.getString("deviceSecret"))
        }
    }

    @Test
    fun listSessionsParsesSessionSummaries() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """
                    [
                      {
                        "id": "sess_1",
                        "adapterId": "codex",
                        "title": "Fix mobile handoff",
                        "workspace": "E:/repo",
                        "status": "running",
                        "startedAt": "2026-06-30T14:30:00.000Z",
                        "lastSeq": 7
                      }
                    ]
                    """.trimIndent()
                )
            )
            server.start()
            val client = AgentMobileClient()

            val sessions = client.listSessions(ConnectionInfo(server.hostName, server.port, "access_123"))

            assertEquals("sess_1", sessions.single().id)
            assertEquals("Fix mobile handoff", sessions.single().title)
            assertEquals("running", sessions.single().status)
            assertEquals(7L, sessions.single().lastSeq)
            assertEquals("Bearer access_123", server.takeRequest().getHeader("Authorization"))
        }
    }

    @Test
    fun getStatusParsesAgentsAndDesktopSessions() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """
                    {
                      "agents": [
                        {
                          "id": "codex",
                          "displayName": "Codex",
                          "availability": "available",
                          "activeSessions": 1,
                          "latestSessionStatus": "running"
                        }
                      ],
                      "sessions": [
                        {
                          "id": "codex_thr_desktop",
                          "adapterId": "codex",
                          "title": "Desktop thread",
                          "workspace": "E:/repo",
                          "status": "running",
                          "startedAt": "2026-07-02T12:00:00.000Z",
                          "lastSeq": 7
                        }
                      ]
                    }
                    """.trimIndent()
                )
            )
            server.start()
            val client = AgentMobileClient()

            val status = client.getStatus(ConnectionInfo(server.hostName, server.port, "access_123"))

            assertEquals("Codex", status.agents.single().displayName)
            assertEquals("Desktop thread", status.sessions.single().title)
            assertEquals("/status", server.takeRequest().path)
        }
    }

    @Test
    fun listEventsParsesAgentOutputLines() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """
                    [
                      {
                        "id": "msg_1",
                        "type": "session.started",
                        "sessionId": "sess_1",
                        "deviceId": "agent-host",
                        "timestamp": "2026-07-02T12:00:00.000Z",
                        "seq": 1,
                        "payload": {}
                      },
                      {
                        "id": "msg_2",
                        "type": "agent.output",
                        "sessionId": "sess_1",
                        "deviceId": "agent-host",
                        "timestamp": "2026-07-02T12:00:01.000Z",
                        "seq": 2,
                        "payload": {
                          "text": "history"
                        }
                      }
                    ]
                    """.trimIndent()
                )
            )
            server.start()
            val client = AgentMobileClient()

            val lines = client.listEvents(ConnectionInfo(server.hostName, server.port, "access_123"), 0)

            assertEquals("history", lines.single().text)
            assertEquals("sess_1", lines.single().sessionId)
            assertEquals("/events?lastSeq=0", server.takeRequest().path)
        }
    }

    @Test
    fun listEventsParsesUserInputAndAgentOutput() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """
                    [
                      {
                        "id": "msg_1",
                        "type": "agent.input",
                        "sessionId": "sess_1",
                        "deviceId": "agent-host",
                        "timestamp": "2026-07-02T12:00:00.000Z",
                        "seq": 1,
                        "payload": {
                          "text": "你好"
                        }
                      },
                      {
                        "id": "msg_2",
                        "type": "agent.output",
                        "sessionId": "sess_1",
                        "deviceId": "agent-host",
                        "timestamp": "2026-07-02T12:00:01.000Z",
                        "seq": 2,
                        "payload": {
                          "text": "你好。请直接说需求。"
                        }
                      }
                    ]
                    """.trimIndent()
                )
            )
            server.start()
            val client = AgentMobileClient()

            val lines = client.listEvents(ConnectionInfo(server.hostName, server.port, "access_123"), 0)

            assertEquals(2, lines.size)
            assertEquals("你好", lines[0].text)
            assertEquals("你好。请直接说需求。", lines[1].text)
            assertEquals("sess_1", lines[0].sessionId)
            assertEquals("sess_1", lines[1].sessionId)
        }
    }

    @Test
    fun listApprovalsParsesPendingApprovals() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """
                    [
                      {
                        "approvalId": "appr_1",
                        "sessionId": "sess_1",
                        "risk": "high",
                        "action": "shell.execute",
                        "summary": "npm install",
                        "details": "npm install --ignore-scripts",
                        "status": "pending",
                        "createdAt": "2026-06-30T14:30:00.000Z",
                        "timeoutSeconds": 300,
                        "respondedBy": "android",
                        "respondedAt": "2026-06-30T14:31:00.000Z"
                      }
                    ]
                    """.trimIndent()
                )
            )
            server.start()
            val client = AgentMobileClient()

            val approvals = client.listApprovals(ConnectionInfo(server.hostName, server.port, "access_123"))

            assertEquals("appr_1", approvals.single().approvalId)
            assertEquals("high", approvals.single().risk)
            assertEquals("npm install --ignore-scripts", approvals.single().details)
            assertEquals("android", approvals.single().respondedBy)
            assertEquals("2026-06-30T14:31:00.000Z", approvals.single().respondedAt)
            assertEquals("/approvals", server.takeRequest().path)
        }
    }

    @Test
    fun respondApprovalPostsDecision() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"approvalId":"appr_1","status":"approved"}"""))
            server.start()
            val client = AgentMobileClient()

            client.respondApproval(ConnectionInfo(server.hostName, server.port, "access_123"), "appr_1", "approve")

            val request = server.takeRequest()
            assertEquals("/approvals/appr_1/respond", request.path)
            assertEquals("""{"decision":"approve"}""", request.body.readUtf8())
        }
    }

    @Test
    fun listDevicesParsesDeviceSummaries() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """
                    [
                      {
                        "deviceId": "android_1",
                        "pairedAt": "2026-06-30T14:30:00.000Z"
                      }
                    ]
                    """.trimIndent()
                )
            )
            server.start()
            val client = AgentMobileClient()

            val devices = client.listDevices(ConnectionInfo(server.hostName, server.port, "access_123"))

            assertEquals("android_1", devices.single().deviceId)
        }
    }

    private fun relayResponse(
        envelopes: LinkedBlockingQueue<JSONObject>,
        responseBody: (JSONObject) -> JSONObject
    ): MockResponse = MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            val envelope = JSONObject(text)
            envelopes.offer(envelope)
            val request = envelope.getJSONObject("payload")
            webSocket.send(
                JSONObject()
                    .put("type", "relay.response")
                    .put(
                        "payload",
                        JSONObject()
                            .put("requestId", request.getString("requestId"))
                            .put("status", 200)
                            .put("body", responseBody(request))
                    )
                    .toString()
            )
        }
    })
}
