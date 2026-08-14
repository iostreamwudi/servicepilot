from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.style import WD_STYLE_TYPE
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "docs" / "ServicePilot_PRD_v1.0.docx"

BLUE = RGBColor(46, 116, 181)
DARK = RGBColor(31, 77, 120)
INK = RGBColor(11, 37, 69)
MUTED = RGBColor(89, 99, 110)
LIGHT = "F2F4F7"
CALLOUT = "E8EEF5"
WHITE = RGBColor(255, 255, 255)
PAGE_WIDTH_DXA = 9360

CN_FONT = "SimHei"

def set_font(run, size=11, bold=None, color=None, name=CN_FONT):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:ascii"), name)
    run._element.rPr.rFonts.set(qn("w:hAnsi"), name)
    run._element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)
    run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color

def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)

def cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = tcPr.first_child_found_in("w:tcMar")
    if tcMar is None:
        tcMar = OxmlElement("w:tcMar")
        tcPr.append(tcMar)
    for side, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tcMar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tcMar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")

def set_cell_width(cell, width):
    tcPr = cell._tc.get_or_add_tcPr()
    tcW = tcPr.find(qn("w:tcW"))
    if tcW is None:
        tcW = OxmlElement("w:tcW")
        tcPr.append(tcW)
    tcW.set(qn("w:w"), str(width))
    tcW.set(qn("w:type"), "dxa")

def set_table_geometry(table, widths):
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    tblPr = table._tbl.tblPr
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.append(tblW)
    tblW.set(qn("w:w"), str(sum(widths)))
    tblW.set(qn("w:type"), "dxa")
    tblInd = tblPr.find(qn("w:tblInd"))
    if tblInd is None:
        tblInd = OxmlElement("w:tblInd")
        tblPr.append(tblInd)
    tblInd.set(qn("w:w"), "120")
    tblInd.set(qn("w:type"), "dxa")
    grid = table._tbl.tblGrid
    for grid_col, width in zip(grid.gridCol_lst, widths):
        grid_col.set(qn("w:w"), str(width))
    for row in table.rows:
        for cell, width in zip(row.cells, widths):
            set_cell_width(cell, width)
            cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

def set_repeat_table_header(row):
    trPr = row._tr.get_or_add_trPr()
    tblHeader = OxmlElement("w:tblHeader")
    tblHeader.set(qn("w:val"), "true")
    trPr.append(tblHeader)

def prevent_row_split(row):
    trPr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    cant_split.set(qn("w:val"), "true")
    trPr.append(cant_split)

def set_paragraph(p, before=0, after=6, line=1.10, align=None):
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    if align is not None:
        p.alignment = align

def add_para(doc, text="", style=None, before=0, after=6, bold_prefix=None, color=None, size=None):
    p = doc.add_paragraph(style=style)
    set_paragraph(p, before, after)
    if bold_prefix and text.startswith(bold_prefix):
        first = p.add_run(bold_prefix)
        set_font(first, size or 11, True, color)
        rest = p.add_run(text[len(bold_prefix):])
        set_font(rest, size or 11, False, color)
    else:
        run = p.add_run(text)
        set_font(run, size or 11, None, color)
    return p

def add_bullet(doc, text, level=0):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Inches(0.5 + level * 0.25)
    p.paragraph_format.first_line_indent = Inches(-0.25)
    set_paragraph(p, 0, 5, 1.12)
    set_font(p.add_run(text), 10.5)
    return p

def add_number(doc, text):
    p = doc.add_paragraph(style="List Number")
    p.paragraph_format.left_indent = Inches(0.5)
    p.paragraph_format.first_line_indent = Inches(-0.25)
    set_paragraph(p, 0, 5, 1.12)
    set_font(p.add_run(text), 10.5)
    return p

def add_heading(doc, text, level=1):
    style = f"Heading {level}"
    p = doc.add_paragraph(style=style)
    p.add_run(text)
    return p

def write_cell(cell, text, bold=False, color=None, size=9.5):
    cell.text = ""
    p = cell.paragraphs[0]
    set_paragraph(p, 0, 0, 1.05)
    run = p.add_run(text)
    set_font(run, size, bold, color)

def add_table(doc, headers, rows, widths):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    set_table_geometry(table, widths)
    hdr = table.rows[0]
    set_repeat_table_header(hdr)
    prevent_row_split(hdr)
    for cell, header in zip(hdr.cells, headers):
        shade(cell, LIGHT)
        write_cell(cell, header, bold=True, color=INK, size=9)
    for row_values in rows:
        row = table.add_row()
        prevent_row_split(row)
        cells = row.cells
        for cell, value in zip(cells, row_values):
            write_cell(cell, value, size=9)
    doc.add_paragraph().paragraph_format.space_after = Pt(3)
    return table

def add_callout(doc, label, text):
    table = doc.add_table(rows=1, cols=2)
    set_repeat_table_header(table.rows[0])
    prevent_row_split(table.rows[0])
    table.style = "Table Grid"
    set_table_geometry(table, [1320, 8040])
    shade(table.cell(0, 0), "1F4D78")
    shade(table.cell(0, 1), CALLOUT)
    write_cell(table.cell(0, 0), label, bold=True, color=WHITE, size=9)
    write_cell(table.cell(0, 1), text, size=10)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def add_metadata(doc):
    rows = [
        ("文档状态", "V1.0 - 当前原型基线"),
        ("产品", "ServicePilot 企业智能服务运营平台"),
        ("文档负责人", "产品负责人（待指定）"),
        ("适用范围", "青屿商城生产空间 + ServicePilot 沙箱"),
        ("最后更新", "2026-08-14"),
        ("维护规则", "每次功能范围、角色权限、指标或发布逻辑变更后同步更新本 PRD。"),
    ]
    for label, value in rows:
        p = doc.add_paragraph()
        set_paragraph(p, 0, 2, 1.05)
        set_font(p.add_run(label + "："), 10, True, INK)
        set_font(p.add_run(value), 10, False, MUTED)

def setup(doc):
    section = doc.sections[0]
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = CN_FONT
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.10
    for style_name, size, color, before, after in [
        ("Heading 1", 16, BLUE, 16, 8),
        ("Heading 2", 13, BLUE, 12, 6),
        ("Heading 3", 12, DARK, 8, 4),
    ]:
        s = styles[style_name]
        s.font.name = CN_FONT
        s._element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)
        s.font.size = Pt(size)
        s.font.color.rgb = color
        s.font.bold = True
        s.paragraph_format.space_before = Pt(before)
        s.paragraph_format.space_after = Pt(after)
        s.paragraph_format.keep_with_next = True
    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_paragraph(header, 0, 0, 1.0)
    set_font(header.add_run("SERVICEPILOT | 产品需求文档"), 8.5, True, MUTED)
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_paragraph(footer, 0, 0, 1.0)
    set_font(footer.add_run("内部工作稿 | 2026-08-14"), 8.5, False, MUTED)

def main():
    doc = Document()
    setup(doc)
    # Cover / masthead
    p = doc.add_paragraph()
    set_paragraph(p, 18, 4, 1.0)
    set_font(p.add_run("PRODUCT REQUIREMENTS DOCUMENT"), 10, True, BLUE)
    p = doc.add_paragraph()
    set_paragraph(p, 0, 4, 1.0)
    set_font(p.add_run("ServicePilot 企业智能服务运营平台"), 24, True, INK)
    p = doc.add_paragraph()
    set_paragraph(p, 0, 16, 1.1)
    set_font(p.add_run("角色工作台、可信知识治理与 Agent 服务闭环"), 14, False, MUTED)
    add_metadata(doc)
    add_callout(doc, "定位", "面向企业内部服务团队的 AI 服务运营平台：让每一次 Agent 回答都具备可信依据、明确边界、可追溯反馈和可控发布。")
    add_heading(doc, "阅读说明", 2)
    add_para(doc, "本 PRD 以当前已部署原型为基线，既记录现有能力，也定义下一阶段可上线产品需要满足的要求。界面中的演示数值仅用于说明信息架构与评测方式，不应被视为真实经营数据。", after=8)
    add_para(doc, "[Assumption] 当前尚未完成正式用户研究与真实生产埋点校验；所有目标值在试点前须由业务、数据和合规负责人确认。", after=4, color=MUTED)
    doc.add_page_break()

    add_heading(doc, "1. 执行摘要", 1)
    add_para(doc, "ServicePilot 用于连接消费者咨询、企业知识、AI Agent、人工客服与治理流程。它解决的不是单一聊天机器人问题，而是企业在规模化使用生成式 AI 时常见的三类断裂：回答缺少依据、人工接管缺少上下文、优化没有闭环。产品以角色工作台组织工作：一线客服完成服务交付，主管控制风险与 SLA，知识运营维护可信内容，AI 运营改进模型与策略，系统管理员控制权限和审计。")
    add_callout(doc, "本期决策", "先以“问答 - 知识 - 评测 - 发布”闭环为核心，优先完善知识运营与 AI 运营；消费者端仅作为真实问答输入和服务结果验证，不作为后台主用户。")

    add_heading(doc, "2. 背景与问题定义", 1)
    add_heading(doc, "2.1 目标用户的问题", 2)
    for item in [
        "一线客服：接管 AI 失败或高风险会话时，往往需要反复查订单、规则和历史，用户被迫重复描述。",
        "服务主管：难以及时发现 SLA 风险、知识错误和 AI 失败之间的关联，调度依赖人工经验。",
        "知识运营：业务资料分散、版本冲突、责任不清，发布后无法证明回答是否真的改善。",
        "AI 运营：无法快速判断失败来自意图识别、检索、知识、策略还是模型回答，优化容易只看单点指标。",
        "企业治理方：需要控制谁能修改策略、查看敏感数据、发布知识，以及在出错时追溯完整链路。",
    ]:
        add_bullet(doc, item)
    add_heading(doc, "2.2 当前原型证据与限制", 2)
    add_para(doc, "原型已实现角色登录选择、会话与工单协作、已发布知识引用、知识运营的测试/复核/灰度流程、质检评测、策略配置、权限与审计页面。当前工作台指标和部分审批状态为演示交互，尚不代表真实后端审批、策略发布或生产数据写回。")
    add_para(doc, "[Open Question] 需要在试点前补充访谈、日志和业务指标，验证各角色的实际高频任务、决策权限与目标阈值。", color=MUTED)

    add_heading(doc, "3. 产品目标、范围与非目标", 1)
    add_heading(doc, "3.1 产品目标", 2)
    for item in [
        "让 Agent 的回答可追溯到已批准知识，并能识别不可自动处理的边界。",
        "让人工客服在接管时获得完整上下文、可核验事实与可编辑建议。",
        "让知识和策略变更必须经过测试、审批和可回退的发布流程。",
        "让运营人员从失败案例回溯到知识、策略或服务流程，并形成可量化改进闭环。",
    ]:
        add_bullet(doc, item)
    add_heading(doc, "3.2 本期范围", 2)
    for item in [
        "企业登录、工作空间隔离、授权工作台选择与角色切换。",
        "一线客服会话接管、上下文核验、AI 协助、工单协同、结案与知识引用。",
        "服务主管运营总览、风险优先级、SLA 关注与跨角色协同入口。",
        "知识运营工作队列、资产库、来源导入、冲突识别、回答验证、双人复核与灰度发布原型。",
        "AI 运营质检评测、失败复核、策略中心、效果与成本分析。",
        "系统管理员资源权限、安全审计和策略治理界面。",
    ]:
        add_bullet(doc, item)
    add_heading(doc, "3.3 非目标", 2)
    for item in [
        "不在本期直接替代订单、支付、物流、CRM 或工单底层系统。",
        "不允许 Agent 无审批执行退款、赔付、账户或地址等高风险业务动作。",
        "不在本期建设面向消费者的独立后台；消费者端仅承担问答输入和体验验证。",
        "不将演示用测试、复核、灰度按钮描述为已持久化的企业审批系统。",
    ]:
        add_bullet(doc, item)

    add_heading(doc, "4. 用户、角色与权限模型", 1)
    add_para(doc, "消费者是服务对象，不是本产品后台主用户。其咨询、凭证、满意度和追问构成改进闭环的输入。以下内部角色根据登录时的授权进入不同工作台。")
    add_table(doc,
        ["角色", "核心目标", "当前工作台与操作", "边界"],
        [
            ["一线客服", "安全、高效地解决需要人工介入的问题", "会话接管；查看订单/用户/AI 摘要；采用或编辑建议回复；建单、升级、结案；查询并引用生效知识", "不可编辑知识、发布策略或绕过审批执行高风险业务动作"],
            ["服务主管", "控制服务质量、SLA 与高风险事项", "运营总览；风险排序；工单分配/催办；查看服务趋势与跨角色协作记录", "不直接替代知识或模型负责人进行内容/策略发布"],
            ["知识运营", "把可信资料变为可验证的 Agent 知识", "缺口/冲突/复核队列；资产库；来源导入；内容边界；真实问法测试；双人复核；灰度发布", "不决定模型路由；业务与合规审批不能被单人绕过"],
            ["AI 运营", "提高识别、检索、回答和路由质量", "质检评测；失败复核；知识关联；策略配置；质量、成本与时延分析", "不替代业务方定义规则，也不直接处理用户会话"],
            ["系统管理员", "保障权限、审计与生产变更可控", "资源权限；安全审计；策略治理；权限冲突与到期复核", "不拥有业务规则内容的最终解释权"],
        ], [1200, 1800, 4200, 2160])
    add_para(doc, "[Open Question] 业务规则负责人和合规审批人已在双人复核流程中出现，但尚未作为独立登录工作台实现；正式上线前需要明确其权限和审批责任。", color=MUTED)

    add_heading(doc, "5. 端到端业务闭环", 1)
    add_number(doc, "消费者发起咨询，Agent 识别意图、检索可信知识、执行风险校验并生成回答。")
    add_number(doc, "低置信度、高风险、需要身份核验或无法承诺的场景转交一线客服，并保留会话摘要、事实和知识版本。")
    add_number(doc, "一线客服处理、建单、升级或结案；其对建议、摘要和知识的反馈进入质检与治理队列。")
    add_number(doc, "服务主管按 SLA、风险和业务影响调度资源，并推动跨角色问题处理。")
    add_number(doc, "知识运营修复缺口与冲突；AI 运营定位评测失败并调整检索、模型或策略。")
    add_number(doc, "经过测试、双人复核和灰度观察后发布；管理员对权限和审计链路进行治理。")
    add_callout(doc, "闭环原则", "任何知识或策略变更都必须可定位来源、可验证回答、可审批发布、可观察影响、可回退。")

    add_heading(doc, "6. 解决方案与功能需求", 1)
    add_heading(doc, "6.1 登录、空间与角色工作台", 2)
    add_table(doc, ["编号", "需求", "优先级", "验收标准"], [
        ["FR-01", "用户登录后选择企业空间，再选择已授权工作台；可记住选择并从账号菜单切换。", "P0", "仅显示该空间的授权角色；切换角色后首页、导航和数据入口随角色变化；无授权角色不可进入。"],
        ["FR-02", "每个角色首页展示其目标、优先任务、关键指标和高频入口。", "P0", "一线客服、主管、知识运营、AI 运营、管理员看到不同待办与导航；任务按影响/风险/时限组织。"],
        ["FR-03", "企业空间之间数据和授权隔离。", "P0", "切换空间后，当前角色必须重新校验授权；界面明确展示空间与环境。"],
    ], [850, 3700, 700, 4110])
    add_heading(doc, "6.2 一线客服工作台", 2)
    add_table(doc, ["编号", "需求", "优先级", "验收标准"], [
        ["FR-10", "以待接管、处理中、等待内部、已解决组织会话队列。", "P0", "客服可筛选状态并查看剩余 SLA、风险、情绪、来源渠道和交接原因。"],
        ["FR-11", "会话详情展示客户消息、AI 摘要、已核验事实、订单/用户上下文和脱敏提示。", "P0", "事实必须标识来源；客服可反馈摘要不准确；敏感字段不得完整暴露。"],
        ["FR-12", "AI 生成带知识依据的推荐回复，并支持人工采用、编辑或反馈无帮助。", "P0", "建议显示知识依据；采用后进入回复框；高风险场景明确提示不能自动承诺。"],
        ["FR-13", "客服可创建/跟进工单、升级主管并结构化结案。", "P0", "结案要求选择结果，确认用户已解决后才能关闭；结案记录可进入 SLA 与质检。"],
        ["FR-14", "客服只可查询和引用已发布知识。", "P0", "搜索结果仅返回 active 知识；引用时记录知识编号与版本；无编辑、审核、发布入口。"],
    ], [850, 3700, 700, 4110])
    add_heading(doc, "6.3 知识运营工作台", 2)
    add_table(doc, ["编号", "需求", "优先级", "验收标准"], [
        ["FR-20", "按受影响会话、风险和到期时间排序知识缺口、口径冲突、待复核和即将过期任务。", "P0", "工作队列可定位关联知识与任务来源；默认优先处理高影响高风险项。"],
        ["FR-21", "知识资产包含客服可引用内容、场景、责任团队、风险、接管策略、来源、版本和状态。", "P0", "编辑仅保存草稿，不影响线上；来源可追溯；冲突被显式标记。"],
        ["FR-22", "导入官方政策、内部规范或 FAQ，系统生成候选知识和冲突提示。", "P1", "导入不能绕过人工审核直接发布；显示来源身份、预计片段数和潜在冲突。"],
        ["FR-23", "使用真实用户问法完成召回、边界和转人工验证。", "P0", "测试通过前“提交双人复核”不可用；结果展示命中知识、边界与接管检查。"],
        ["FR-24", "通过业务与合规双人复核后进行灰度发布，并可回退线上版本。", "P0", "发布状态区分草稿/复核中/灰度中；展示流量比例与回退能力。"],
    ], [850, 3700, 700, 4110])
    add_heading(doc, "6.4 AI 运营与策略中心", 2)
    add_table(doc, ["编号", "需求", "优先级", "验收标准"], [
        ["FR-30", "提供全量评测、回归、盲测和人工复核队列。", "P0", "评测结果能按识别、检索、回答、策略等维度定位失败；人工结论保留原始样本和复核信息。"],
        ["FR-31", "失败案例可回流知识、策略或数据治理工作项。", "P0", "运营人员能明确标记失败归因；不允许直接覆盖原始标注，审批后形成新版本。"],
        ["FR-32", "策略中心配置低置信度兜底、高风险转人工、上下文继承和模型路由。", "P0", "生产策略发布前显示检查项和双人审批状态；高风险策略默认不允许自动承诺。"],
        ["FR-33", "数据分析联动服务、质量、成本和时延指标。", "P1", "支持会话解决漏斗和质量 x 成本观察；数据口径需可追溯。"],
    ], [850, 3700, 700, 4110])
    add_heading(doc, "6.5 服务主管与系统治理", 2)
    add_table(doc, ["编号", "需求", "优先级", "验收标准"], [
        ["FR-40", "服务主管查看运营总览、风险、SLA、工单和跨角色动态。", "P0", "高风险、即将超时、未分配事项可直接跳转到处理入口。"],
        ["FR-41", "系统管理员管理资源权限、审计链路和策略审批。", "P0", "记录敏感操作、权限变更和高风险拦截；可发现权限冲突与到期复核。"],
        ["FR-42", "安全要求包括脱敏、最小权限、敏感操作人工确认和可审计性。", "P0", "界面和接口均不得以 Agent 自动执行方式绕过身份核验或审批。"],
    ], [850, 3700, 700, 4110])

    add_heading(doc, "7. 数据、集成与非功能要求", 1)
    add_heading(doc, "7.1 核心数据对象", 2)
    add_table(doc, ["对象", "关键字段/关系", "治理要求"], [
        ["会话", "客户、渠道、意图、风险、SLA、历史、AI 回答、交接状态", "保留交接上下文；敏感字段脱敏；可关联工单与知识版本。"],
        ["知识", "编号、版本、内容、来源、责任团队、风险、有效期、状态、覆盖率", "来源可追溯；版本可回退；生效状态决定是否可被客服/Agent 引用。"],
        ["评测样本", "问题、标签、期望、模型输出、归因、复核结论", "保留原始样本与变更历史；不得由单人直接覆盖金标。"],
        ["策略", "路由规则、阈值、模型、风险动作、审批、版本", "生产变更必须审批、记录生效范围并支持回退。"],
        ["审计事件", "主体、动作、资源、时间、结果、上下文", "覆盖权限、策略、知识和高风险业务操作。"],
    ], [1600, 4300, 3460])
    add_heading(doc, "7.2 外部依赖", 2)
    for item in [
        "订单、支付、物流、会员和工单系统提供可核验事实与业务动作状态。",
        "知识来源系统或文件库提供政策、SOP、FAQ 与来源快照。",
        "大模型、向量检索、意图识别和路由服务提供 Agent 能力。",
        "统一身份认证、权限系统、日志与监控平台提供企业治理能力。",
    ]:
        add_bullet(doc, item)
    add_heading(doc, "7.3 非功能与安全要求", 2)
    for item in [
        "可用性：生产核心会话与知识查询应具备监控、告警和降级方案。",
        "可追溯：每次回答应记录使用的知识、策略和模型版本。",
        "权限：按空间、角色和资源最小授权；角色切换不自动扩大权限。",
        "隐私：PII 默认脱敏；敏感操作需要身份核验与人工确认。",
        "可回退：知识和策略均需要保留线上版本、变更记录和回退路径。",
    ]:
        add_bullet(doc, item)

    add_heading(doc, "8. 成功指标与埋点", 1)
    add_para(doc, "指标分为结果、质量、效率和安全四层。当前页面展示的数值是原型样例，正式目标值应在试点基线采集后确定。")
    add_table(doc, ["层级", "指标", "拟衡量的问题", "目标/阈值"], [
        ["北极星", "可信闭环解决率", "用户问题在有依据、无越权的前提下被解决的比例", "[Assumption] 试点后定义基线与提升目标"],
        ["服务结果", "72 小时未重开率、满意度、SLA 达标率", "人工与 AI 共同交付是否真正解决问题", "不低于现有人工服务基线"],
        ["AI 质量", "可信引用率、知识命中率、低置信度率、误转人工率", "回答是否有依据、是否正确选择自动/人工处理", "高风险误放行必须为 0"],
        ["知识治理", "知识缺口数、冲突处理时长、复核及时率、发布后改善幅度", "知识团队是否有效减少真实会话问题", "按业务类目定义 SLA"],
        ["效率/成本", "平均响应时延、单会话成本、建议采纳率", "质量提升是否以可接受成本实现", "不以降低安全为代价"],
        ["安全", "PII 脱敏覆盖、高风险拦截、越权访问、审计完整率", "企业级治理是否有效", "高风险自动执行为 0"],
    ], [1200, 2200, 3500, 2460])
    add_heading(doc, "8.1 建议埋点事件", 2)
    for item in [
        "会话：agent_answer_generated、agent_handoff_triggered、agent_answer_adopted、conversation_closed、conversation_reopened。",
        "知识：knowledge_gap_created、knowledge_test_passed、knowledge_review_submitted、knowledge_published、knowledge_rolled_back。",
        "评测/策略：evaluation_run_finished、failure_root_cause_marked、strategy_review_submitted、strategy_published。",
        "治理：permission_changed、sensitive_operation_blocked、audit_event_viewed。",
    ]:
        add_bullet(doc, item)

    add_heading(doc, "9. 发布、验收与风险", 1)
    add_heading(doc, "9.1 发布策略", 2)
    add_number(doc, "先在沙箱空间完成角色、权限、知识、策略和审计链路测试。")
    add_number(doc, "选择一个业务类目在生产空间灰度，限定知识与策略生效流量。")
    add_number(doc, "监控可信引用、风险转人工、投诉、SLA、人工反馈与成本。")
    add_number(doc, "达到指标和双人审批要求后扩大流量；发现高风险异常立即回退至上一版本。")
    add_heading(doc, "9.2 主要风险与缓解", 2)
    add_table(doc, ["风险", "影响", "缓解方案"], [
        ["知识口径错误或过期", "错误回答、投诉、合规风险", "来源、责任人、有效期、冲突检测、测试门禁、双人复核和回退。"],
        ["模型幻觉或越权承诺", "资金、赔付、账户等高风险事故", "高风险规则强制转人工；回答附依据；策略审批与审计。"],
        ["角色权限设计过宽", "敏感数据泄露或非授权发布", "空间隔离、最小权限、权限到期复核、审计追踪。"],
        ["只优化模型分数而忽略业务结果", "用户体验与成本恶化", "使用可信闭环解决率及服务/安全护栏指标共同评估。"],
        ["演示交互被误认为生产流程", "错误预期和治理缺失", "在上线计划中明确后端持久化、审批、通知和回退依赖。"],
    ], [2200, 2700, 4460])

    add_heading(doc, "10. 开放问题与后续路线", 1)
    for item in [
        "[Open Question] 业务规则负责人、合规审批人的独立工作台、审批时限和替代人机制如何设计？",
        "[Open Question] 当前知识测试的真实样本集、金标维护机制、通过阈值和盲测规则如何确定？",
        "[Open Question] 多租户隔离、数据保留期限、导出权限与审计保留策略如何满足目标行业合规要求？",
        "[Open Question] Agent API 的模型供应商、故障降级、成本预算与观测标准如何确定？",
        "下一优先级：完成 AI 运营工作台的“失败归因 - 任务回流 - 策略评测 - 审批发布”真实闭环。",
        "后续迭代：将知识运营的原型状态接入后端持久化审批、真实灰度流量控制和可审计回退。",
    ]:
        add_bullet(doc, item)
    add_heading(doc, "11. PRD 维护与变更记录", 1)
    add_para(doc, "本文件是产品、设计、研发、数据、业务和合规协作的单一需求基线。每次修改系统时，产品负责人应先判断是否影响角色、流程、权限、指标、范围、依赖或风险；如影响，则在同一次变更中更新本 PRD 的相应章节、版本和变更记录。")
    add_table(doc, ["版本", "日期", "变更摘要", "状态"], [
        ["V1.0", "2026-08-14", "基于当前 ServicePilot 原型建立完整产品基线；纳入角色工作台和知识运营闭环。", "已创建"],
    ], [1200, 1500, 5160, 1500])
    add_heading(doc, "12. 参考模板与来源", 1)
    add_para(doc, "PRD 结构参考成熟企业协作模板的通用做法：在同一文档中维护目标、成功指标、假设、用户故事、范围、开放问题和支持材料，并把 PRD 作为持续更新的协作基线。")
    for source in [
        "Atlassian Confluence, Product requirements document (PRD) template: https://www.atlassian.com/software/confluence/templates/product-requirements",
        "Atlassian Agile Product Management, How to create a PRD: https://www.atlassian.com/agile/product-management/requirements/",
        "ServicePilot 当前代码与已部署原型（角色工作台、会话、工单、知识运营、质检、策略、权限与审计）。",
    ]:
        add_bullet(doc, source)

    doc.core_properties.title = "ServicePilot 产品需求文档（PRD）"
    doc.core_properties.subject = "企业智能服务运营平台产品基线"
    doc.core_properties.author = "ServicePilot 产品团队"
    doc.core_properties.comments = "Living PRD - update with every product change"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT)
    print(OUT)

if __name__ == "__main__":
    main()
