package com.agentmobile.app

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NetworkSecurityTest {
    @Test
    fun appAllowsCleartextLanConnectionsForLocalHostPairing() {
        val manifest = File("src/main/AndroidManifest.xml").readText()

        assertTrue(manifest.contains("""android:usesCleartextTraffic="true""""))
    }
}
