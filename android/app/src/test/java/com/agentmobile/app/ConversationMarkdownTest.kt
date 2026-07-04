package com.agentmobile.app

import org.junit.Assert.assertEquals
import org.junit.Test

class ConversationMarkdownTest {
    @Test
    fun parseMarkdownBlocksRecognizesHeadingsListsAndCodeFences() {
        val blocks = parseMarkdownBlocks(
            """
            ## Result
            Normal text
            - first
            - second
            ```
            npm test
            ```
            """.trimIndent()
        )

        assertEquals(
            listOf(
                MarkdownBlock.Heading(level = 2, text = "Result"),
                MarkdownBlock.Paragraph("Normal text"),
                MarkdownBlock.Bullet("first"),
                MarkdownBlock.Bullet("second"),
                MarkdownBlock.Code("npm test")
            ),
            blocks
        )
    }
}
