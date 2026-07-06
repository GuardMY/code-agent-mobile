# VS Code Mobile Device Filter And Unbind Design

**Goal:** Keep VS Code plugin connections out of the mobile device list and let the plugin unbind paired mobile devices directly.

**Scope**

- Only show active mobile clients in the VS Code "移动设备" panel.
- Hide `desktop-extension` clients from that panel without changing host-side device tracking.
- Hide revoked devices from the panel instead of showing them in a disabled state.
- Add an unbind action for visible mobile devices in the plugin UI.

**Design**

- Treat the host dashboard as the full source of device truth, but filter devices inside the VS Code webview before rendering the "移动设备" list.
- Define visible mobile devices as `android-app`, `ios-app`, and `wechat-mini-program` entries without `revokedAt`.
- Keep `desktop-extension` records in host state so desktop pairing and authorization behavior stay unchanged.
- Add an `解绑` button to each visible device row in the webview and post a message back to the extension host with the selected `deviceId`.
- Extend the local host client with a revoke request that calls `POST /devices/:deviceId/revoke`.
- After a successful revoke request, refresh the dashboard so the device disappears from the filtered list immediately.
- Reuse the existing console error surface for revoke failures instead of adding a new notification channel.

**Testing**

- Add webview coverage for filtering out `desktop-extension`, hiding revoked devices, and showing unbind buttons only for active mobile devices.
- Add host client coverage for the revoke request path and authorization header behavior.
- Add extension-side coverage for clearing the selected session error surface after a successful unbind-triggered refresh only through the existing refresh flow where needed.
