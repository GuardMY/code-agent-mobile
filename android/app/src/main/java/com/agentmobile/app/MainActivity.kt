package com.agentmobile.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val state by viewModel.state.collectAsState()
                    AgentMobileApp(
                        state = state,
                        onConnect = viewModel::connect,
                        onScan = { scanner.launch(Intent(this, ScanQrActivity::class.java)) },
                        onSend = viewModel::send,
                        onStop = viewModel::stop,
                        onRespondApproval = viewModel::respondApproval
                    )
                }
            }
        }
    }
}

@Composable
fun AgentMobileApp(
    state: ConsoleUiState,
    onConnect: (String) -> Unit,
    onScan: () -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onRespondApproval: (String, String) -> Unit
) {
    if (state.connection == null) {
        PairingScreen(state.error, onConnect, onScan)
    } else {
        ConsoleScreen(state, onSend, onStop, onRespondApproval)
    }
}

@Composable
fun PairingScreen(error: String?, onConnect: (String) -> Unit, onScan: () -> Unit) {
    var pairingJson by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.padding(20.dp).fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Agent Mobile", style = MaterialTheme.typography.headlineMedium)
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) {
            Text("Scan QR")
        }
        OutlinedTextField(
            value = pairingJson,
            onValueChange = { pairingJson = it },
            label = { Text("Pairing JSON") },
            minLines = 6,
            modifier = Modifier.fillMaxWidth()
        )
        Button(onClick = { onConnect(pairingJson) }, modifier = Modifier.fillMaxWidth()) {
            Text("Connect")
        }
        if (error != null) {
            Text(error, color = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
fun ConsoleScreen(
    state: ConsoleUiState,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onRespondApproval: (String, String) -> Unit
) {
    var input by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.padding(16.dp).fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("Connected to ${state.connection?.host}:${state.connection?.port}")
        Text("Session: ${state.session?.id ?: "none"} (${state.session?.status ?: "not started"})")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onStop, enabled = state.session?.status == "running") { Text("Stop") }
        }
        state.approvals.forEach { approval ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${approval.risk.uppercase()} ${approval.action}")
                Text(approval.summary)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onRespondApproval(approval.approvalId, "approve") }) {
                        Text("Approve")
                    }
                    Button(onClick = { onRespondApproval(approval.approvalId, "deny") }) {
                        Text("Deny")
                    }
                }
            }
        }
        LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
            items(state.lines) { line ->
                Text("${line.seq}  ${line.text}")
            }
        }
        OutlinedTextField(
            value = input,
            onValueChange = { input = it },
            label = { Text("Prompt") },
            modifier = Modifier.fillMaxWidth()
        )
        Button(
            onClick = {
                onSend(input)
                input = ""
            },
            enabled = state.session?.status == "running",
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Send")
        }
        if (state.error != null) {
            Text(state.error, color = MaterialTheme.colorScheme.error)
        }
    }
}
