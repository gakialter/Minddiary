# MindDiary v1.11.2

MindDiary v1.11.2 是发布卫生与文档同步补丁。本版不新增产品功能，重点收紧未来 GitHub Release 的资产清单、消除 GitHub Actions Node runtime 弃用警告，并同步版本规划与发布验收说明。

## Release 资产卫生

- Windows 与 macOS 构建完成后，只把精确 allowlist 中的根目录正式资产复制到独立 staging 目录。
- GitHub Release 只接受 Setup、Portable、DMG、macOS ZIP、对应 blockmap 以及 `latest.yml` / `latest-mac.yml`。
- `win-unpacked`、macOS app bundle 和其他打包内部目录不进入 Release 资产清单。
- `MindDiary.exe` 与 `elevate.exe` 不再作为独立 GitHub Release 资产上传。
- 本次只修复未来 Release；不修改、删除或替换 v1.11.1 及更早版本的已发布资产。

## Release manifest 与 Actions runtime

- 新增 release asset manifest 测试，锁定允许资产、禁止的 unpacked 内部文件、版本化文件名和非递归上传路径。
- 更新 metadata 校验，要求 `latest.yml` / `latest-mac.yml` 的 version 与 package version 一致，path 指向正式根目录 installer / macOS ZIP，并保留 sha512 与 releaseDate 校验。
- 将声明 Node 20 runtime 的 GitHub Actions 升级到对应的最小 Node 24 稳定 major；项目构建继续使用 Node 22。

## 文档与验收边界

- README、路线图、版本拆分和 release checklist 同步到 v1.11.2。
- CI 负责 typecheck、测试、构建、更新 metadata、签名策略和 release asset manifest 验证。
- 安装烟雾测试仍是发布阶段的人工验收：Windows Setup 安装、Windows Portable 启动、macOS DMG 基本启动边界、macOS ZIP 基本启动边界。

## 数据模型、备份与兼容性

- SQLite schema version 仍为 4。
- 没有新增 migration、数据库表或字段。
- 不改变自动 ZIP 备份、恢复或 JSON 导入导出格式。
- 不修改用户历史数据；v1.11.0 / v1.11.1 数据库和备份继续兼容。

## Windows 安装包说明

- Windows 资产仍未获得项目级代码签名证书；未签名安装包可能显示 Unknown Publisher 或触发 Windows SmartScreen 提醒。
- 若发布环境同时提供 `CSC_LINK` 和 `CSC_KEY_PASSWORD`，Setup 与 Portable 资产必须通过 Authenticode 验证；本版不宣称现有 unsigned 资产已签名。

## macOS 安装包说明

- macOS 构建仍使用 ad-hoc signature，未完成 Apple notarization。
- DMG 与 ZIP 的人工启动验收只确认基本安装/启动边界，不代表 Gatekeeper notarization 验证通过。

## 本版不包含

- 不包含产品功能、UI 重构、章节加入今日任务、任务历史、AI 流式输出或 OCR。
- 不包含 schema 5、migration 或 backup / restore 格式变更。
- 不重新发布 v1.11.1，不修改任何既有 tag、Release、Release commit 或历史资产。
