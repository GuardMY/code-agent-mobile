import { describe, expect, it } from "vitest";
import {
  buildRenderedSessionMessages,
  decideSessionAutoScroll,
  renderPairingHtml,
  resolveSessionPreservedScrollTop,
  toSessionScrollSnapshot
} from "./webview.js";

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
        pairingPayload: {
          host: "192.168.1.10",
          port: 17365,
          pairingToken: "pairing-token-123",
          deviceName: "VS Code"
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

  it("hides empty pairing artifacts when LAN pairing is disabled", async () => {
    const html = await renderPairingHtml({
      status: "stopped",
      lanEnabled: false,
      pairingJson: "{}",
      qrSvg: "",
      dashboard: undefined
    });

    expect(html).not.toContain('<section class="qr">');
    expect(html).not.toContain("<pre>{}</pre>");
    expect(html).not.toContain("局域网配对已");
  });

  it("keeps local connection details visible while the dashboard is still loading", async () => {
    const html = await renderPairingHtml({
      status: "starting",
      lanEnabled: true,
      pairingJson:
        "{\"host\":\"192.168.1.10\",\"port\":17365,\"pairingToken\":\"pairing-token-123\",\"deviceName\":\"VS Code\"}",
      qrSvg: "<svg></svg>",
      dashboard: undefined
    });

    expect(html).toContain("192.168.1.10:17365");
    expect(html).toContain("局域网已启用");
    expect(html).not.toContain("刷新后将显示主机状态");
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
    expect(html).toContain("配对连接");
    expect(html).toContain("Codex");
    expect(html).toContain("Claude Code");
    expect(html).toContain("OpenCode");
  });

  it("renders desktop agent runtime and availability states with the requested labels", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{\"host\":\"127.0.0.1\"}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        agents: [
          { id: "codex", displayName: "Codex", availability: "available", activeSessions: 1, latestSessionStatus: "running" },
          { id: "claude-code", displayName: "Claude Code", availability: "available", activeSessions: 0 },
          { id: "opencode", displayName: "OpenCode", availability: "missing", activeSessions: 0 },
          { id: "codex", displayName: "Codex Unknown", availability: "unknown", activeSessions: 0 }
        ]
      })
    });

    expect(html).toContain("Codex");
    expect(html).toContain("运行中");
    expect(html).toContain("Claude Code");
    expect(html).toContain("未启动");
    expect(html).toContain("OpenCode");
    expect(html).toContain("未安装");
    expect(html).toContain("Codex Unknown");
    expect(html).toContain("未知");
    expect(html).toContain("1 个活跃会话");
    expect(html).toContain("0 个活跃会话");
    expect(html).not.toContain("最近状态");
  });

  it("renders app and WeChat mobile device labels", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        devices: [
          { deviceId: "android_1", clientType: "android-app", pairedAt: "2026-06-30T14:30:00.000Z" },
          { deviceId: "wechat_1", clientType: "wechat-mini-program", pairedAt: "2026-06-30T14:35:00.000Z" }
        ]
      })
    });

    expect(html).toContain("Android 应用");
    expect(html).toContain("微信小程序");
    expect(html).toContain("长期有效");
    expect(html).not.toContain("令牌过期");
    expect(html).not.toContain("accessTokenExpiresAt");
  });

  it.skip("does not render the VS Code extension client in the mobile device panel", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        devices: [{ deviceId: "vscode-extension", clientType: "desktop-extension", pairedAt: "2026-06-30T14:40:00.000Z" }]
      })
    });

    expect(html).toContain("VS Code 插件 vscode-extension");
    expect(html).not.toContain("未知客户端 vscode-extension");
  });

  it("renders unbind actions for visible mobile devices", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        devices: [
          { deviceId: "android_1", clientType: "android-app", pairedAt: "2026-06-30T14:30:00.000Z" },
          { deviceId: "wechat_1", clientType: "wechat-mini-program", pairedAt: "2026-06-30T14:35:00.000Z" }
        ]
      })
    });

    expect(html).toContain('data-command="revokeDevice"');
    expect(html).toContain('data-device-id="android_1"');
    expect(html).toContain('data-device-id="wechat_1"');
  });

  it("hides desktop-extension and revoked devices from the mobile device panel", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        devices: [
          { deviceId: "android_1", clientType: "android-app", pairedAt: "2026-06-30T14:30:00.000Z" },
          { deviceId: "vscode-extension", clientType: "desktop-extension", pairedAt: "2026-06-30T14:40:00.000Z" },
          {
            deviceId: "android_old",
            clientType: "android-app",
            pairedAt: "2026-06-30T14:20:00.000Z",
            revokedAt: "2026-06-30T15:00:00.000Z"
          }
        ]
      })
    });

    expect(html).toContain("android_1");
    expect(html).not.toContain("vscode-extension");
    expect(html).not.toContain("android_old");
    expect(html).not.toContain("已解绑");
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
            title: "Fix mobile handoff",
            workspace: "E:/Code/code-agent-mobile",
            status: "running",
            startedAt: "2026-07-02T12:00:00.000Z",
            lastSeq: 7
          }
        ]
      })
    });

    expect(html).toContain("Codex 会话");
    expect(html).toContain("Fix mobile handoff");
    expect(html).toContain("项目目录：E:/Code/code-agent-mobile");
    expect(html).toContain("2026-07-02 20:00");
    expect(html).not.toContain("2026-07-02T12:00:00.000Z");
    expect(html).not.toContain(">sess_codex_1<");
    expect(html).not.toContain("codex / running / seq 7");
  });

  it("keeps additional Codex sessions in a scrollable list after the latest three", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        sessions: [1, 2, 3, 4].map((index) => ({
          id: `sess_codex_${index}`,
          adapterId: "codex",
          title: `Codex session ${index}`,
          workspace: "E:/Code/code-agent-mobile",
          status: "running",
          startedAt: `2026-07-02T12:0${index}:00.000Z`,
          lastSeq: index
        }))
      })
    });

    expect(html).toContain('<div class="session-list">');
    expect(html).toContain("Codex session 1");
    expect(html).toContain("Codex session 2");
    expect(html).toContain("Codex session 3");
    expect(html).toContain("Codex session 4");
  });

  it("truncates long Codex session titles while preserving the full title as hover text", async () => {
    const longTitle = "Investigate the Codex mobile session list timestamp rendering and title overflow behavior";
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        sessions: [
          {
            id: "sess_codex_long",
            adapterId: "codex",
            title: longTitle,
            workspace: "E:/Code/code-agent-mobile",
            status: "running",
            startedAt: "2026-07-02T12:00:00.000Z",
            lastSeq: 7
          }
        ]
      })
    });

    expect(html).toContain('title="Investigate the Codex mobile session list timestamp rendering and title overflow behavior"');
    expect(html).toContain("Investigate the Codex mobile session list...");
    expect(html).not.toContain(`<div class="label">${longTitle}</div>`);
  });

  it("renders a Codex session console with close-session controls and selected output", async () => {
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
            title: "Fix mobile handoff",
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
    expect(html).toContain("Fix mobile handoff");
    expect(html).toContain("项目目录：E:/Code/code-agent-mobile");
    expect(html).not.toContain("codex_thr_desktop / running");
    expect(html).toContain("hello from codex");
    expect(html).not.toContain("other session");
    expect(html).toContain('data-command="sendInput"');
    expect(html).toContain('data-command="stopSession"');
    expect(html).toContain('data-session-id="codex_thr_desktop"');
    expect(html).not.toContain('data-command="closeSessionDetail"');
    expect(html).not.toContain('data-command="refreshSessions"');
    expect(html).toContain("<textarea");
    expect(html).toContain('id="sessionMessages"');
  });

  it("renders the merged pairing connection card before the LAN controls below the session content", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson:
        "{\"host\":\"192.168.1.10\",\"port\":17365,\"pairingToken\":\"pairing-token-123\",\"deviceName\":\"VS Code\"}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        sessions: [
          {
            id: "codex_thr_desktop",
            adapterId: "codex",
            title: "Fix mobile handoff",
            workspace: "E:/Code/code-agent-mobile",
            status: "running",
            startedAt: "2026-07-02T12:00:00.000Z",
            lastSeq: 7
          }
        ]
      })
    });

    expect(html).toContain('class="panel-card pairing-connection-panel"');
    expect(html).toContain("<h3>配对连接</h3>");
    expect(html).toContain('class="panel-card controls-panel"');
    expect(html).toContain("<h3>局域网控制与配对</h3>");
    expect(html).not.toContain('class="panel-card pairing-artifacts-panel"');
    expect(html).not.toContain("<h3>配对信息</h3>");
    expect(html.indexOf("<h3>Codex 会话</h3>")).toBeLessThan(html.indexOf("<h3>配对连接</h3>"));
    expect(html.indexOf("<h3>配对连接</h3>")).toBeLessThan(html.indexOf("<h3>局域网控制与配对</h3>"));
  });

  it("renders a single pairing connection panel with qr and pairing json", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson:
        "{\"host\":\"192.168.1.10\",\"port\":17365,\"pairingToken\":\"pairing-token-123\",\"deviceName\":\"VS Code\"}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        devices: [{ deviceId: "android_1", clientType: "android-app", pairedAt: "2026-06-30T14:30:00.000Z" }]
      })
    });

    expect(html).toContain('class="panel-card pairing-connection-panel"');
    expect(html).toContain("<h3>配对连接</h3>");
    expect(html).toContain('<section class="qr"><svg></svg></section>');
    expect(html).toContain("&quot;pairingToken&quot;:&quot;pairing-token-123&quot;");
    expect(html).not.toContain("<h3>扫码连接第一台移动设备</h3>");
    expect(html).not.toContain("<h3>添加设备</h3>");
    expect(html).not.toContain("<h3>配对信息</h3>");
  });

  it("keeps the merged pairing connection panel visible with empty-state copy when pairing details are unavailable", async () => {
    const html = await renderPairingHtml({
      status: "stopped",
      lanEnabled: false,
      pairingJson: "{}",
      qrSvg: "",
      dashboard: dashboard({})
    });

    expect(html).toContain('class="panel-card pairing-connection-panel"');
    expect(html).toContain("<h3>配对连接</h3>");
    expect(html).toContain("刷新或启动主机后将在这里显示二维码和配对 JSON。");
    expect(html).not.toContain("<h3>配对信息</h3>");
  });

  it("does not render the session detail panel until a session is selected", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      dashboard: dashboard({
        sessions: [
          {
            id: "codex_thr_desktop",
            adapterId: "codex",
            title: "Fix mobile handoff",
            workspace: "E:/Code/code-agent-mobile",
            status: "running",
            startedAt: "2026-07-02T12:00:00.000Z",
            lastSeq: 7
          }
        ]
      })
    });

    expect(html).not.toContain("<h3>会话详情</h3>");
    expect(html).not.toContain('data-command="sendInput"');
  });

  it("renders session messages as left agent and right user markdown bubbles", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      selectedSessionId: "codex_thr_desktop",
      sessionEvents: [
        { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "## Done\n- Built APK" },
        { seq: 4, sessionId: "codex_thr_desktop", type: "agent.input", text: "show **status**" }
      ],
      dashboard: dashboard({
        sessions: [
          {
            id: "codex_thr_desktop",
            adapterId: "codex",
            title: "Fix mobile handoff",
            workspace: "E:/Code/code-agent-mobile",
            status: "running",
            startedAt: "2026-07-02T12:00:00.000Z",
            lastSeq: 7
          }
        ]
      })
    });

    expect(html).toContain('class="message agent-message"');
    expect(html).toContain('class="message user-message"');
    expect(html).toContain("<h2>Done</h2>");
    expect(html).toContain("<li>Built APK</li>");
    expect(html).toContain("show <strong>status</strong>");
    expect(html).toContain('type="button" data-command="stopSession" data-session-id="codex_thr_desktop"');
    expect(html).not.toContain('type="button" data-command="closeSessionDetail"');
  });

  it("merges consecutive agent output chunks into one rendered message", () => {
    const messages = buildRenderedSessionMessages([
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "Hello" },
      { seq: 4, sessionId: "codex_thr_desktop", type: "agent.output", text: " world" },
      { seq: 5, sessionId: "codex_thr_desktop", type: "agent.input", text: "continue" }
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      type: "agent.output",
      text: "Hello world",
      seq: 4
    });
    expect(messages[1]).toMatchObject({
      type: "agent.input",
      text: "continue"
    });
  });

  it("auto-scrolls when a session is first opened", () => {
    const current = toSessionScrollSnapshot("codex_thr_desktop", [
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" }
    ]);

    expect(decideSessionAutoScroll(undefined, current)).toBe("bottom");
  });

  it("auto-scrolls after the user sends a local message", () => {
    const previous = {
      ...toSessionScrollSnapshot("codex_thr_desktop", [
        { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" }
      ]),
      seenSessionIds: ["codex_thr_desktop"],
      nearBottomBySession: {
        codex_thr_desktop: false
      }
    };
    const current = toSessionScrollSnapshot("codex_thr_desktop", [
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" },
      { seq: -1, sessionId: "codex_thr_desktop", type: "agent.input", text: "continue" }
    ]);

    expect(decideSessionAutoScroll(previous, current)).toBe("bottom");
  });

  it("follows agent output only when the view was already near the bottom", () => {
    const nearBottomPrevious = {
      ...toSessionScrollSnapshot("codex_thr_desktop", [
        { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" }
      ]),
      seenSessionIds: ["codex_thr_desktop"],
      nearBottomBySession: {
        codex_thr_desktop: true
      }
    };
    const awayFromBottomPrevious = {
      ...nearBottomPrevious,
      nearBottomBySession: {
        codex_thr_desktop: false
      }
    };
    const current = toSessionScrollSnapshot("codex_thr_desktop", [
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" },
      { seq: 4, sessionId: "codex_thr_desktop", type: "agent.output", text: "new reply" }
    ]);

    expect(decideSessionAutoScroll(nearBottomPrevious, current)).toBe("bottom");
    expect(decideSessionAutoScroll(awayFromBottomPrevious, current)).toBe("preserve");
  });

  it("treats a longer streamed agent reply as new content for auto-scroll decisions", () => {
    const previous = {
      ...toSessionScrollSnapshot("codex_thr_desktop", [
        { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "Hello" },
        { seq: 4, sessionId: "codex_thr_desktop", type: "agent.output", text: " world" }
      ]),
      seenSessionIds: ["codex_thr_desktop"],
      nearBottomBySession: {
        codex_thr_desktop: true
      }
    };
    const current = toSessionScrollSnapshot("codex_thr_desktop", [
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "Hello" },
      { seq: 4, sessionId: "codex_thr_desktop", type: "agent.output", text: " world" },
      { seq: 5, sessionId: "codex_thr_desktop", type: "agent.output", text: " again" }
    ]);

    expect(decideSessionAutoScroll(previous, current)).toBe("bottom");
  });

  it("restores the previous scroll position when the webview rerenders without new session content", () => {
    const previous = {
      ...toSessionScrollSnapshot("codex_thr_desktop", [
        { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" }
      ]),
      seenSessionIds: ["codex_thr_desktop"],
      nearBottomBySession: {
        codex_thr_desktop: true
      },
      scrollTopBySession: {
        codex_thr_desktop: 240
      }
    };
    const current = toSessionScrollSnapshot("codex_thr_desktop", [
      { seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" }
    ]);

    expect(decideSessionAutoScroll(previous, current)).toBe("preserve");
    expect(resolveSessionPreservedScrollTop(previous, current, 300)).toBe(240);
  });

  it("uses the defined preserved-scroll helper name in the inline webview script", async () => {
    const html = await renderPairingHtml({
      status: "running",
      lanEnabled: true,
      pairingJson: "{}",
      qrSvg: "<svg></svg>",
      selectedSessionId: "codex_thr_desktop",
      sessionEvents: [{ seq: 3, sessionId: "codex_thr_desktop", type: "agent.output", text: "hello from codex" }],
      dashboard: dashboard({
        sessions: [
          {
            id: "codex_thr_desktop",
            adapterId: "codex",
            title: "Fix mobile handoff",
            workspace: "E:/Code/code-agent-mobile",
            status: "running",
            startedAt: "2026-07-02T12:00:00.000Z",
            lastSeq: 7
          }
        ]
      })
    });

    expect(html).toContain("function resolveSessionPreservedScrollTop(");
    expect(html).toContain("const restoredScrollTop = resolveSessionPreservedScrollTop(");
    expect(html).not.toContain("resolvePreservedScrollTop(");
  });
});
