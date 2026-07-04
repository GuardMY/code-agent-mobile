package com.agentmobile.app

import com.agentmobile.app.model.SessionSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionDisplayTextTest {
    @Test
    fun sessionWorkspaceTextShowsProjectDirectory() {
        val session = SessionSummary(
            id = "codex_thr_desktop",
            adapterId = "codex",
            title = "Fix mobile handoff",
            workspace = "E:/Code/code-agent-mobile",
            status = "running",
            startedAt = "2026-07-02T12:00:00.000Z",
            lastSeq = 7
        )

        assertEquals("Project: E:/Code/code-agent-mobile", sessionWorkspaceText(session))
        assertEquals("codex - 2026-07-02T12:00:00.000Z", sessionSecondaryText(session))
    }
}
