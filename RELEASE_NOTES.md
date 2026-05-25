# MindDiary v1.9.5

本次更新聚焦于专注统计和不定时长学习场景，新增 Pomodoro 正计时模式，并增强 Dashboard 的单日与自定义日期范围统计能力。

## 新功能

### Pomodoro 正计时模式
- 新增 Stopwatch / Count-up 正计时模式，适合不确定学习时长的专注场景。
- 支持开始、暂停、继续、重置、结束并保存。
- 正计时记录复用现有 `pomodoro_sessions` 数据模型。
- 正计时记录会自动进入 Dashboard 统计。
- 少于 1 分钟的正计时 session 不会保存，避免产生无效记录。

### Dashboard 日期筛选
- 专注分布支持选择具体某一天进行单日钻取。
- 支持自定义开始日期和结束日期，查看指定范围内的专注统计。
- 支持按科目 / 项目维度查看投入时间分布。
- 新增范围统计下的总时长、专注次数、平均时长等指标。
- 支持空数据状态和非法日期范围提示。

## 优化

- 抽取 Pomodoro 统计聚合逻辑为纯函数，提升可测试性和维护性。
- Dashboard 统计逻辑同时兼容倒计时番茄记录和正计时记录。
- README 增加正计时和 Dashboard 日期筛选说明。

## 验证

- Typecheck 通过。
- Unit tests 通过。
- Build 通过。
- E2E tests 通过。
- GitHub CI 通过。

## 发布说明

- 本版本不新增数据库表。
- 本版本不新增依赖。
- Windows 安装包如未进行代码签名，可能出现 Unknown Publisher 或 Windows SmartScreen 提示。
- macOS 构建由 GitHub Actions 自动生成。
- #64 和 #65 已由 PR #66 完成并关闭。
- #47 仍作为 umbrella issue 保持 open。
