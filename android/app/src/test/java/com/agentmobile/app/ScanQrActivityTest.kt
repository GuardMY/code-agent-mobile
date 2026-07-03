package com.agentmobile.app

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ScanQrActivityTest {
    @Test
    fun scannerConnectsCameraPreviewToPreviewView() {
        val source = File("src/main/java/com/agentmobile/app/ScanQrActivity.kt").readText()

        assertTrue(source.contains("Preview.Builder"))
        assertTrue(source.contains("setSurfaceProvider(previewView.surfaceProvider)"))
        assertTrue(source.contains("preview, analysis"))
    }
}
