# Claude Phase 9 战役 - 最终回合：DevOps / CI 流水线建设

前置任务均已圆满完成！现在我们要为 MindDiary 注入开源超级巨作的灵魂——**GitHub Actions 自动化双端发版**。
请你接手这段 DevOps 配置。

### 任务 1：编排 GitHub Actions Yaml
在项目根目录创建文件：`.github/workflows/release.yml`

请按照以下规格编写这个配置：
1. **触发时机 (Trigger)**: 当推送形如 `v*` (例如 v1.0.1, v2.0.0) 的 Git Tag 时触发。
2. **多平台矩阵 (Matrix)**: 设置 `os: [windows-latest, macos-latest]`，以便同时打出 Windows `.exe` 和 macOS `.dmg`。
3. **环境配置**:
   - 检出代码 `actions/checkout@v4`。
   - 配置 Node.js v18 环境 `actions/setup-node@v4`。
4. **编译与构建**:
   - 执行 `npm ci`（干净安装各依赖，特别是 `better-sqlite3` 会在这里进行预编译）。
   - 执行 `npm run build`。
5. **发布到 GitHub Releases (Artifact 挂载)**:
   - 使用官方生态或业内标杆 Action，例如 `softprops/action-gh-release@v2`。
   - `files` 路径指明：
     - 对于 windows: `release/*.exe` (或 `release/**/*.exe`)
     - 对于 mac: `release/*.dmg` (或 `release/**/*.dmg`)
   - 务必透传 `env.GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` 获取对该 Release 写入权限。

### 任务 2：补充必要权限设置 (针对 package.json)
- 为确保 `electron-builder` 在 GitHub Actions 取不到系统环境变量时也能平稳运行，请确认 `package.json` 中的 `build` 对象里是否有明确定义 `appId`，并且给 mac 添加确切的 target，比如：
```json
"build": {
  "mac": {
    "target": ["dmg", "zip"]
  },
  "win": {
    "target": ["nsis", "portable"]
  }
}
```
结合项目实际情况稍作微调即可，不必硬套。

完成后，向指令长 (User) 汇报工作结束，并将如何打 Tag 并触发打包的最后两行终端命令示例告诉他！
