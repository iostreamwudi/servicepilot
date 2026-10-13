import InfoPage from "../info-page";

export default function PrivacyPage() {
  return <InfoPage eyebrow="ServicePilot / 数据说明" title="隐私与安全" description="ServicePilot 按企业工作空间隔离会话、工单、知识和审计数据，并记录关键操作以支持追溯。" sections={[
    { title: "数据范围", body: "系统可能处理客服会话、工单、知识引用、业务核验结果和操作审计信息。具体字段由企业配置和当前业务流程决定。" },
    { title: "访问控制", body: "工作空间和功能访问基于企业身份与角色权限。查看和修改权限分开管理，高风险操作会保留操作者、时间和结果。" },
    { title: "本地草稿", body: "回复草稿可能保存在当前浏览器本机，用于刷新或切换会话后恢复；本地草稿不会自动同步到其他设备或成员。" },
  ]} />;
}
