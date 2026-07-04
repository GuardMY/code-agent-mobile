# 鏈湴灞€鍩熺綉 MVP 寮€鍙戞寚鍗?
## 鍓嶇疆鏉′欢

- Node.js 24 鎴栨洿楂樼増鏈€?- npm 11 鎴栨洿楂樼増鏈€?- `codex` CLI 鍙湪 `PATH` 涓皟鐢紝鎴栧湪 VS Code 璁剧疆涓厤缃?`agentMobile.codexCommand`銆?- 鏋勫缓 Android App 闇€瑕?Android Studio 鍜?Android SDK 35銆?
鏈粨搴撳寘鍚?TypeScript Host 鍜?VS Code 鎻掍欢鏋勫缓銆侫ndroid 婧愮爜浣嶄簬 `android`銆?
## 瀹夎

```powershell
npm install
```

## 鏋勫缓鍜屾祴璇?TypeScript 鍖?
```powershell
npm run build
npm run test
```

## 鐩存帴杩愯 Agent Host

```powershell
npm run build
npm run dev:host -- --host 127.0.0.1 --port 17365 --workspace E:\Code\code-agent-mobile --pairing-token pairing-token-123
```

Host 启动后会输出一条 JSON ready 消息，其中包含对外地址、端口和配对 token。配对后的访问令牌长期有效，直到桌面端插件或移动端手动解绑。
## VS Code 鎻掍欢璋冭瘯娴佺▼

1. 鍦?VS Code 涓墦寮€浠撳簱鏍圭洰褰曘€?2. 鎵ц `npm install`銆?3. 鎵ц `npm run build`銆?4. 浠?Extension Development Host 妯″紡鍚姩鎻掍欢銆?5. 鎵撳紑 `Agent Mobile` Activity Bar 闈㈡澘銆?6. 鎵ц `Agent Mobile: Start Host` 鍚姩鏈満 loopback 妯″紡銆?7. 鎵ц `Agent Mobile: Enable LAN Pairing` 灏?Host 鏆撮湶鍒?`0.0.0.0`銆?8. 鍦?Android App 涓壂鎻忎簩缁寸爜鎴栫矘璐撮厤瀵?JSON銆?
## VS Code 鎻掍欢鎵撳寘

鏋勫缓鎻掍欢骞剁敓鎴?`.vsix`锛?
```powershell
npm run package:extension
```

鐢熸垚鏂囦欢浣嶄簬 `vscode-extension`锛屽悕绉扮被浼硷細

```text
agent-mobile-control-0.1.0.vsix
```

瀹夎鍒板凡鏈?VS Code锛?
```powershell
code --install-extension vscode-extension/agent-mobile-control-0.1.0.vsix
```

濡傛灉 `code` 鍛戒护涓嶅彲鐢紝鍦?VS Code 涓繍琛?`Extensions: Install from VSIX...`锛岀劧鍚庨€夋嫨鐢熸垚鐨?VSIX 鏂囦欢銆?
瀹夎鍚庨噸杞?VS Code锛屾墦寮€ `Agent Mobile` 闈㈡澘锛屾墽琛?`Agent Mobile: Start Host`銆傛彃浠朵細閫氳繃 `agentMobile.codexCommand` 鍚姩 `codex app-server`锛岃€屼笉鏄惎鍔ㄧ嫭绔嬬殑浜や簰寮?`codex` CLI 浼氳瘽銆?
## 鎻掍欢閰嶇疆

- `agentMobile.port`锛氶粯璁?`17365`銆?- `agentMobile.codexCommand`锛氶粯璁?`codex`銆?- `agentMobile.eventCacheSize`锛氶粯璁?`500`銆?
## Android 璋冭瘯娴佺▼

1. 鍦?Android Studio 涓墦寮€ `android`銆?2. 鏋勫缓骞跺畨瑁?app銆?3. 纭繚鎵嬫満鍜屽紑鍙戞満鍦ㄥ悓涓€缃戠粶銆?4. 鍦?VS Code 鎻掍欢涓惎鐢?LAN Pairing銆?5. 鍦?App 涓壂鎻忎簩缁寸爜鎴栫矘璐撮厤瀵?JSON銆?6. 杩炴帴鍚庨€夋嫨 Codex 浼氳瘽骞跺彂閫?prompt銆?
鏋勫缓鍛戒护锛?
```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

濡傛灉娌℃湁 Gradle wrapper锛屽彲浣跨敤鏈満 Gradle 鎴栭€氳繃 Android Studio 鐢熸垚 wrapper銆?
## 楠岃瘉

甯哥敤楠岃瘉鍛戒护锛?
```powershell
npm run build
npm run test
npm run test -w @agent-mobile/agent-host
npm run test -w agent-mobile-control
```

濡傛灉鏀瑰姩瑙﹀強 Android 鎴?VS Code 鎻掍欢锛屽繀椤婚伒瀹堟牴鐩綍 `AGENTS.md` 涓殑寮哄埗閲嶅缓瑙勫垯銆?
