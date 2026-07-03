package com.agentmobile.app.model

data class PairingPayload(
    val host: String,
    val port: Int,
    val pairingToken: String,
    val deviceName: String,
    val expiresAt: String
)

data class ConnectionInfo(
    val host: String,
    val port: Int,
    val accessToken: String,
    val relayUrl: String? = null,
    val hostId: String? = null,
    val relayToken: String? = null
)

data class SessionSummary(
    val id: String,
    val adapterId: String,
    val workspace: String,
    val status: String,
    val startedAt: String,
    val lastSeq: Long
)

data class ConsoleLine(
    val seq: Long,
    val text: String
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
    val accessTokenExpiresAt: String,
    val revokedAt: String?
)
