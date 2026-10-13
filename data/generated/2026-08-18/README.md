# ServicePilot 生成资料包

生成时间：2026-08-18
数据性质：结构真实、内容为合成评审数据；尚未写入 D1，也不代表真实企业事实。
用途：导入测试租户前的人工检查、导入链路验证和 Agent 评测。

- knowledge：500 份带元数据的知识 Markdown 文件（25 份核心政策 + 每份 19 个场景补充）
- business：3000 条订单、1500 条退款、1500 条物流、1200 条会员记录
- governance：工单、SLA、高风险规则
- users：100 个测试账号定义，邮箱使用 example.invalid
- evaluation：1000 条多轮 Agent 验收样本

入库时必须标记 sourceType=generated-internal-review、isSynthetic=true；测试验收通过后不能复制到生产租户。
