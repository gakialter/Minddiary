# MindDiary v1.17.0

MindDiary v1.17.0 是从 v1.16.0 累积而来的用户体验、安全性和桌面运行时升级版本。SQLite schema 仍为 **5**，本版本不新增数据库 migration，现有 schema 5 数据继续兼容。

## 今日计划更容易调整

- 今日任务现在支持直接修改标题和预计时长。
- 章节任务可从默认 25 分钟调整为实际所需时长，允许范围为 1–240 分钟。
- 保存后任务行和今日总预计时长会即时更新。
- 编辑只改变标题和预计时长，不改变任务身份、来源、计划日期、科目或章节关联；保存失败时可保留输入后重试。

## 主目标不再固定为“考研初试”

- 用户可以在设置中修改主目标名称和日期，用于考公、论文、考证、毕业设计等不同长期计划。
- 旧 `examDate` 数据继续作为主目标日期镜像兼容，无需 migration。
- 普通关键日期的新增、置顶、归档和删除行为保持不变。
- 缺失、重复或旧格式的主目标数据会在现有设置归一化流程中处理，同时保留用户自定义标题。

## 错题本稳定性改进

- 修复浮动 Pomodoro 控件在受限窗口高度下遮挡错题输入区域的问题。
- 改进连续创建、编辑、输入法组合输入和保存失败后的安全重试，避免重复或状态不同步。
- 错题创建和更新在浏览器 fallback 与 Electron/SQLite 路径使用一致的运行时校验。
- 手动 JSON 备份导入会先校验整个错题批次，再原子写入；跨 profile 科目引用会映射并校验。
- 失败批次保持零写入；修正问题后重试不会遗留部分记录或额外重复记录。

## Electron 与安全性升级

- Electron 升级到 **42.6.1**，`better-sqlite3` 升级到 **12.11.1**。
- 主窗口显式启用 renderer sandbox，并保持 context isolation、Node integration 禁用等边界。
- 导航、重定向、子窗口、权限、外部链接、剪贴板 IPC 和 PDF helper 使用更严格的主进程校验。
- 启用 ASAR integrity、Electron fuse hardening 和最小 native module unpack allowlist。
- 构建流程会验证 Electron ABI、打包后的 native SQLite 加载和关键 package security 配置。

这些改进是具体的运行时与打包边界增强，不代表不存在漏洞，也不构成第三方安全审计结论。

## 本地日期可靠性

- Daily Review 在任务持久化前后都会重新校验本地日期。
- 跨过本地午夜后，旧日期 dialog 和候选会失效，旧候选不能写入新日期或错误日期。
- Electron/SQLite 与 browser fallback 都会保持零写入或回滚，不会留下跨日的部分任务。

## 安装和打包可靠性

- 增加 Windows Setup 安装、覆盖重装、卸载和应用数据保留 smoke。
- 增加 Windows Portable wrapper 启动 smoke。
- 增加 packaged local-date rollover、packaged security 和 ASAR integrity 验证。
- 发布流水线会在 Windows 和 Apple silicon ARM64 runner 上验证打包结果、native dependency、package security、架构和代码完整性。
- Windows 候选已覆盖 Setup、Portable、数据保留、packaged security 和 ASAR integrity smoke。

## Compatibility

- SQLite schema 仍为 **5**；`CURRENT_SCHEMA_VERSION` 未变化。
- `electron/databaseMigrations.ts` 未变化，不新增 migration、数据库表或字段迁移。
- 现有用户数据目录继续使用；Windows Setup 覆盖安装预期保留应用数据。
- 旧 `examDate`、普通关键日期、错题和手动备份数据继续使用现有兼容路径。
- macOS target 仍为 Apple silicon ARM64，最低系统版本为 macOS 12.0。

## Known limitations

1. Windows 自动更新的完整下载、安装、重启端到端链路尚未完成最终验收。
2. PR #144（Windows NSIS updater E2E）不包含在 v1.17.0；遇到自动更新问题时，建议从 GitHub Release 手动下载安装包。
3. 如果未配置 Windows 代码签名，安装包可能显示 Unknown Publisher，并可能触发 Windows SmartScreen。
4. macOS 资产仅面向 Apple silicon ARM64，使用 ad-hoc signing，未进行 Apple notarization。
5. 本版本不支持 Intel macOS；当前 workflow 不生成 x64 或 universal 资产。
6. CI 的 macOS 构建和代码完整性验证不等于已在另一台 Mac 上通过所有 Gatekeeper 场景。

## Windows 安装包说明

- Release workflow 在配置 Windows signing credentials 时会验证 Authenticode 签名。
- 未配置签名凭据时，workflow 会明确生成 unsigned Windows assets。
- Unsigned Windows assets 可能显示 Unknown Publisher 或触发 Windows SmartScreen。
- 代码签名不等于已经建立 SmartScreen reputation。

## macOS 安装包说明

- Tag-triggered Release workflow 生成 ARM64 DMG、ZIP 和 update metadata。
- macOS assets 使用 ad-hoc signing，不是 Developer ID 签名，也未进行 Apple notarization。
- 当前没有另一台 Mac 的完整人工 Gatekeeper 验收证据。
- 不提供 Intel 或 universal assets。

## Verification

- v1.17.0 release-prep 候选必须通过 typecheck、单元测试、Electron E2E、Windows build verification 和 macOS ARM64 build verification。
- Windows 候选已验证 Setup、Portable、数据保留、packaged security、native dependency 和 ASAR integrity。
- macOS CI 验证 ARM64 package、native dependency、架构和 ad-hoc code integrity。
- Tag-triggered Release workflow 在创建 Release 前对正式发布资产执行 manifest 校验。
- 不声称 Windows 自动更新完整 E2E、Windows 签名、macOS notarization 或完整 Gatekeeper 验收已经完成。
