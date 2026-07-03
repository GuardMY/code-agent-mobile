import { describe, expect, it } from "vitest";
import { renderPairingHtml } from "./webview.js";

const expiresAt = new Date(Date.now() + 300_000).toISOString();

function dashboard(input: {
  devices?: Parameters<typeof renderPairingHtml>[0]["dashboard"] extends { reachable: true; status: infer T } ? T["devices"] : never;
  agents?: Parameters<typeof renderPairingHtml>[0]["dashboard"] extends { reachable: true; status: infer T } ? T["agents"] : never;
  sessions?: Parameters<typeof renderPairingHtml>[0]["dashboard"] extends { reachable: true; status: infer T } ? T["sessions"] : never;
}) {
  return {
    reachable: true as const,
    status: {
      server: {
        running: true as const,
        lanEnabled: true,
        host: "192.168.1.10",
        port: 17365,
        deviceName: "VS Code",
        version: "0.1.0"
      },
      pairing: {
        enabled: true,
        expiresAt,
        pairingPayload: {
          host: "192.168.1.10",
          port: 17365,
          pairingToken: "pairing-token-123",
          deviceName: "VS Code",
          expiresAt
        }
      },
      devices: input.devices ?? [],
      agents: input.agents ?? [],
      sessions: input.sessions ?? []
    }
  };
}

describe("webview html", () => {
  it("does not include remote scripts", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{\"host\":\"127.0.0.1\"}",
      qrSvg: "<svg></svg>",
      dashboard: undefined
    });

    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
    expect(html).toContain("Agent Mobile");
    expect(html).toContain("启用局域网");
  });

  it("renders first-time connection dashboard details", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{\"host\":\"127.0.0.1\"}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        agents: [
          { id: "codex", displayName: "Codex", availability: "available", activeSessions: 1, latestSessionStatus: "running" },
          { id: "claude-code", displayName: "Claude Code", availability: "missing", activeSessions: 0 },
          { id: "opencode", displayName: "OpenCode", availability: "unknown", activeSessions: 0 }
        ]
      })
    });

    expect(html).toContain("服务");
    expect(html).toContain("局域网已启用");
    expect(html).toContain("扫码连接第一台移动设备");
    expect(html).toContain("Codex");
    expect(html).toContain("Claude Code");
    expect(html).toContain("OpenCode");
  });

  it("renders app and WeChat mobile device labels", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        devices: [
          { deviceId: "android_1", clientType: "android-app", pairedAt: "2026-06-30T14:30:00.000Z", accessTokenExpiresAt: expiresAt },
          { deviceId: "wechat_1", clientType: "wechat-mini-program", pairedAt: "2026-06-30T14:35:00.000Z", accessTokenExpiresAt: expiresAt }
        ]
      })
    });

    expect(html).toContain("Android 应用");
    expect(html).toContain("微信小程序");
  });

  it("renders created Codex sessions from dashboard status", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        agents: [
          { id: "codex", displayName: "Codex", availability: "available", activeSessions: 1, latestSessionStatus: "running" }
        ],
        sessions: [
          {
            id: "sess_codex_1",
            adapterId: "codex",
            workspace: "E:/Code/code-agent-mobile",
            status: "running",
            startedAt: "2026-07-02T12:00:00.000Z",
            lastSeq: 7
          }
        ]
      })
    });

    expect(html).toContain("Codex 会话");
    expect(html).toContain("sess_codex_1");
    expect(html).toContain("codex");
    expect(html).toContain("running");
  });

  it("renders a Codex session console with controls and selected output", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      selectedSessionId: "codex_thr_desktop",
      sessionEvents: [
        { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" },
        { seq: 4, sessionId: "codex_other", type: "agent.output", text: "other session" }
      ],
      dashboard: dashboard({
        agents: [
          { id: "codex", displayName: "Codex", availability: "available", activeSessions: 1, latestSessionStatus: "running" }
        ],
        sessions: [
          {
            id: "codex_thr_desktop",
            adapterId: "codex",
            workspace: "E:/Code/code-agent-mobile",
            status: "running",
            startedAt: "2026-07-02T12:00:00.000Z",
            lastSeq: 7
          }
        ]
      })
    });

    expect(html).toContain("Codex 会话");
    expect(html).toContain('data-command="selectSession"');
    expect(html).toContain('data-session-id="codex_thr_desktop"');
    expect(html).toContain("hello from codex");
    expect(html).not.toContain("other session");
    expect(html).toContain('data-command="sendInput"');
    expect(html).toContain('data-command="stopSession"');
    expect(html).toContain('data-command="refreshSessions"');
    expect(html).toContain("<textarea");
  });
});
