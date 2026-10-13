import InfoPage from "../info-page";

export default function TermsPage() {
  return <InfoPage eyebrow="ServicePilot / 服务说明" title="服务条款" description="ServicePilot 用于展示企业智能客服与工单协同流程。使用前请确认你已获得所在企业的访问授权。" sections={[
    { title: "授权使用", body: "你只能使用企业管理员授予的工作空间、工作台和数据权限。请勿共享账号、绕过权限或将生产数据用于未经批准的用途。" },
    { title: "AI 服务边界", body: "系统生成的建议需要结合企业知识和业务规则核验。退款、补偿、账户与地址变更等高风险操作必须遵循企业审批和人工确认流程。" },
    { title: "信息准确性", body: "工作台中的指标、示例和演示数据可能随环境而变化。对外承诺前，请以当前生效知识、工单事实和企业政策为准。" },
  ]} />;
}
