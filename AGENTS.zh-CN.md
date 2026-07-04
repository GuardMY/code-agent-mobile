# 项目开发规则

这些规则适用于整个仓库。

## 强制重新构建

- 当改动涉及 `android/` 下的 Android App 时，完成前必须重新构建 App 并产出 APK。
  - 优先执行：进入 `android` 后运行 `.\gradlew.bat :app:assembleDebug`
  - 如果仓库没有 Gradle Wrapper，则使用本机 Gradle：进入 `android` 后运行 `gradle :app:assembleDebug`
  - 确认 debug APK 已生成，通常位于 `android/app/build/outputs/apk/debug/`。
  - 每次重新构建 App 时，面向分发或用户可见发布的 APK 应按需升级 `versionCode` 和/或 `versionName`；仅用于验证的本地重构建无需升级版本号，除非用户明确要求。
- 当改动涉及 `vscode-extension/` 下的 VS Code 插件时，完成前必须将插件打包成 VSIX。
  - 执行：`npm run package:extension`
  - 确认 `.vsix` 文件已生成，通常位于 `vscode-extension/`。
- 当 `vscode-extension/` 之外的改动会影响 VS Code 插件的运行时行为、集成行为或插件打包后启动的 host 功能时，完成前也必须将插件打包成 VSIX。
  - 这包括 `agent-host/`、`protocol/`，以及 VS Code 插件会启动、打包、调用或渲染的共享契约改动。
  - 执行：`npm run package:extension`
  - 确认 `.vsix` 文件已生成，通常位于 `vscode-extension/`。
- 如果同一次改动同时涉及 Android App 和 VS Code 插件，必须同时产出 APK 和 VSIX。
- 如果必须生成的 APK 或 VSIX 无法构建，必须报告尝试过的具体命令和失败原因。

## 文档

- 所有项目文档都必须维护中文和英文两个版本。
- 新增或修改文档时，必须在同一次改动中新增或更新对应的中文和英文版本。
- 如果已有命名模式，沿用现有模式，例如中文使用 `*.zh-CN.md`，英文使用 `*.en.md` 或 `*.md`。
- 如果对应语言版本还不存在，完成前必须创建。
