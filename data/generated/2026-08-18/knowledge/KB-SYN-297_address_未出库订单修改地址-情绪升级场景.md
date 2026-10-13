---
id: KB-SYN-297
category: address
title: 未出库订单修改地址-情绪升级场景
version: v1.0
owner_team: 售后服务组
source_type: generated-internal-review
risk: medium
handoff: false
effective_from: 2026-08-18
effective_until: 2027-08-18
keywords: 改地址、未出库
scenario_variant: 情绪升级场景
---

# 未出库订单修改地址-情绪升级场景

## 适用范围
青屿商城客服 Agent 与一线客服工作台测试租户。

## 规则正文
订单未出库时，核验订单与收件人信息后可以尝试修改地址，结果以系统状态为准。本补充资料聚焦情绪升级场景：先核对会话中的必要事实、订单或物流工具返回值；无法确认时只说明待核验事项并转交人工，不得用历史案例替代当前业务事实。

## 必要核验字段
订单号（如有）、用户身份脱敏标识、当前业务状态、最近更新时间和用户诉求。

## 操作边界
订单、退款和物流状态必须以业务工具返回结果为准；本文件不能替代业务查询。
