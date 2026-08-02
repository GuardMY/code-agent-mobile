package com.agentmobile.app.net

import com.agentmobile.app.model.PairingPayload
import org.json.JSONObject
import java.net.URI

object PairingParser {
    fun parse(json: String): PairingPayload {
        val value = JSONObject(json)
        val host = value.getString("host").trim()
        val port = value.getInt("port")
        val token = value.getString("pairingToken").trim()
        val deviceName = value.getString("deviceName").trim()
        val relayUrl = value.optString("relayUrl").trim().ifBlank { null }
        val hostId = value.optString("hostId").trim().ifBlank { null }
        val relayToken = value.optString("relayToken").trim().ifBlank { null }
        require(host.isNotEmpty()) { "Host is required" }
        require(port in 1..65535) { "Port must be between 1 and 65535" }
        require(token.length >= 8) { "Pairing token is too short" }
        require(deviceName.isNotEmpty()) { "Device name is required" }
        require((relayUrl == null && hostId == null && relayToken == null) ||
            (relayUrl != null && hostId != null && relayToken != null)) {
            "relayUrl, hostId, and relayToken must be provided together"
        }
        if (relayUrl != null) {
            require(hostId!!.length >= 8) { "Relay host ID is too short" }
            require(relayToken!!.length >= 16) { "Relay token is too short" }
            val relayUri = runCatching { URI(relayUrl) }.getOrNull()
            val isSecureRelay = relayUri?.let { uri ->
                uri.scheme.equals("wss", ignoreCase = true) && uri.host != null
            } == true
            require(isSecureRelay) {
                "Relay URL must use wss://"
            }
        }
        return PairingPayload(host, port, token, deviceName, relayUrl, hostId, relayToken)
    }
}
