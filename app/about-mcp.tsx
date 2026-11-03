import "./about-mcp.css";

export const MCP_GUIDE_URL = "https://github.com/amiaoapp/PicLite/blob/main/docs/MCP.md";

export function AboutMcp({ language, openGuide }: { language: "zh" | "en"; openGuide: () => void }) {
  const zh = language === "zh";
  return <section className="about-mcp" aria-label={zh ? "MCP / AI 接入" : "MCP / AI integration"}>
    <h3>{zh ? "MCP / AI 接入" : "MCP / AI integration"}</h3>
    <p>{zh
      ? "桌面版内置 MCP 服务，让支持 MCP 的 AI 客户端调用图片检查、批量压缩、缩放和封面制作。"
      : "The desktop app includes an MCP server so compatible AI clients can inspect images, batch compress, resize and create covers."}</p>
    <p>{zh
      ? "可通过 stdio 连接 Claude、Hermes、WorkBuddy 等支持 MCP 的客户端；ChatGPT 接入需配置桥接，具体方式见接入指南。"
      : "Connect compatible clients such as Claude, Hermes and WorkBuddy over stdio. ChatGPT requires a bridge; see the setup guide for details."}</p>
    <button className="about-mcp-guide" type="button" onClick={openGuide}>{zh ? "查看 MCP 接入指南" : "MCP setup guide"}<span aria-hidden="true">↗</span></button>
  </section>;
}
