import Link from "next/link";

type InfoSection = { title: string; body: string };

export default function InfoPage({ eyebrow, title, description, sections }: { eyebrow: string; title: string; description: string; sections: InfoSection[] }) {
  return <main className="info-page">
    <Link className="info-brand" href="/"><img className="servicepilot-mark" src="/servicepilot-mark.png" alt="" aria-hidden="true" /><span>ServicePilot</span></Link>
    <article className="info-card">
      <span className="info-eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p className="info-lead">{description}</p>
      <div className="info-sections">{sections.map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.body}</p></section>)}</div>
      <footer><Link className="info-primary" href="/">返回 ServicePilot</Link><span>当前为产品演示环境，正式企业政策以管理员发布版本为准。</span></footer>
    </article>
  </main>;
}
