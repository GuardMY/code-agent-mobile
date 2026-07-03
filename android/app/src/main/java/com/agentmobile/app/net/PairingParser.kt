package com.agentmobile.app.net

import com.agentmobile.app.model.PairingPayload
import org.json.JSONObject

object PairingParser {
    fun parse(json: String): PairingPayload {
        val value = JSONObject(json)
        val host = value.getString("host").trim()
        val port = value.getInt("port")
        val token = value.getString("pairingToken").trim()
        val deviceName = value.getString("deviceName").trim()
        val expiresAt = value.getString("expiresAt").trim()
        require(host.isNotEmpty()) { "Host is required" }
        require(port in 1..65535) { "Port must be between 1 and 65535" }
        require(token.length >= 8) { "Pairing token is too short" }
        require(deviceName.isNotEmpty()) { "Device name is required" }
        require(expiresAt.isNotEmpty()) { "Expiry is required" }
        return PairingPayload(host, port, token, deviceName, expiresAt)
    }
}
