# Project Development Rules

These rules apply to the whole repository.

## Mandatory Rebuilds

- When a change touches the Android app under `android/`, rebuild the app and produce an APK before reporting completion.
  - Prefer: `cd android` then `.\gradlew.bat :app:assembleDebug`
  - If the Gradle wrapper is not present, use the local Gradle install: `cd android` then `gradle :app:assembleDebug`
  - Confirm the debug APK is produced, normally under `android/app/build/outputs/apk/debug/`.
- When a change touches the VS Code plugin under `vscode-extension/`, package the plugin as a VSIX before reporting completion.
  - Run: `npm run package:extension`
  - Confirm a `.vsix` file is produced under `vscode-extension/`.
- When a change touches both the Android app and the VS Code plugin, produce both the APK and the VSIX.
- If a required APK or VSIX build cannot be run, report the exact command attempted and the failure reason.

## Documentation

- All project documentation must be maintained in both Chinese and English.
- When adding or changing a documentation file, add or update its matching Chinese and English version in the same change.
- Follow the existing naming pattern when one exists, such as `*.zh-CN.md` for Chinese and `*.en.md` or `*.md` for English.
- If no matching counterpart exists yet, create one before reporting completion.
