import InfoPage from "../../info-page";

export default function PermissionsHelpPage() {
  return <InfoPage eyebrow="ServicePilot / 权限说明" title="查看我的权限" description="当前工作空间只会展示你被授权的工作台和数据范围。权限变更由企业管理员审核并留下审计记录。" sections={[
    { title: "当前可用范围", body: "一线客服通常可以处理会话、查看工单和查询已发布知识；是否能修改状态、分配工单或执行高风险动作，取决于企业角色配置。" },
    { title: "权限冲突", body: "直接配置会覆盖继承配置，但查看和修改权限仍然分开。遇到无法执行的动作时，请联系管理员，不要尝试绕过限制。" },
    { title: "申请变更", body: "请向企业管理员说明需要访问的工作空间、功能和业务理由。管理员完成审核后，重新登录或刷新工作台即可读取最新授权。" },
  ]} />;
}
