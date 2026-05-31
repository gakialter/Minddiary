# 今日行动队列设计说明

## 设计目标

今日行动队列把今日 Dashboard 的判断转换为当天可执行任务。第一版聚焦基础闭环：用户可以在今日决策页手动新增任务，也可以根据待复习错题和缺少今日日记生成建议任务，然后完成、跳过或删除。

本轮不引入 Pomodoro 深度联动和 AI 一键转任务，避免一次性拉长状态链。

## 数据结构

SQLite 新增 `study_tasks` 表，browser fallback 使用 `localStorage` 的 `mindiary_study_tasks` key 保存相同结构。

| 字段 | 说明 |
| --- | --- |
| `id` | 自增主键 |
| `title` | 任务标题，不能为空 |
| `description` | 任务说明，默认为空字符串 |
| `type` | `review`、`focus`、`diary`、`mistake`、`custom` |
| `subject_id` | 可选科目 ID，删除科目后置空 |
| `related_mistake_id` | 可选错题 ID，删除错题后置空 |
| `related_entry_id` | 可选日记 ID，删除日记后置空 |
| `planned_date` | 计划日期，格式为 `YYYY-MM-DD` |
| `estimate_minutes` | 预计分钟数，默认 25 |
| `status` | `todo`、`doing`、`done`、`skipped` |
| `source` | `manual`、`dashboard`、`ai`、`pomodoro` |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

当前校验规则：

- `title` 必须是非空字符串。
- `planned_date` 必须匹配 `YYYY-MM-DD`。
- `type`、`status`、`source` 必须属于允许枚举。
- `estimate_minutes` 必须是正整数。
- 关联 ID 必须为空或正整数。

## 使用流程

1. 打开今日 Dashboard。
2. 在“今日行动队列”中输入标题、选择类型和预计分钟数，点击新增。
3. 如果今日存在风险池错题且还没有 `review` 任务，可点击“生成今日错题复习任务”。
4. 如果今日还没有日记且还没有 `diary` 任务，可点击“生成今日学习沉淀任务”。
5. 对任务执行完成、跳过或删除后，队列会重新加载，并触发 Dashboard 数据刷新。

## 当前限制

- `study_tasks` 暂未与 `pomodoro_sessions` 建立外键或统计关联。
- Pomodoro 页面暂不支持选择今日任务作为本轮专注目标。
- AI 助手暂不生成结构化行动计划，也不解析 AI 输出入库。
- Dashboard 建议任务只基于今日风险池和今日日记是否存在两个信号。

## 后续计划

- Pomodoro 选择今日 `todo / doing` 任务作为专注目标。
- 专注完成后在 `PomodoroAlert` 中提供“标记任务完成”。
- AIPanel 增加“生成今日行动建议”，第一版只展示 AI 回复。
- 在任务量增加后补充按科目、来源和状态的过滤视图。
