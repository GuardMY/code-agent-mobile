package com.agentmobile.app.net

import org.junit.Assert.assertEquals
import org.junit.Test

class PairingParserTest {
    @Test
    fun parsesQrJson() {
        val payload = PairingParser.parse(
            """
            {
              "host": "192.168.1.10",
              "port": 17365,
              "pairingToken": "pairing-token-123",
              "deviceName": "VS Code",
              "ignoredFutureField": "keeps parser compatible"
            }
            """.trimIndent()
        )

        assertEquals("192.168.1.10", payload.host)
        assertEquals(17365, payload.port)
        assertEquals("pairing-token-123", payload.pairingToken)
        assertEquals("VS Code", payload.deviceName)
    }

    @Test
    fun parsesRelayPairingFields() {
        val payload = PairingParser.parse(
            """
            {
              "host": "127.0.0.1",
              "port": 17365,
              "pairingToken": "pairing-token-123",
              "deviceName": "VS Code",
              "relayUrl": "wss://relay.example.com",
              "hostId": "host_12345678",
              "relayToken": "relay-token-123456"
            }
            """.trimIndent()
        )

        assertEquals("wss://relay.example.com", payload.relayUrl)
        assertEquals("host_12345678", payload.hostId)
        assertEquals("relay-token-123456", payload.relayToken)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsIncompleteRelayPairingFields() {
        PairingParser.parse(
            """
            {
              "host": "192.168.1.10",
              "port": 17365,
              "pairingToken": "pairing-token-123",
              "deviceName": "VS Code",
              "relayUrl": "wss://relay.example.com"
            }
            """.trimIndent()
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonSecureRelayUrl() {
        PairingParser.parse(
            """
            {
              "host": "192.168.1.10",
              "port": 17365,
              "pairingToken": "pairing-token-123",
              "deviceName": "VS Code",
              "relayUrl": "ws://relay.example.com",
              "hostId": "host_12345678",
              "relayToken": "relay-token-123456"
            }
            """.trimIndent()
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsWeakRelayCredentials() {
        PairingParser.parse(
            """
            {
              "host": "192.168.1.10",
              "port": 17365,
              "pairingToken": "pairing-token-123",
              "deviceName": "VS Code",
              "relayUrl": "wss://relay.example.com",
              "hostId": "short",
              "relayToken": "too-short"
            }
            """.trimIndent()
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsInvalidPort() {
        PairingParser.parse(
            """
            {
              "host": "192.168.1.10",
              "port": 70000,
              "pairingToken": "pairing-token-123",
              "deviceName": "VS Code"
            }
            """.trimIndent()
        )
    }
}
