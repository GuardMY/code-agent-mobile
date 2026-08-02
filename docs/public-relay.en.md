# Public Relay Connection

Code Agent Mobile supports public-network access through an outbound WebSocket relay. The desktop Host keeps listening on loopback or the LAN as configured; it does not need an inbound public port.

## Relay Deployment

Run the Gateway on a reachable server and terminate TLS in front of it. Mobile clients must use a `wss://` URL with a valid certificate.

```powershell
npm run dev:gateway -- --host 0.0.0.0 --port 17366
```

For a public deployment, configure a reverse proxy to forward WebSocket upgrades for `/host` and `/app` to the Gateway. Do not expose the Agent Host HTTP port.

The Gateway supports two modes:

- Dynamic channels: omit `--relay-token`. The first Host to claim a `hostId` binds its channel token; matching clients can join it.
- Static channels: set `--relay-token <token>`. Every Host and mobile client must present that token.

## VS Code Configuration

Set all three settings together. The Host starts an outbound relay connection automatically whenever `Agent Mobile: Start Host` or LAN pairing starts it.

```json
{
  "agentMobile.relayUrl": "wss://relay.example.com",
  "agentMobile.relayHostId": "host_8c02d1f5b2c84a58",
  "agentMobile.relayToken": "replace-with-a-unique-secret-at-least-16-characters"
}
```

Use a unique, high-entropy `relayHostId` and `relayToken` for each desktop host. The extension validates complete configuration and includes the relay details in the pairing QR code and JSON.

## Mobile Flow

1. Start the Host from VS Code after configuring the relay.
2. Scan the generated QR code or paste its pairing JSON into Android.
3. Android uses the relay for pairing, reauthentication, session data, commands, approvals, and live events.

Existing LAN-only pairing JSON continues to work unchanged. Android accepts public relay payloads only when all relay fields are present and the URL uses `wss://`.

## Security Notes

- Use TLS and a valid certificate for every public relay endpoint.
- Treat the relay token and QR pairing JSON as credentials. Do not commit them to source control or paste them into logs.
- Keep the Gateway and Agent Host updated. Revoke a device from the desktop dashboard when a phone is lost or no longer trusted. Because the relay token is channel-wide, also rotate it and re-pair remaining devices after a lost device has received the token.
- The Host proxies only the authenticated mobile API operations required by the app; Host lifecycle control is not available through the public relay.
