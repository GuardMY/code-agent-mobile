package com.agentmobile.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.agentmobile.app.model.ApprovalRequest
import com.agentmobile.app.model.ConsoleLine
import com.agentmobile.app.model.ConsoleLineRole
import com.agentmobile.app.model.AgentCapabilitySummary
import com.agentmobile.app.model.SessionSummary
import com.agentmobile.app.ui.ConsoleUiState
import com.agentmobile.app.ui.ConsoleViewModel

class MainActivity : ComponentActivity() {
    private val viewModel: ConsoleViewModel by viewModels()
    private val scanner = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val text = result.data?.getStringExtra(ScanQrActivity.EXTRA_QR_TEXT)
        if (!text.isNullOrBlank()) {
            viewModel.connect(text)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        viewModel.initStorage(applicationContext)
        viewModel.tryReauth()
        setContent {
            MaterialTheme(colorScheme = AgentMobileColors) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val state by viewModel.state.collectAsState()
                    AgentMobileApp(
                        state = state,
                        onConnect = viewModel::connect,
                        onScan = { scanner.launch(Intent(this, ScanQrActivity::class.java)) },
                        onSelectSession = viewModel::selectSession,
                        onShowSessionList = viewModel::showSessionList,
                        onSend = viewModel::send,
                        onStop = viewModel::stop,
                        onRespondApproval = viewModel::respondApproval,
                        onUnbind = viewModel::unbind,
                        onSelectTab = viewModel::selectTab
                    )
                }
            }
        }
    }
}

private val AgentMobileColors = lightColorScheme(
    primary = Color(0xFF1D5F73),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFCBEAF1),
    onPrimaryContainer = Color(0xFF08343F),
    secondary = Color(0xFF785A00),
    secondaryContainer = Color(0xFFFFE3A3),
    surface = Color(0xFFF7F9FA),
    surfaceVariant = Color(0xFFE5EEF1),
    background = Color(0xFFF7F9FA),
    error = Color(0xFFB3261E)
)

private val PanelShape = RoundedCornerShape(8.dp)

@Composable
fun AgentMobileApp(
    state: ConsoleUiState,
    onConnect: (String) -> Unit,
    onScan: () -> Unit,
    onSelectSession: (String) -> Unit,
    onShowSessionList: () -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onRespondApproval: (String, String) -> Unit,
    onUnbind: () -> Unit,
    onSelectTab: (String) -> Unit
) {
    if (state.reauthing) {
        ReauthingScreen()
    } else if (state.connection == null) {
        PairingScreen(state.error, onConnect, onScan)
    } else if (!state.showingSessionDetail) {
        DashboardScreen(state, onSelectSession, onUnbind, onSelectTab)
    } else {
        ConsoleScreen(state, onShowSessionList, onSend, onStop, onRespondApproval)
    }
}

@Composable
fun AppHeader(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary
    )
}

@Composable
fun AgentRow(agent: AgentCapabilitySummary) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(agent.displayName, fontWeight = FontWeight.SemiBold)
            Text(
                "${agent.activeSessions} 个活跃会话",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        StatusPill(agent.availability)
    }
}

@Composable
fun StatusPill(text: String) {
    val normalized = text.lowercase()
    val container = when (normalized) {
        "running", "available" -> Color(0xFFDDF3E6)
        "starting", "unknown", "not started" -> Color(0xFFFFE8B8)
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    val content = when (normalized) {
        "running", "available" -> Color(0xFF17663A)
        "starting", "unknown", "not started" -> Color(0xFF7A5600)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val displayText = when (normalized) {
        "running" -> "运行中"
        "available" -> "可用"
        "starting" -> "启动中"
        "unknown" -> "未知"
        "not started" -> "未启动"
        "exited" -> "已退出"
        "failed" -> "失败"
        "stopped" -> "已停止"
        else -> text
    }
    Box(
        modifier = Modifier
            .background(container, RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 5.dp)
    ) {
        Text(displayText, style = MaterialTheme.typography.labelSmall, color = content, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun EmptyState(text: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.surfaceVariant, PanelShape)
            .padding(14.dp)
    ) {
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun ErrorBanner(text: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.error.copy(alpha = 0.08f), PanelShape)
            .padding(12.dp)
    ) {
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
}

@Composable
fun ReauthingScreen() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CircularProgressIndicator()
            Text(
                "正在重新连接…",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
fun PairingScreen(error: String?, onConnect: (String) -> Unit, onScan: () -> Unit) {
    var pairingJson by remember { mutableStateOf("") }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        AppHeader(
            title = "Agent Mobile",
            subtitle = "将手机与桌面主机配对"
        )
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = PanelShape,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    onClick = onScan,
                    modifier = Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(vertical = 14.dp)
                ) {
                    Text("扫描二维码", fontWeight = FontWeight.SemiBold)
                }
                Text(
                    "如果无法使用相机，请粘贴配对 JSON。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = pairingJson,
                    onValueChange = { pairingJson = it },
                    label = { Text("配对 JSON") },
                    minLines = 6,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedButton(
                    onClick = { onConnect(pairingJson) },
                    modifier = Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(vertical = 14.dp)
                ) {
                    Text("连接")
                }
            }
        }
        if (error != null) {
            ErrorBanner(error)
        }
    }
}

@Composable
fun DashboardScreen(
    state: ConsoleUiState,
    onSelectSession: (String) -> Unit,
    onUnbind: () -> Unit,
    onSelectTab: (String) -> Unit
) {
    val tabs = listOf(
        "codex" to "CODEX",
        "claude-code" to "Claude",
        "opencode" to "OpenCode"
    )
    val filteredSessions = state.sessions.filter { it.adapterId == state.selectedTab }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        AppHeader(
            title = "Agent Mobile",
            subtitle = state.connection?.relayUrl?.takeIf { it.isNotBlank() }
                ?.let { "已通过公网中继连接" }
                ?: "已连接到 ${state.connection?.host}:${state.connection?.port}"
        )
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = PanelShape,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionLabel("桌面 Agent")
                if (state.agents.isEmpty()) {
                    EmptyState("暂无桌面 Agent 状态")
                } else {
                    state.agents.forEachIndexed { index, agent ->
                        AgentRow(agent)
                        if (index != state.agents.lastIndex) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                        }
                    }
                }
            }
        }
        SectionLabel("Agent 会话")
        // Tab bar
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            tabs.forEach { (adapterId, label) ->
                val isSelected = state.selectedTab == adapterId
                val sessionCount = state.sessions.count { it.adapterId == adapterId }
                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    TextButton(
                        onClick = { onSelectTab(adapterId) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                label,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 14.sp
                            )
                            Text(
                                "$sessionCount 个会话",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    if (isSelected) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp)
                                .background(
                                    MaterialTheme.colorScheme.primary,
                                    RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp)
                                )
                                .height(3.dp)
                        )
                    }
                }
            }
        }
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (filteredSessions.isEmpty()) {
                item {
                    val adapterName = tabs.firstOrNull { it.first == state.selectedTab }?.second ?: state.selectedTab
                    EmptyState("暂无 ${adapterName} 会话。")
                }
            }
            items(filteredSessions) { session ->
                SessionRow(session, onSelectSession)
            }
        }
        if (state.error != null) {
            ErrorBanner(state.error)
        }
        OutlinedButton(
            onClick = onUnbind,
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(vertical = 14.dp)
        ) {
            Text("解绑", fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun SessionRow(session: SessionSummary, onSelectSession: (String) -> Unit) {
    Card(
        onClick = { onSelectSession(session.id) },
        modifier = Modifier.fillMaxWidth(),
        shape = PanelShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    session.title ?: session.id,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    sessionWorkspaceText(session),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    sessionSecondaryText(session),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            StatusPill(session.status)
        }
    }
}

fun sessionWorkspaceText(session: SessionSummary): String = "项目：${session.workspace}"

fun sessionSecondaryText(session: SessionSummary): String = "${session.adapterId} - ${session.startedAt}"

@Composable
fun ConsoleScreen(
    state: ConsoleUiState,
    onShowSessionList: () -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onRespondApproval: (String, String) -> Unit
) {
    var input by remember { mutableStateOf("") }
    val selectedSessionId = state.session?.id
    val visibleLines = state.lines.filter { it.sessionId == null || it.sessionId == selectedSessionId }
    BackHandler(onBack = onShowSessionList)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = onShowSessionList) {
                Text("返回会话列表")
            }
            StatusPill(state.session?.status ?: "not started")
        }
        AppHeader(
            title = state.session?.title ?: state.session?.id ?: "Session",
            subtitle = state.session?.workspace ?: "No workspace"
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = onStop,
                enabled = state.session?.status == "running",
                modifier = Modifier.weight(1f)
            ) {
                Text("停止")
            }
        }
        val visibleApprovals = state.approvals.filter { it.sessionId == selectedSessionId }
        visibleApprovals.forEach { approval ->
            ApprovalCard(
                approval = approval,
                responding = state.respondingApprovalIds.contains(approval.approvalId),
                onRespondApproval = onRespondApproval
            )
        }
        Card(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            shape = PanelShape,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            if (visibleLines.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                    EmptyState("此会话暂无消息。")
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    items(visibleLines) { line ->
                        ConversationBubble(line)
                    }
                }
            }
        }
        OutlinedTextField(
            value = input,
            onValueChange = { input = it },
            label = { Text("输入提示") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 2
        )
        Button(
            onClick = {
                onSend(input)
                input = ""
            },
            enabled = state.session?.status == "running",
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(vertical = 14.dp)
        ) {
            Text("发送", fontWeight = FontWeight.SemiBold)
        }
        if (state.error != null) {
            ErrorBanner(state.error)
        }
    }
}

@Composable
fun ApprovalCard(
    approval: ApprovalRequest,
    responding: Boolean,
    onRespondApproval: (String, String) -> Unit
) {
    val riskColor = approvalRiskColor(approval.risk)
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = PanelShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(approval.action, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(
                    approval.risk.uppercase(),
                    style = MaterialTheme.typography.labelMedium,
                    color = riskColor,
                    fontWeight = FontWeight.Bold
                )
            }
            Text(approval.summary, style = MaterialTheme.typography.bodyMedium)
            if (!approval.details.isNullOrBlank()) {
                Text(
                    approval.details,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            ApprovalMetaRow(approval)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { onRespondApproval(approval.approvalId, "approve") },
                    enabled = !responding,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(if (responding) "处理中" else "批准")
                }
                OutlinedButton(
                    onClick = { onRespondApproval(approval.approvalId, "deny") },
                    enabled = !responding,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("拒绝")
                }
            }
        }
    }
}

@Composable
fun ApprovalMetaRow(approval: ApprovalRequest) {
    val timeoutText = approval.timeoutSeconds?.let { "超时 ${it} 秒" }
    val respondedText = approval.respondedBy?.let { source ->
        approval.respondedAt?.let { at -> "${source} 于 ${at} 响应" } ?: "${source} 已响应"
    }
    val meta = listOfNotNull(timeoutText, respondedText).joinToString(" · ")
    if (meta.isNotBlank()) {
        Text(
            meta,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

fun approvalRiskColor(risk: String): Color = when (risk.lowercase()) {
    "critical" -> Color(0xFF8E1B13)
    "high" -> Color(0xFFB3261E)
    "medium" -> Color(0xFF7A5600)
    "low" -> Color(0xFF17663A)
    else -> Color(0xFF4C5A60)
}

@Composable
fun ConversationBubble(line: ConsoleLine) {
    val isUser = line.role == ConsoleLineRole.USER
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .background(
                    color = if (isUser) MaterialTheme.colorScheme.primaryContainer else Color.White,
                    shape = RoundedCornerShape(
                        topStart = 12.dp,
                        topEnd = 12.dp,
                        bottomStart = if (isUser) 12.dp else 3.dp,
                        bottomEnd = if (isUser) 3.dp else 12.dp
                    )
                )
                .border(
                    width = 1.dp,
                    color = if (isUser) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f) else MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(
                        topStart = 12.dp,
                        topEnd = 12.dp,
                        bottomStart = if (isUser) 12.dp else 3.dp,
                        bottomEnd = if (isUser) 3.dp else 12.dp
                    )
                )
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = if (isUser) "用户" else "Agent",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            MarkdownText(line.text)
        }
    }
}

@Composable
fun MarkdownText(markdown: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        parseMarkdownBlocks(markdown).forEach { block ->
            when (block) {
                is MarkdownBlock.Heading -> Text(
                    text = block.text,
                    style = if (block.level == 1) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                is MarkdownBlock.Paragraph -> Text(renderInlineMarkdown(block.text))
                is MarkdownBlock.Bullet -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("-")
                    Text(renderInlineMarkdown(block.text), modifier = Modifier.weight(1f))
                }
                is MarkdownBlock.Code -> Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.Black.copy(alpha = 0.08f), RoundedCornerShape(6.dp))
                        .padding(8.dp)
                ) {
                    Text(
                        text = block.text,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 13.sp
                    )
                }
            }
        }
    }
}

sealed class MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock()
    data class Paragraph(val text: String) : MarkdownBlock()
    data class Bullet(val text: String) : MarkdownBlock()
    data class Code(val text: String) : MarkdownBlock()
}

fun parseMarkdownBlocks(markdown: String): List<MarkdownBlock> {
    val blocks = mutableListOf<MarkdownBlock>()
    val paragraph = mutableListOf<String>()
    val code = mutableListOf<String>()
    var inCode = false

    fun flushParagraph() {
        if (paragraph.isNotEmpty()) {
            blocks += MarkdownBlock.Paragraph(paragraph.joinToString("\n"))
            paragraph.clear()
        }
    }

    markdown.lines().forEach { rawLine ->
        val line = rawLine.trimEnd()
        if (line.trim() == "```") {
            if (inCode) {
                blocks += MarkdownBlock.Code(code.joinToString("\n").trimEnd())
                code.clear()
                inCode = false
            } else {
                flushParagraph()
                inCode = true
            }
            return@forEach
        }
        if (inCode) {
            code += rawLine
            return@forEach
        }
        val trimmed = line.trim()
        when {
            trimmed.isBlank() -> flushParagraph()
            trimmed.startsWith("### ") -> {
                flushParagraph()
                blocks += MarkdownBlock.Heading(3, trimmed.removePrefix("### ").trim())
            }
            trimmed.startsWith("## ") -> {
                flushParagraph()
                blocks += MarkdownBlock.Heading(2, trimmed.removePrefix("## ").trim())
            }
            trimmed.startsWith("# ") -> {
                flushParagraph()
                blocks += MarkdownBlock.Heading(1, trimmed.removePrefix("# ").trim())
            }
            trimmed.startsWith("- ") -> {
                flushParagraph()
                blocks += MarkdownBlock.Bullet(trimmed.removePrefix("- ").trim())
            }
            else -> paragraph += trimmed
        }
    }
    if (inCode) {
        blocks += MarkdownBlock.Code(code.joinToString("\n").trimEnd())
    }
    flushParagraph()
    return blocks
}

private fun renderInlineMarkdown(text: String) = buildAnnotatedString {
    var index = 0
    while (index < text.length) {
        val boldStart = text.indexOf("**", index)
        val codeStart = text.indexOf("`", index)
        val nextStart = listOf(boldStart, codeStart).filter { it >= 0 }.minOrNull() ?: -1
        if (nextStart < 0) {
            append(text.substring(index))
            break
        }
        append(text.substring(index, nextStart))
        if (nextStart == boldStart) {
            val end = text.indexOf("**", boldStart + 2)
            if (end < 0) {
                append(text.substring(boldStart))
                break
            }
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                append(text.substring(boldStart + 2, end))
            }
            index = end + 2
        } else {
            val end = text.indexOf("`", codeStart + 1)
            if (end < 0) {
                append(text.substring(codeStart))
                break
            }
            withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Color.Black.copy(alpha = 0.08f))) {
                append(text.substring(codeStart + 1, end))
            }
            index = end + 1
        }
    }
}
