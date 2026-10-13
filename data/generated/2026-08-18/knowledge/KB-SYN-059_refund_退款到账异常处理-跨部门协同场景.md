---
id: KB-SYN-059
category: refund
title: 退款到账异常处理-跨部门协同场景
version: v1.0
owner_team: 售后服务组
source_type: generated-internal-review
risk: high
handoff: true
effective_from: 2026-08-18
effective_until: 2027-08-18
keywords: 退款、到账、异常
scenario_variant: 跨部门协同场景
---

# 退款到账异常处理-跨部门协同场景

## 适用范围
青屿商城客服 Agent 与一线客服工作台测试租户。

## 规则正文
超过约定工作日未到账时，核对退款单号、支付渠道和更新时间并创建工单，不得猜测资金状态。本补充资料聚焦跨部门协同场景：先核对会话中的必要事实、订单或物流工具返回值；无法确认时只说明待核验事项并转交人工，不得用历史案例替代当前业务事实。

## 必要核验字段
订单号（如有）、用户身份脱敏标识、当前业务状态、最近更新时间和用户诉求。

## 操作边界
订单、退款和物流状态必须以业务工具返回结果为准；本文件不能替代业务查询。
