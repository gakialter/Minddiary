# MindDiary v1.9.9

MindDiary v1.9.9 是一次围绕错题主动复习、专注中断统计、数据迁移可靠性和内部维护边界的稳定性更新。它把错题复习、图片归属、科目删除和倒计时保存几个高频学习场景做得更稳，同时补齐了 SQLite schema version 与历史数据库升级验证。

## 本版亮点

- 错题本新增主动「开始复习」入口，可按当前科目限定今日到期错题范围。
- 错题列表和主动复习默认先展示问题，答案、备注和答案图片在「查看答案」后再显示。
- 错题图片拆分为题目图片和答案图片两个角色，历史图片继续作为题目图片保留。
- work / custom 倒计时可在至少有效专注 1 分钟后提前结束并保存，普通页面和 Zen 模式都可操作。
- 删除科目时保留关联错题、专注记录和学习任务，只解除这些历史记录的科目归属。
- SQLite schema version 升至 2，并增加真实历史数据库 fixture 的升级测试。
- AI 请求增加历史清理、role / 数量 / 长度边界和旧响应覆盖防护。

## 错题复习与图片

- 错题本顶部提供明确的「开始复习」入口，进入今日到期错题的主动复习流程。
- 当前科目筛选会同步限制主动复习池，方便只复盘某一科目的到期错题。
- 复习卡片先显示问题和题目图片；答案、备注、答案图片和评分按钮默认隐藏。
- 点击「查看答案」后再显示答案与备注，并继续使用现有 SM-2 评分更新下次复习时间。
- 列表里的错题同样默认折叠答案与备注，降低直接看到答案造成的干扰。
- 新增和编辑错题时，题目图片与答案图片分区管理；两区都支持上传、粘贴和拖拽。
- 已有图片可以在题目 / 答案角色之间移动。图片清理会同时检查两个角色，移动或共享引用不会误删本地文件。
- 自动备份、旧备份恢复和 browser fallback 已兼容 `answer_image_path`。

## 专注体验

- work / custom 倒计时运行至少有效专注 1 分钟后，可以点击「提前结束并保存」。
- 保存前会显示实际有效专注时长和最终计入统计的分钟数。
- 暂停期间不计入有效专注时长；计入分钟规则与正计时保存保持一致。
- Zen 全屏专注界面提供同样的提前保存入口。
- 提前保存失败时，会话保持暂停状态，用户可以重试保存。
- 活动倒计时执行 reset 时会明确提示将放弃尚未保存的专注记录。
- 提前保存不会自动进入短休，也不会打开休息错题复习弹窗；自然完成的番茄行为保持不变。

## 数据安全与升级

- SQLite 数据库开始显式管理 schema version，当前 schema version 为 2。
- 新增 `answer_image_path` nullable 字段，用于保存答案图片引用。
- 历史 `image_path` 数据不会被改写，旧错题图片继续作为题目图片显示。
- version 0、version 1 和 current database 的升级路径都有测试覆盖。
- migration runner 使用 versioned registry，覆盖幂等执行和 foreign key 检查。
- 自动备份 manifest 记录 schema version，旧备份恢复会拒绝未来 schema，并保持现有自动备份 ZIP 兼容。
- 历史 SQLite fixture 矩阵来自真实版本结构，用于验证旧数据升级后的兼容性。

## AI 稳定性

- 复用历史聊天时只发送清理后的最近历史副本，不改写本地缓存或界面展示内容。
- AI chat 请求增加 role schema、消息数量、单条长度、总长度和 summary 输入长度边界。
- AI 汇总、快捷请求和聊天请求增加 stale-response guard，避免导航、清空历史、切换请求或状态变化后，旧响应覆盖当前内容。

## 内部工程改进

- 数据库访问拆分为 settings、subjects、templates、entries、attachments、tags / entry_tags、pomodoro、study tasks 和 mistakes repositories。
- `electron/database.ts` 继续作为兼容 façade，负责 migration、backup、公开 API 兼容和跨模块副作用编排。
- repository 与 façade 层测试覆盖强化，确认原公开 API、SQL 行为、backup / restore 和 UI 消费路径保持兼容。
- 迁移相关测试稳定化，降低 legacy fixture 和 CI timeout 对发布验证的影响。

## 兼容性与已知边界

- 本版本不包含 Pomodoro 与 study task 绑定。
- 本版本不新增 `pomodoro_sessions.task_id`。
- 本版本不包含 AI 自动创建任务或直接写入数据库。
- 本版本不包含 Dashboard 任务闭环或 v2.0 产品闭环。
- AI 输出仍应作为学习建议参考，不能替代用户自己的复习判断。
