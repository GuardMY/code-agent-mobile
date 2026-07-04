package com.agentmobile.app.net

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test
import com.agentmobile.app.model.ConnectionInfo

class AgentMobileClientTest {
    @Test
    fun pairCallsPairEndpointAndReturnsAccessToken() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"accessToken":"access_123"}"""))
            server.start()
            val client = AgentMobileClient()

            val info = client.pair(server.hostName, server.port, "pairing-token-123", "android")

            assertEquals("access_123", info.accessToken)
            assertEquals("/pair", server.takeRequest().path)
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
                        "status": "pending",
                        "createdAt": "2026-06-30T14:30:00.000Z",
                        "timeoutSeconds": 300
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
}
