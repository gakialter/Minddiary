# MindDiary v1.11.3

MindDiary v1.11.3 是本地更新日志展示与更新体验优化版本。用户可以直接在应用的“设置 → 关于”区域查看当前版本和新版本的更新内容，不需要登录 GitHub。

## 应用内更新日志

- 新增当前版本的内置更新摘要，离线状态下也可查看。
- 检查到新版本时，在现有更新区域展示新版本号、更新摘要和可用的发布时间。
- 远程 Release Notes 由 `electron-updater` 获取并按纯文本安全展示，不直接渲染不可信 HTML。

## 更新流程稳定性

- 远程更新说明缺失时显示明确的降级文案，不阻断检查、下载或安装流程。
- 网络或 updater 错误不会影响当前版本更新日志的离线展示。
- browser fallback 没有 Electron updater API 时仍可正常查看当前版本更新内容。

## 数据模型、备份与兼容性

- SQLite schema version 仍为 4。
- 没有新增 migration、数据库表或字段。
- 不改变自动 ZIP 备份、恢复或 JSON 导入导出格式。
- 不修改用户历史数据。

## 发布边界

- 本版本不包含 v1.12.0 的章节与今日任务闭环工作。
- 不修改发布签名、macOS notarization 或 release asset workflow。
- 不修改、删除、移动或重新发布任何既有 tag、Release 或历史资产。
- 安装烟雾测试仍是发布候选资产生成后的人工验收，不由 CI 构建结果替代。

## Windows 安装包说明

- Windows 资产仍未获得项目级代码签名证书；未签名安装包可能显示 Unknown Publisher 或触发 Windows SmartScreen 提醒。
- 本版本不宣称现有 unsigned 资产已签名。

## macOS 安装包说明

- macOS 构建仍使用 ad-hoc signature，未完成 Apple notarization。
- DMG 与 ZIP 的人工启动验收只确认基本安装/启动边界，不代表 Gatekeeper notarization 验证通过。
