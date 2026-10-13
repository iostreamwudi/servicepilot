# ServicePilot 真实客服评测集数据卡

## 用途与构成

规模层新增 1,060 条公开真实匿名客服样本：从 CSDS 官方训练集确定性分层抽取 960 条回归样本（四类各 240 条），从官方验证集冻结 100 条盲测样本（四类各 25 条）。该层仅评估意图来源和转人工策略，不逐条调用大模型，以控制成本并支持频繁回归。`router-v2.0-scale-1` 的联合通过率为 76.89%，其中 801 条独立问句为 87.89%，259 条上下文依赖样本为 42.86%；结果如实暴露了多轮指代与知识边界问题。

端到端层继续使用 100 条 qwen-plus 回归集和 55 条冻结盲测/安全门禁，评估知识引用、回答内容、转人工和禁止内容。两层指标不能混用：规模路由通过率不代表大模型答案准确率。

2026-08-24新增100条完整Agent泛化集`1.0-csds-train-new-agent100`，从用户提供的CSDS训练集确定性分层抽取，退款、发票、地址、破损各25条，保证100个不同`DialogueID`，其中24条需要上下文。它排除了既有端到端回归和盲测对话，但可能与早期只测路由的规模分析重叠；因此称为“新完整Agent数据”，不称为从未被任何分析观察的数据。冻结指纹为`bc7faf1a8169a5f525b32a34b0c3ceadb47d586025008fed4b4b5df8e4d6dd4e`。

Step 8.9另在实现前冻结第二批留出集`1.0-csds-train-holdout2-agent100`：四类各25条、100个独立`DialogueID`、23条上下文样本，与首批泛化集对话零重叠，指纹`832b4e91c419ff19e88148a98e19205cac6e34befb65d7c39befdcdc0e281656`。首次Step 8.9运行完成后该集合即转为已观察留出集，后续不得继续把它称为盲测，也不得据其失败题面修改Step 8.9后再重复宣称泛化提升。

Step 8.10在实现前冻结第三批留出集`1.0-csds-train-holdout3-agent100`：四类各25条、100个全局唯一`DialogueID`、32条上下文样本，排除前述端到端集合和前两批新数据对话，指纹`612abf2cc546941fd982cf3d025a439527b6e27902890824a75fa3f6facf3fec`。抽样器增加跨类别全局对话去重；本批完成A/B后已转为已观察数据，不得再用于宣称盲测泛化。

ServicePilot Eval v1.0 共 100 条：85 条由 CSDS 官方测试集确定性分层抽取，15 条为项目自建的安全、对抗、隐私和边界种子。该数据集用于私有研发评测，不用于训练、画像或对真实消费者作决策。

另设冻结盲测集 40 条，来自此前未参与开发和调参的 CSDS 官方验证集，退款、发票、地址修改、商品破损各 10 条，其中 10 条依赖上下文。盲测集与 15 条安全门禁共同运行；每个系统版本只允许完成一次，避免反复测试后将盲测集变成调参集。冻结样本指纹为 `85e9282c5b079ba24ee953e23bce4b750ea72eb73b57868ae864a6e08a495a3a`。

真实子集覆盖退款 25 条、发票 20 条、修改地址 20 条、商品破损 20 条；其中 21 条需要结合上下文判断意图。每条样本保存数据集名、原始 `DialogueID`、原始意图、关键问句编号、处理方式与最多 4 轮已脱敏历史，因此能够从结果追溯到公开数据源。

## 来源与真实性

- 上游：[CSDS 官方仓库](https://github.com/xiaolinAndy/CSDS)，固定版本 `1421348842ae3041574cc85fea21e15c3a2106cb`。
- 论文：[CSDS: A Fine-grained Chinese Dataset for Customer Service Dialogue Summarization](https://aclanthology.org/2021.emnlp-main.365/)。论文说明 CSDS 从 JDDC 的真实电商售前与售后客服对话构建，个人信息已匿名化。
- 采集日期：2026-07-20；回归集使用官方 `test.json`，盲测集使用此前未观察的官方 `val.json`。

这里的“真实”指公开论文声明的真实业务对话来源，不表示 ServicePilot 获得了平台生产流量或代表全部线上分布。

## 构建方法

脚本 `scripts/build-csds-eval.mjs` 从人工标注问句及其原始关键话语中筛选四类业务意图，以 `DialogueID + QA 序号 + 问句` 的 SHA-256 排序执行确定性分层抽样。处理包括去分词空格、平台名泛化、二次敏感信息替换、完全重复问句去重，并保留最多 4 轮前文。

运行方式：

```bash
node scripts/build-csds-eval.mjs /path/to/csds/test.json data/eval-csds-real.json
node scripts/select-csds-generalization.mjs data/eval-csds-full-train.json data/eval-csds-generalization-100.json data/eval-csds-real.json data/eval-csds-blind.json
node scripts/select-csds-generalization.mjs data/eval-csds-full-train.json data/eval-csds-holdout2-100.json --seed=servicepilot-holdout2-v1 --version=1.0-csds-train-holdout2-agent100 data/eval-csds-real.json data/eval-csds-blind.json data/eval-csds-generalization-100.json
node scripts/select-csds-generalization.mjs data/eval-csds-full-train.json data/eval-csds-holdout3-100.json --seed=servicepilot-holdout3-v1 --version=1.0-csds-train-holdout3-agent100 data/eval-csds-real.json data/eval-csds-blind.json data/eval-csds-generalization-100.json data/eval-csds-holdout2-100.json
```

## 隐私与质量检查

- 上游占位符（如 `[电话]`、`[地址]`、`[身份证号]`）原样保留。
- 构建脚本对问句和上下文扫描中国大陆手机号、18 位身份证号与邮箱；当前直接标识符命中数为 0。
- 不尝试重新识别用户，不访问登录态、私有页面或非公开个人数据。
- 85 条样本 ID 唯一，配额与输出内容可由同一上游版本复现。
- 新泛化集100条样本ID和`DialogueID`均唯一，四类各25条；输出由SHA-256排序脚本复现并由冻结指纹校验。

## 评分与限制

自动评分检查知识来源、是否转人工、必要内容和禁止内容。它不是人工满意度，也不能证明生产可用性。关键词筛选会偏向四个已建设知识域；转人工期望由公开文本与项目安全策略生成，仍需业务专家抽检。真实对话的语气、省略和上下文依赖会主动暴露当前检索及策略缺口，不应通过修改标签来抬高分数。

新泛化集没有安全、隐私或对抗合成种子，因此不能用它单独计算高风险安全通过率。部分原始CSDS意图标签与当前问句语义可能冲突，父子知识的自动金标也可能过严；所有失败需先做证据审计，不得直接按题面增加特例。

CSDS 仓库未声明明确的数据许可证，因此派生子集不对外再分发，默认仅限私有研究与评测；如需商业发布或开放数据，必须先取得数据权利方书面许可并完成法务审查。
