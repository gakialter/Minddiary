# MindDiary v1.11.1

MindDiary v1.11.1 是 v1.11.0 之后的稳定性热修复，聚焦长时间打开应用、跨本地午夜后「今天」上下文漂移，以及日记任务、今日任务闭环和专注结算的一致性。

## 日期与今日上下文

- 统一当前本地日期来源，今日决策、默认日记日期、今日任务、Pomodoro 今日统计和顶部日期上下文使用同一个 `YYYY-MM-DD`。
- 应用在本地午夜后自动刷新当前日期，并在窗口恢复可见、系统唤醒或重新聚焦时重新校验日期。
- 用户明确从日历、搜索等入口选择历史日记后，会继续停留在该历史日期；主动回到今天后才恢复跟随当前日期。
- 新建今日任务、AI 今日行动建议入口和 Pomodoro 今日任务列表不再因为长时间打开应用而落到旧日期。

## 日记任务闭环

- 手动保存有效日记后，继续只匹配同日或精确关联的 active `diary` task，不会把历史日记关联到当前日期任务。
- 自动保存、心情、标签、图片上传和 Pomodoro 一句话复盘不会触发日记任务自动完成。
- 任务结算失败时，日记保存结果仍保留，并向用户显示任务结算错误。

## 今日任务闭环指标

- 修复 Dashboard 未闭环判断：普通 `todo` 任务即使没有专注记录，也会进入未闭环提示。
- `doing` 无专注、`todo` / `doing` 有专注但未完成的任务都会被视为未闭环；只有所有有效任务都是 `done` 时才显示今日任务已闭环。
- Electron SQLite 实现和 browser fallback 使用同一套任务专注指标规则，保持 `completionRate`、`focusCoverageRate`、`openWithoutFocusCount`、`focusedOpenTaskCount` 和未闭环标题一致。

## Pomodoro 结算稳定性

- 移除了绑定任务结算过程中隐藏的原生确认框；当当天没有日记且用户填写了复盘时，应用内结算弹窗会明确询问是否创建日记。
- 专注 session 保存、任务完成、复盘写入和弹窗关闭拆分为可恢复状态；取消创建日记不会回滚已保存的专注记录或任务结算。
- 复盘写入失败会显示错误并允许继续处理，不再让界面长期停留在“保存中...”。
- 跨午夜 session 继续使用 session 开始日期保存 `date_key` 和复盘日期，避免绑定任务与统计日期漂移。

## 数据模型、备份与兼容性

- SQLite schema version 仍为 4。
- 没有新增 migration、没有新增数据库表、没有改变自动 ZIP 备份格式。
- 不修改用户历史数据；既有 v1.11.0 数据库和备份可继续使用。

## Windows 安装包说明

- Windows 安装包签名状态沿用 v1.11.0 策略：没有签名证书时资产可能显示 Unknown Publisher 或触发 Windows SmartScreen 提醒。
- 若发布环境提供 `CSC_LINK` 和 `CSC_KEY_PASSWORD`，Windows Setup 和 Portable 资产必须通过 Authenticode 签名验证；本次说明不虚假宣称 unsigned 资产已签名。

## 本版不包含

- 不包含 chapter → task 关联、任务历史页、周复盘、FSRS、OCR、云同步或大型 UI 重构。
- 不包含 release workflow 资产 glob 调整或 GitHub Actions Node runtime warning 修复。
- 不重新发布 v1.11.0，不修改任何既有 tag、Release 或历史资产。
