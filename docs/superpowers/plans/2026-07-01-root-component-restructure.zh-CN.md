# 根目录组件重组实现计划

> **给 agentic worker：** 实施本计划时应使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并按任务逐项执行。

## 目标

把仓库整理为五个顶层组件目录：

- `android`
- `agent-host`
- `gateway`
- `vscode-extension`
- `protocol`

## 架构

把原先位于 `apps/`、`packages/`、`shared/` 等路径下的组件移动到仓库根目录，保留根级工程文件：

- `package.json`
- `package-lock.json`
- `tsconfig.base.json`

移动后修复所有路径引用，确保 monorepo 仍可构建、测试和打包。

## 实施任务

### 任务 1：移动组件目录

- 将 Host、Gateway、协议包、VS Code 插件和 Android App 移动到根目录。
- 保留每个组件内部结构。
- 不改变组件职责。

### 任务 2：修复 workspace 和 TypeScript 配置

- 更新根 `package.json` workspaces。
- 更新各子包 `tsconfig.json` 的相对路径。
- 更新包名和脚本引用。

### 任务 3：修复文档和计划引用

- 搜索旧路径：
  - `apps/`
  - `packages/`
  - `shared/`
- 替换为新的根目录路径。
- 保留历史计划语义，只更新路径。

### 任务 4：验证

运行：

```powershell
npm run build
npm run test
npm run package:extension
```

如涉及 Android 路径，也验证 Android 项目可被 Android Studio 或 Gradle 识别。

## 验收标准

- 五个主要组件都位于仓库根目录。
- npm workspace 可解析所有 TypeScript 包。
- 构建、测试、插件打包通过。
- 文档不再引用旧目录结构。
