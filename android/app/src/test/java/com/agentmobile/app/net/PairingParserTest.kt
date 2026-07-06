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
