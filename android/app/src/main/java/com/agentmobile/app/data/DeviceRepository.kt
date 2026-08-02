package com.agentmobile.app.data

import android.content.Context
import com.agentmobile.app.model.ConnectionInfo
import java.util.UUID

/**
 * Persists bound [ConnectionInfo] (host, port, deviceId, deviceSecret)
 * so the app can silently re-authenticate after restarts.
 *
 * Mirrors the VS Code extension's DeviceRegistry (SecretStorage) on Android.
 */
object DeviceRepository {
    private const val PREFS_NAME = "agent_mobile_binding"
    private const val INSTALLATION_PREFS_NAME = "agent_mobile_installation"
    private const val KEY_HOST = "host"
    private const val KEY_PORT = "port"
    private const val KEY_DEVICE_ID = "deviceId"
    private const val KEY_DEVICE_SECRET = "deviceSecret"
    private const val KEY_RELAY_URL = "relayUrl"
    private const val KEY_HOST_ID = "hostId"
    private const val KEY_RELAY_TOKEN = "relayToken"
    private const val KEY_INSTALLATION_ID = "installationId"

    fun getOrCreateInstallationId(context: Context): String {
        val prefs = context.getSharedPreferences(INSTALLATION_PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_INSTALLATION_ID, null)
        if (!existing.isNullOrBlank()) {
            return existing
        }
        val installationId = "android_${UUID.randomUUID()}"
        prefs.edit().putString(KEY_INSTALLATION_ID, installationId).apply()
        return installationId
    }

    fun load(context: Context): ConnectionInfo? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val host = prefs.getString(KEY_HOST, null) ?: return null
        val port = prefs.getInt(KEY_PORT, -1).takeIf { it > 0 } ?: return null
        val deviceId = prefs.getString(KEY_DEVICE_ID, null) ?: return null
        val deviceSecret = prefs.getString(KEY_DEVICE_SECRET, null) ?: return null
        val relayUrl = prefs.getString(KEY_RELAY_URL, null)
        val hostId = prefs.getString(KEY_HOST_ID, null)
        val relayToken = prefs.getString(KEY_RELAY_TOKEN, null)
        if ((relayUrl != null || hostId != null || relayToken != null) &&
            (relayUrl == null || hostId == null || relayToken == null)) {
            return null
        }
        return ConnectionInfo(
            host = host,
            port = port,
            accessToken = "", // ephemeral — will be replaced by reauth
            deviceId = deviceId,
            deviceSecret = deviceSecret,
            relayUrl = relayUrl,
            hostId = hostId,
            relayToken = relayToken
        )
    }

    fun save(context: Context, connection: ConnectionInfo) {
        val deviceId = connection.deviceId ?: return
        val deviceSecret = connection.deviceSecret ?: return
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_HOST, connection.host)
            .putInt(KEY_PORT, connection.port)
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_DEVICE_SECRET, deviceSecret)
            .putString(KEY_RELAY_URL, connection.relayUrl)
            .putString(KEY_HOST_ID, connection.hostId)
            .putString(KEY_RELAY_TOKEN, connection.relayToken)
            .apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
    }

    fun isBound(context: Context): Boolean = load(context) != null
}
