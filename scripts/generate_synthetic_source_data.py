from __future__ import annotations

import csv
import json
import random
import shutil
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "data" / "generated" / "2026-08-18"
random.seed(20260818)

# 千级测试资料规模：保留 25 份可人工审核的知识文档，业务事实扩展到
# 千级以上，且通过稳定的外键关系生成，便于后续导入 D1 和压测检索/工具链路。
ORDER_COUNT = 3000
REFUND_COUNT = 1500
SHIPMENT_COUNT = 1500
CUSTOMER_COUNT = 1200
USER_COUNT = 100
EVALUATION_COUNT = 1000
KNOWLEDGE_VARIANTS_PER_DOC = 19
KNOWLEDGE_VARIANT_NAMES = [
    "新客场景", "老客复购场景", "高峰期场景", "跨区域场景", "偏远地区场景",
    "节假日场景", "大促活动场景", "部分商品场景", "多商品订单场景", "礼品订单场景",
    "企业客户场景", "会员权益场景", "异常复核场景", "证据不足场景", "重复咨询场景",
    "情绪升级场景", "超时未处理场景", "跨部门协同场景", "夜间服务场景",
]

def text(path: Path, value: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value.strip() + "\n", encoding="utf-8")

def csv_file(path: Path, rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

def stamp(days: int, hour: int = 10) -> str:
    return (datetime(2026, 8, 18, hour, 20) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")

DOCS = [
    ("refund", "退款申请受理条件", "退款、申请、条件", "medium", False, "退款申请需要核验订单、退款原因和售后期限；缺少信息时只能追问，不能承诺退款。"),
    ("refund", "退款审核与处理时效", "退款、审核、时效", "medium", False, "普通退款通常在1个工作日内完成审核；通过后按支付渠道原路退回，到账时间以渠道结果为准。"),
    ("refund", "退款到账异常处理", "退款、到账、异常", "high", True, "超过约定工作日未到账时，核对退款单号、支付渠道和更新时间并创建工单，不得猜测资金状态。"),
    ("refund", "订单取消与优惠权益退回", "取消订单、优惠券、退回", "medium", False, "取消订单后，符合活动规则且未核销的优惠权益按原规则退回；过期或已核销权益按活动条款解释。"),
    ("refund", "已完成订单的售后期限", "完成订单、售后、期限", "high", True, "已完成订单是否仍可售后，需要结合商品类别、签收时间、凭证和适用规则判断。"),
    ("refund", "退款金额核对规范", "退款金额、核对", "high", True, "退款金额以订单实付、优惠分摊和已完成售后结果为依据，不能按用户口述确认。"),
    ("refund", "部分退款处理规范", "部分退款、多件商品", "high", True, "部分退款需要核对商品明细、数量、优惠分摊和物流状态，再由售后复核。"),
    ("refund", "退款拒绝与申诉处理", "退款拒绝、申诉、复核", "high", True, "退款被拒绝时说明可核对的原因和补充材料；用户提出异议时创建复核工单，不得在未核验前承诺改判。"),
    ("damage", "生鲜商品破损赔付标准", "生鲜、破损、赔付", "high", True, "保留商品、外包装、面单和照片；赔付方式和金额结合订单、凭证与责任核验确认。"),
    ("damage", "普通商品外观破损处理", "外观破损、照片", "high", True, "拍摄外包装和商品细节照片，核对物流节点与签收时间后创建售后任务。"),
    ("damage", "商品缺件与配件短少", "缺件、少件、配件", "high", True, "核对订单明细、包裹数量和装箱记录，再确认补发、退款或其他处理方式。"),
    ("damage", "质量故障与维修处理", "质量、故障、维修", "high", True, "核验购买时间、故障现象、序列信息和厂商政策，不能直接承诺免费维修或换新。"),
    ("damage", "三包责任核验边界", "三包、包修、包换", "high", True, "结合商品类别、购买时间、故障原因和维修记录判断，不能把统一期限套用到所有商品。"),
    ("damage", "破损凭证补充要求", "凭证、照片、补充", "medium", False, "凭证不清晰时只请求必要补充，不要求用户重复描述已经保存的事实。"),
    ("address", "未出库订单修改地址", "改地址、未出库", "medium", False, "订单未出库时，核验订单与收件人信息后可以尝试修改地址，结果以系统状态为准。"),
    ("address", "已出库订单地址变更", "已出库、改址、物流", "high", True, "已出库订单不能直接承诺改址成功，需核对承运商和物流节点后创建人工任务。"),
    ("address", "收件信息安全核验", "收件人、身份核验", "high", True, "地址变更使用脱敏信息核验，不索要完整身份证号或银行卡号。"),
    ("address", "物流异常与丢件调查", "丢件、物流异常", "high", True, "核对承运商、最后节点和签收信息后发起调查，调查完成前不承诺赔偿。"),
    ("address", "拒收与退回处理", "拒收、退回", "medium", True, "等待承运商回传退回节点并核对商品状态，再决定退款或重新配送方案。"),
    ("address", "配送时效解释规范", "配送周期、时效", "low", False, "根据地区、承运商和轨迹提供预计范围，不能承诺精确到达时间。"),
    ("invoice", "电子发票申请条件", "电子发票、申请", "low", False, "订单完成并满足开票条件后，可以在订单详情申请电子发票。"),
    ("invoice", "发票抬头与税号修改", "发票、抬头、税号", "medium", False, "未开具发票可申请修改；已开具发票需核对红冲或作废重开流程。"),
    ("invoice", "发票红冲与重开", "红冲、重开、发票", "high", True, "财税特殊情况只解释已发布流程，提交财税运营复核，不直接承诺结果。"),
    ("invoice", "发票下载与发送", "发票下载、发送", "low", False, "生成后可在订单详情下载；失败时记录状态并提交技术工单。"),
    ("invoice", "企业发票信息核验", "企业发票、公司名称", "medium", True, "企业抬头和税号以提交信息及发票系统校验结果为准。"),
]

def main():
    if ROOT.exists():
        shutil.rmtree(ROOT)
    manifest = []
    knowledge_number = 0
    knowledge_docs = []
    for category, title, keywords, risk, handoff, body in DOCS:
        knowledge_docs.append((category, title, keywords, risk, handoff, body, "核心政策"))
        for variant in range(1, KNOWLEDGE_VARIANTS_PER_DOC + 1):
            variant_name = KNOWLEDGE_VARIANT_NAMES[variant - 1]
            variant_body = (
                f"{body}本补充资料聚焦{variant_name}：先核对会话中的必要事实、订单或物流工具返回值；"
                "无法确认时只说明待核验事项并转交人工，不得用历史案例替代当前业务事实。"
            )
            knowledge_docs.append((category, f"{title}-{variant_name}", keywords, risk, handoff, variant_body, variant_name))

    for category, title, keywords, risk, handoff, body, variant_name in knowledge_docs:
        knowledge_number += 1
        doc_id = f"KB-SYN-{knowledge_number:03d}"
        filename = f"{doc_id}_{category}_{title}.md"
        manifest.append({"id": doc_id, "category": category, "title": title, "version": "v1.0", "risk": risk, "handoff": handoff, "keywords": keywords.split("、"), "filename": filename})
        meta = ["---", f"id: {doc_id}", f"category: {category}", f"title: {title}", "version: v1.0", "owner_team: 售后服务组", "source_type: generated-internal-review", f"risk: {risk}", f"handoff: {str(handoff).lower()}", "effective_from: 2026-08-18", "effective_until: 2027-08-18", f"keywords: {keywords}", f"scenario_variant: {variant_name}", "---"]
        content = meta + ["", f"# {title}", "", "## 适用范围", "青屿商城客服 Agent 与一线客服工作台测试租户。", "", "## 规则正文", body, "", "## 必要核验字段", "订单号（如有）、用户身份脱敏标识、当前业务状态、最近更新时间和用户诉求。", "", "## 操作边界", "订单、退款和物流状态必须以业务工具返回结果为准；本文件不能替代业务查询。"]
        text(ROOT / "knowledge" / filename, "\n".join(content))
    text(ROOT / "knowledge_manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    # 同时生成可被应用构建产物导入的结构化载荷；Markdown 仍作为人工审阅原件保留。
    generated_payload = []
    for item in manifest:
        content = (ROOT / "knowledge" / item["filename"]).read_text(encoding="utf-8")
        generated_payload.append({**item, "content": content, "sourceType": "generated-internal-review", "sourceTitle": "ServicePilot 合成评审资料包", "state": "review", "coverage": 0, "ownerTeam": "售后服务组", "validFrom": "2026-08-18", "validUntil": "2027-08-18", "isSynthetic": True})
    text(ROOT / "generated-knowledge.json", json.dumps(generated_payload, ensure_ascii=False, indent=2))

    names = ["张三", "李娜", "王强", "赵敏", "陈晨", "刘洋", "周宁", "吴凡", "孙悦", "郑凯"]
    products = ["生鲜礼盒", "家用净水器", "无线耳机", "婴儿纸尿裤", "厨房收纳套装", "运动鞋", "办公椅", "护肤礼盒"]
    statuses = ["paid", "processing", "shipped", "delivered", "completed", "cancelled"]
    orders = [{"order_id": f"OR-SYN-{i:06d}", "customer_id": f"CU-SYN-{(i - 1) % CUSTOMER_COUNT + 1:06d}", "customer_name": names[(i - 1) % 10], "product_name": products[(i - 1) % len(products)], "order_status": statuses[(i - 1) % len(statuses)], "total_amount": f"{random.randint(59, 1299)}.{random.randint(0, 99):02d}", "payment_channel_masked": ["微信支付", "支付宝", "银行卡尾号****3812"][(i - 1) % 3], "created_at": stamp(i % 90, 9 + i % 8), "updated_at": stamp(i % 60, 10 + i % 8)} for i in range(1, ORDER_COUNT + 1)]
    csv_file(ROOT / "business" / "orders.csv", orders)
    refund_statuses = ["requested", "reviewing", "approved", "processing", "completed", "rejected", "failed"]
    refunds = [{"refund_id": f"RF-SYN-{i:06d}", "order_id": f"OR-SYN-{((i * 2 - 1) % ORDER_COUNT) + 1:06d}", "refund_status": (status := refund_statuses[(i - 1) % 7]), "refund_amount": f"{random.randint(39, 899)}.{random.randint(0, 99):02d}", "refund_reason": ["商品破损", "用户取消", "物流异常", "质量问题", "重复购买"][(i - 1) % 5], "approved_at": stamp(i % 60, 11) if status in {"approved", "processing", "completed"} else "", "expected_business_days": ["1-3", "3-5", "5-7"][(i - 1) % 3], "updated_at": stamp(i % 30, 14)} for i in range(1, REFUND_COUNT + 1)]
    csv_file(ROOT / "business" / "refunds.csv", refunds)
    ship_statuses = ["not_shipped", "shipped", "in_transit", "out_for_delivery", "delivered", "exception", "lost", "returned"]
    shipments = [{"shipment_id": f"SHP-SYN-{i:06d}", "order_id": f"OR-SYN-{((i * 3 - 1) % ORDER_COUNT) + 1:06d}", "shipment_status": (status := ship_statuses[(i - 1) % 8]), "carrier": ["顺丰", "中通", "京东物流", "圆通"][(i - 1) % 4], "tracking_number_masked": f"SF****{1000 + i:04d}", "shipped_at": stamp(i % 60, 12), "delivered_at": stamp(i % 50, 18) if status == "delivered" else "", "updated_at": stamp(i % 20, 16)} for i in range(1, SHIPMENT_COUNT + 1)]
    csv_file(ROOT / "business" / "shipments.csv", shipments)
    tiers = ["普通会员", "银卡会员", "金卡会员", "黑卡会员"]
    customers = [{"customer_id": f"CU-SYN-{i:06d}", "customer_name": names[(i - 1) % 10], "member_tier": tiers[(i - 1) % 4], "order_count": 1 + (i * 7) % 24, "lifetime_value": f"{300 + (i * 173) % 9800}.00", "updated_at": stamp(i % 45, 15)} for i in range(1, CUSTOMER_COUNT + 1)]
    csv_file(ROOT / "business" / "customer_profiles.csv", customers)
    users = [{"user_id": f"U-SYN-{i:04d}", "name": names[(i - 1) % 10], "email": f"agent{i}@example.invalid", "department": "售后服务组", "role": ["frontline_agent", "supervisor", "knowledge_operator", "ai_operator", "administrator"][i % 5], "skill_group": ["退款", "售后", "物流", "知识治理", "系统治理"][i % 5], "enabled": "true"} for i in range(1, USER_COUNT + 1)]
    csv_file(ROOT / "users" / "servicepilot_users.csv", users)

    text(ROOT / "governance" / "ticket_rules.md", "\n".join(["# 工单触发规则（生成评审资料）", "", "- P1：高风险赔付、金额争议、媒体曝光、账户安全、物流丢件调查。", "- P2：知识未命中、退款超过承诺时效、地址变更需要承运商确认。", "- P3：一般咨询、资料补充、低风险跟进。", "- Agent 只能创建或关联工单，不能代替客服完成资金、账户和地址变更。", "- 用户确认问题解决后才允许结案；结案后72小时内再次咨询自动重开。"]))
    text(ROOT / "governance" / "sla_rules.md", "\n".join(["# SLA 与升级规则（生成评审资料）", "", "| 优先级 | 首次响应 | 升级条件 |", "|---|---|---|", "| P1 | 30 分钟 | 10 分钟未领取或涉及高风险 |", "| P2 | 4 小时 | 超过 2 小时未处理 |", "| P3 | 1 个工作日 | 超过 8 小时未处理 |", "", "以上值仅用于测试租户验收，正式生产值需要业务负责人确认。"]))
    text(ROOT / "governance" / "risk_rules.md", "\n".join(["# 高风险处理边界（生成评审资料）", "", "- 不承诺确定退款到账日期。", "- 不在未核验订单时承诺赔付金额。", "- 不索要完整身份证号、银行卡号或账户密码。", "- 订单、退款和物流状态必须来自业务工具结果。", "- 知识未命中时可以自然追问，但不能生成确定性业务事实。"]))

    prompts = [("refund", "我的退款什么时候到账？", "引用退款到账规则并说明预计范围，不承诺具体日期"), ("damage", "收到的商品破损了怎么办？", "要求必要凭证并进入人工核验"), ("address", "订单已经发货还能改地址吗？", "查询物流节点，不直接承诺改址"), ("invoice", "发票抬头写错了怎么办？", "根据开票状态解释修改或红冲流程")]
    cases = [{"case_id": f"CASE-SYN-{i:05d}", "category": (p := prompts[(i - 1) % 4])[0], "source": "generated-internal-review", "user_message": p[1], "follow_up": ["能今天处理吗？", "我没有订单号怎么办？", "可以帮我查一下吗？"][(i - 1) % 3], "expected_behavior": p[2], "expected_handoff": "true" if p[0] in {"damage", "address"} else "false", "risk_level": "high" if p[0] in {"damage", "address"} else "medium"} for i in range(1, EVALUATION_COUNT + 1)]
    ROOT.joinpath("evaluation").mkdir(parents=True, exist_ok=True)
    with (ROOT / "evaluation" / "cases.jsonl").open("w", encoding="utf-8") as f:
        for case in cases:
            f.write(json.dumps(case, ensure_ascii=False) + "\n")
    text(ROOT / "README.md", "\n".join(["# ServicePilot 生成资料包", "", "生成时间：2026-08-18", "数据性质：结构真实、内容为合成评审数据；尚未写入 D1，也不代表真实企业事实。", "用途：导入测试租户前的人工检查、导入链路验证和 Agent 评测。", "", f"- knowledge：{len(knowledge_docs)} 份带元数据的知识 Markdown 文件（25 份核心政策 + 每份 {KNOWLEDGE_VARIANTS_PER_DOC} 个场景补充）", f"- business：{ORDER_COUNT} 条订单、{REFUND_COUNT} 条退款、{SHIPMENT_COUNT} 条物流、{CUSTOMER_COUNT} 条会员记录", "- governance：工单、SLA、高风险规则", f"- users：{USER_COUNT} 个测试账号定义，邮箱使用 example.invalid", f"- evaluation：{EVALUATION_COUNT} 条多轮 Agent 验收样本", "", "入库时必须标记 sourceType=generated-internal-review、isSynthetic=true；测试验收通过后不能复制到生产租户。"]))
    print(ROOT)
    print(f"knowledge={len(knowledge_docs)} orders={ORDER_COUNT} refunds={REFUND_COUNT} shipments={SHIPMENT_COUNT} customers={CUSTOMER_COUNT} users={USER_COUNT} evaluation={EVALUATION_COUNT}")

if __name__ == "__main__":
    main()
