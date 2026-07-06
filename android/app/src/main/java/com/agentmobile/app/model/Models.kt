package com.agentmobile.app.model

data class PairingPayload(
    val host: String,
    val port: Int,
    val pairingToken: String,
    val deviceName: String
)

data class ConnectionInfo(
    val host: String,
    val port: Int,
    val accessToken: String,
    val deviceId: String? = null,
    val deviceSecret: String? = null,
    val relayUrl: String? = null,
    val hostId: String? = null,
    val relayToken: String? = null
)

data class SessionSummary(
    val id: String,
    val adapterId: String,
    val title: String? = null,
    val workspace: String,
    val status: String,
    val startedAt: String,
    val lastSeq: Long
)

data class AgentCapabilitySummary(
    val id: String,
    val displayName: String,
    val availability: String,
    val activeSessions: Int,
    val latestSessionStatus: String?
)

data class HostDashboardStatus(
    val agents: List<AgentCapabilitySummary>,
    val sessions: List<SessionSummary>
)

enum class ConsoleLineRole {
    AGENT,
    USER
}

data class ConsoleLine(
    val seq: Long,
    val text: String,
    val role: ConsoleLineRole = ConsoleLineRole.AGENT,
    val sessionId: String? = null
)

data class ApprovalRequest(
    val approvalId: String,
    val sessionId: String,
    val risk: String,
    val action: String,
    val summary: String,
    val status: String,
    val createdAt: String,
    val timeoutSeconds: Int?
)

data class DeviceSummary(
    val deviceId: String,
    val pairedAt: String,
    val revokedAt: String?
)
