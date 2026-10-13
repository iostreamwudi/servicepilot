---
id: KB-SYN-329
category: address
title: 收件信息安全核验-部分商品场景
version: v1.0
owner_team: 售后服务组
source_type: generated-internal-review
risk: high
handoff: true
effective_from: 2026-08-18
effective_until: 2027-08-18
keywords: 收件人、身份核验
scenario_variant: 部分商品场景
---

# 收件信息安全核验-部分商品场景

## 适用范围
青屿商城客服 Agent 与一线客服工作台测试租户。

## 规则正文
地址变更使用脱敏信息核验，不索要完整身份证号或银行卡号。本补充资料聚焦部分商品场景：先核对会话中的必要事实、订单或物流工具返回值；无法确认时只说明待核验事项并转交人工，不得用历史案例替代当前业务事实。

## 必要核验字段
订单号（如有）、用户身份脱敏标识、当前业务状态、最近更新时间和用户诉求。

## 操作边界
订单、退款和物流状态必须以业务工具返回结果为准；本文件不能替代业务查询。
