import InfoPage from "../info-page";

export default function HelpPage() {
  return <InfoPage eyebrow="ServicePilot / 快速帮助" title="帮助中心" description="第一次使用时，可以按“登录 → 选择空间 → 进入工作台 → 处理会话”的顺序开始。" sections={[
    { title: "找不到工作空间", body: "确认使用企业邮箱登录。如果仍然看不到空间，请联系企业管理员申请访问；管理员会决定你的角色和可用工作台。" },
    { title: "实时数据加载失败", body: "先点击错误提示旁的“重试”。如果问题持续，页面会保留当前可用功能；请把发生时间和页面名称提供给企业管理员。" },
    { title: "需要处理什么", body: "客服工作台会优先展示待接管、即将超时和等待内部协作的事项。进入会话后先核验事实，再使用当前生效知识生成或编辑回复。" },
  ]} />;
}
