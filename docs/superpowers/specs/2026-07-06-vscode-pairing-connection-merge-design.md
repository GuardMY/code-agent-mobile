# VS Code Pairing Connection Merge Design

**Goal:** Merge the VS Code sidebar pairing entry and pairing details into a single bottom card titled `配对连接`, with the QR code and pairing JSON always shown together.

**Scope**

- Keep the pairing area at the bottom of the VS Code sidebar.
- Replace the separate `扫码连接第一台移动设备` and `配对信息` panels with one merged panel.
- Use the fixed title `配对连接` regardless of whether any mobile device is already paired.
- Show the helper text, QR code, and pairing JSON in the same panel when pairing data is available.
- Keep the existing LAN control panel separate.

**Design**

- Limit the change to the VS Code webview renderer so host, protocol, and mobile behavior remain unchanged.
- Replace the current pairing entry footer panel and pairing artifacts footer panel with a single `pairing-connection-panel`.
- Remove the active-device-count title switch so the merged panel title is always `配对连接`.
- Render the merged panel with one short description followed by the QR code block and JSON block when `pairingJson` can be parsed into valid pairing details.
- If pairing data is not available, keep the merged panel visible with explanatory empty-state text instead of rendering a second details panel.
- Preserve the existing footer order after the main dashboard content: merged pairing panel first, LAN controls second.

**Testing**

- Add webview coverage that asserts the merged `配对连接` panel renders once and contains both the QR section and pairing JSON content.
- Add coverage that asserts the old standalone titles `扫码连接第一台移动设备`, `添加设备`, and `配对信息` are no longer rendered.
- Package the VS Code extension as a VSIX after the change.
