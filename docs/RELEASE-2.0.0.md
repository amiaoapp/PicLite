# PicLite 图轻 v2.0.0

- 修复空悬浮窗缩小时内部区域被截断的问题，中心区域随窗口伸缩，小尺寸下底部按钮仍完整可用。
- 修复悬浮窗添加水印把 GIF / 动态 WebP 变成静态图片的问题，改为原生逐帧添加水印。
- 开启鼠标穿透后降低悬浮窗不透明度，并关闭背景模糊，方便查看后方内容。
- 空悬浮窗的折叠按钮固定显示。
- 新增 `piclite --mcp`，智能体可直接检查、压缩、转换和缩放图片及动图；提供 Streamable HTTP 桥接与 Claude、Hermes、WorkBuddy、ChatGPT 的接入说明，详见 docs/MCP.md。

MCP 协议及文件操作使用官方 SDK 实测；第三方客户端连接需要对应客户端的 MCP 支持。ChatGPT 需要可访问的 HTTP 服务或 Secure MCP Tunnel 与账户权限。

验证：原生回归 75 项通过（1 项既有忽略），前端回归 10 项通过，TypeScript 和 ESLint 无错误。macOS 原生应用实测折叠、展开、穿透及 GIF 水印；实测水印结果保留 217 帧。官方 MCP SDK 对本地 Release 二进制完成 stdio 和 HTTP 实测。各平台安装包由 CI 构建，并执行原生回归与 MCP 实测。
