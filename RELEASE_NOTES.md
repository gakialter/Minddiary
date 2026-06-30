# MindDiary v1.13.1

MindDiary v1.13.1 是基于 v1.13.0 的稳定性与验证补丁，不扩展产品功能。SQLite schema unchanged，仍为 schema **5**。

## Reliability and validation

- 补强 v1.13.0 task/chapter parity audit 与回归覆盖，锁定 Electron SQLite 和 browser fallback 的章节任务行为。
- 补强 schema **4 → 5** migration assertions、旧库升级与兼容性验证；本版本不新增 migration。
- 将 README 与 release checklist 同步到 v1.13.0 / schema 5 正式基线。
- 修复 #114 错题本图片上传与保存稳定性：等待异步上传、阻止失败态保存、保护题目/答案图片引用，并安全清理未提交图片。

## Verification boundary

- #117 的 Electron UI smoke 已覆盖纯文本错题、题目图片、答案图片、双图片、失败态阻止保存、删除图片、pending 图片清理与安全错误提示。
- 发布前仍需对候选 Windows Setup 或 Portable 构建执行最终 packaged smoke，至少覆盖启动、章节任务和错题图片保存。

## Compatibility

- schema unchanged；`CURRENT_SCHEMA_VERSION` remains **5**。
- schema 4 数据库继续通过既有 migration 升级到 schema 5；本版本不改变持久化结构。
- no product feature expansion；不包含新的产品功能、业务流程或 subject ordering 变更。

## Windows 安装包说明

- 本版本不声明 Windows 安装包已经代码签名。
- 如果发布资产未配置代码签名，Windows 可能显示 Unknown Publisher，或触发 Windows SmartScreen。

## Release gate

- release-prep PR 必须在 current head 上通过 CI。
- tag 前必须再次确认 `package.json`、`package-lock.json` 与 `RELEASE_NOTES.md` 均为 `1.13.1`。
- 完成候选 packaged Windows smoke 后，才能进入 tag / GitHub Release 阶段。
