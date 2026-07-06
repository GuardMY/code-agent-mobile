# VS Code Session Detail Auto-Scroll Design

**Goal:** Make the VS Code plugin session detail view keep the latest message visible at the right moments without disrupting users who are reading older content.

**Scope**

- Auto-scroll to the latest message the first time a session detail is opened.
- Auto-scroll to the latest message after the plugin user sends a message.
- When agent output arrives, auto-scroll only if the detail view was already near the bottom before the update.
- Preserve scroll position when agent output arrives while the user is reading older messages away from the bottom.

**Design**

- Keep scroll-follow behavior inside the webview layer because it is presentational state tied to the message container.
- Add a stable session message container identifier and a small client-side scroll state tracker in the webview script.
- Track whether the selected session has been shown before and whether the message container is currently near the bottom.
- Trigger scroll-to-bottom on session selection and user send actions.
- On webview rerender caused by new events, only follow agent output if the previous render state indicates the user was already near the bottom.

**Testing**

- Add webview coverage for the rendered session detail container and scroll behavior hooks.
- Add extension coverage where needed for user-send event ordering so the latest user message remains the last rendered item before host updates arrive.
- Package the VS Code extension as a VSIX after the change.
