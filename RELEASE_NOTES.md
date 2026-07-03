# MindDiary v1.13.3

MindDiary v1.13.3 是一个聚焦本地媒体删除安全性的维护补丁，不扩展产品功能。SQLite schema unchanged，仍为 schema **5**。

## Realpath-aware media deletion containment

- 附件单项删除在执行 destructive `unlink` 前，同时保留原有 lexical validation 并校验真实目标仍位于托管附件目录内。
- 日记条目附件批量清理使用相同的 realpath containment，避免目录内 junction / symlink 将删除目标重定向到托管目录之外。
- 托管错题图片删除在执行 `unlink` 前校验真实目标，阻止通过 `mistake_images` 内 junction / symlink 删除外部文件。
- 目标文件或托管目录不存在时继续按安全缺失处理；权限、I/O 或其他非 `ENOENT` 文件系统错误不会被吞掉。

## Verification boundary

- #126 在 exact head `f124ada2392a616f756a51ae21d33c9f0e318ccb` 上通过 test、Windows build verification 与 macOS build verification 后，以 squash merge 进入 `main`。
- 回归测试使用真实临时 junction（其他平台使用 directory symlink）从托管目录内路径指向外部哨兵文件，并确认附件单项删除、条目附件清理和托管错题图片删除均不会删除哨兵。
- 本次 release-prep 不构建或验收 Windows Setup / Portable，不创建 tag 或 GitHub Release。

## Compatibility

- schema unchanged；`CURRENT_SCHEMA_VERSION` remains **5**。
- API unchanged；不改变 renderer、preload 或 IPC 公共接口。
- migration unchanged；不新增或修改数据库 migration。
- dependency unchanged；不新增、删除或升级依赖。
- 不包含 #124 同日期 tie-breaker、负数 limit 语义、路线图或其他相邻修复。

## Windows 安装包说明

- 本版本不声明 Windows 安装包已经代码签名。
- 如果发布资产未配置代码签名，Windows 可能显示 Unknown Publisher，或触发 Windows SmartScreen。

## Release gate

- release-prep PR 必须在 current head 上通过 CI。
- tag 前必须再次确认 `package.json`、`package-lock.json`、内置更新摘要与 `RELEASE_NOTES.md` 均为 `1.13.3`。
- 完成候选 packaged Windows smoke 与严格 release asset allowlist 审核后，才能进入另行授权的 tag / GitHub Release 阶段。
