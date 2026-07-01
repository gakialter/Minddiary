# MindDiary v1.13.2

MindDiary v1.13.2 是面向确定性与连续操作体验的低风险维护补丁，不扩展产品功能。SQLite schema unchanged，仍为 schema **5**。

## Deterministic ordering

- 错题列表在 Electron SQLite 与 browser fallback 中统一按 `created_at DESC, id DESC` 稳定排序；相同创建时间下分页顺序保持一致。
- Pomodoro 科目聚合按总分钟数降序、session count 降序、科目名升序稳定排序；统计含义、颜色与未分类回退保持不变。

## Continuous chapter operations

- 修复 #119：在详细章节列表中连续“加入今日任务”、勾选或取消完成状态时，不再因无必要的全量重载回到页面顶部。
- 今日任务按钮与章节完成进度在成功路径局部更新；失败路径与外部数据刷新仍会回源读取真实状态。

## Verification boundary

- #120、#121、#122 均在各自 exact head 上通过 test、Windows build verification 与 macOS build verification 后合并。
- #122 已在隔离 Electron profile 中完成 24 章节真实 UI smoke：中下部连续加入今日任务、勾选/取消完成均保持当前位置，跨页面重载后任务与完成状态仍来自 SQLite。
- 发布前仍需对候选 Windows Setup 或 Portable 构建执行最终 packaged smoke；本次 release-prep 不创建 tag 或 GitHub Release。

## Compatibility

- schema unchanged；`CURRENT_SCHEMA_VERSION` remains **5**，不新增 migration。
- no dependency changes；不改变筛选、分页参数、统计聚合、复习、图片或章节任务业务规则。
- no product feature expansion；不包含 subject management ordering、npm audit 或 v2.0 工作。

## Windows 安装包说明

- 本版本不声明 Windows 安装包已经代码签名。
- 如果发布资产未配置代码签名，Windows 可能显示 Unknown Publisher，或触发 Windows SmartScreen。

## Release gate

- release-prep PR 必须在 current head 上通过 CI。
- tag 前必须再次确认 `package.json`、`package-lock.json` 与 `RELEASE_NOTES.md` 均为 `1.13.2`。
- 完成候选 packaged Windows smoke 与严格 release asset allowlist 审核后，才能进入另行授权的 tag / GitHub Release 阶段。
