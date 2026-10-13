/**
 * Declarative Router domain catalog.
 *
 * The routing algorithm should not encode the business taxonomy in its
 * control flow.  A domain is a retrieval-backed capability: it declares its
 * canonical key, default knowledge source and signal families.  The default
 * catalog preserves the existing four ServicePilot capabilities, while the
 * same algorithm can be supplied with another catalog by a tenant-specific
 * adapter in a future schema version.
 */

export type BusinessIntent = "refund" | "damage" | "address" | "invoice";

export type RouterIntentProfile = {
  intent: BusinessIntent;
  knowledgeId: string;
  strongPatterns: RegExp[];
  supportingPatterns: RegExp[];
  contextualPatterns: RegExp[];
};

export type RouterDomainCatalog = {
  profiles: readonly RouterIntentProfile[];
  knowledgeByIntent: Readonly<Record<BusinessIntent, string>>;
};

export const DEFAULT_ROUTER_DOMAIN_CATALOG: RouterDomainCatalog = {
  profiles: [
    {
      intent: "refund", knowledgeId: "KB-114",
      // 退货/取消订单/价保退差价是独立售后流程，不能仅因包含“退”就
      // 路由到资金退款；这里只准入退款去向、到账与退款状态。
      strongPatterns: [/退款|退钱|返款|反款|原路退|极速退款/, /款.*(没到|未到|不到账|退到)|钱.*没(到|来|返回|退)|多久到账|到帐|退.*(白条|银行卡|微信|支付宝|余额)/, /(退款|退回|返款|款项).*(少|差额|不全)|金额.*少|只退/],
      supportingPatterns: [/返还|退回|审核|工作日|支付方式|银行卡|白条|微信|余额/],
      contextualPatterns: [/退(到|回|给|了|吗|呢|哪|哪儿|哪里|多久|费)|回款|退费|返到|返款|到帐|到账|货款|款项|款退|款还|少退|全款|原支付账户|支付账户|银行卡.*(退|返)|微信.*(退|返)|余额.*(退|返)|白条.*(退|返)/, /(钱|款|退款|返款).*(返回到哪|去哪|去哪里|没看到|找不到|没收到)/],
    },
    {
      intent: "damage", knowledgeId: "KB-208",
      strongPatterns: [/破损|损坏|坏了|烂了|烂的|质量问题|少件|缺件|少了|少商品|少配件|漏液|漏发|发霉|不新鲜|变质|丢件|丢失|遗失|丢了|磕碰|异响|维修|返修|修理|保修|质保|三包|不能用|用不了|开不了机|没反应|充不进电|脱落|松动|断裂|掉落/, /包装.*(破|烂|压)|商品.*(破|坏|碎|漏)|收到.*(少|缺)|附件.*(少|没有|缺)|不能吃|融化|腐烂|全化|化了/, /售后.*(申请不了|无法申请|不能申请|办不了)|申请售后.*(失败|不了)|入仓.*少|少入|未发/],
      supportingPatterns: [/赔付|理赔|售后|换货|补发|维修|保修|三包/],
      contextualPatterns: [/裂痕|划痕|压烂|烂了|腐烂|发臭|发酸|发霉|变形|故障|不能用|用不了|开不了机|没反应|充不进电|缺少|漏发|没发|少了|不见了|遗失|噪音|异响|有问题|补发|换一个|维修|保修|三包|脱落|松动|断裂|线掉|屏幕.*松/],
    },
    {
      intent: "address", knowledgeId: "KB-301",
      strongPatterns: [/收货地址|收件地址|改址|收货信息|收件信息/, /(地址|街道|门牌号|收件信息|收货信息).*(错|改|修改|更改)|(修改|更改|改).*(地址|街道|门牌号|电话|号码|手机)|(电话|号码|手机).*(填错|写错|改)/],
      supportingPatterns: [/收件人|联系方式|寄到|送到/],
      contextualPatterns: [/(改|换|填错|写错).*(收件人|联系人|手机号|手机|电话|号码)|(收件人|联系人|手机号|手机|电话|号码).*(改|换|填错|写错)|转寄|改到|送错地方/],
    },
    {
      intent: "invoice", knowledgeId: "KB-401",
      strongPatterns: [/发票|开票|税号|发票抬头|专票|增票|电子票|带票/, /票.*(开|重开|作废)|公司名称.*(错|改)|报销.*凭证|什么时候.*开好|能开好|财务专用章|增值税.*章/],
      supportingPatterns: [/抬头|公司名称|报销|凭证/],
      contextualPatterns: [/普通票|电子票|纸质票|增值税|纳税人|识别号|抵税|报账|报销|开具|重开|补开|换开|作废|票据|票头|个人.*(换|改).*单位|公司抬头/],
    },
  ],
  knowledgeByIntent: { refund: "KB-114", damage: "KB-208", address: "KB-301", invoice: "KB-401" },
};

export function createRouterDomainCatalog(input: Partial<RouterDomainCatalog> = {}): RouterDomainCatalog {
  return {
    profiles: input.profiles ?? DEFAULT_ROUTER_DOMAIN_CATALOG.profiles,
    knowledgeByIntent: input.knowledgeByIntent ?? DEFAULT_ROUTER_DOMAIN_CATALOG.knowledgeByIntent,
  };
}
