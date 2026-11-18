## PicLite 图轻 v2.1.7

- 新增 Docker 远程 MCP 服务，云端 Agent 无需安装桌面客户端即可检查图片、压缩、格式转换和制作封面。提供独立的 `ghcr.io/amiaoapp/piclite-mcp` 镜像，支持 amd64 / arm64，复用 PicLite 原生 Rust 压缩引擎。
- Docker MCP 使用 Streamable HTTP，启用时必须设置 Bearer Token；默认仅绑定服务器本机 `127.0.0.1:3210`。源图片只读挂载到 `input/`，结果写入独立的 `output/job-*`，并限制请求大小、批次数量与工作目录访问。部署方式见 [MCP 文档](https://github.com/amiaoapp/PicLite/blob/main/docs/MCP.md#docker-远程-mcp)。
- 悬浮窗统一使用展开结果视图，移除展开 / 堆叠切换按钮。
- 菜单栏增加临时暂停 / 恢复剪贴板检测，并可配置为悬浮窗操作按钮；临时暂停不覆盖持久设置。
- 剪贴板设置新增 Office 来源排除，并支持添加其他应用，避免复制 Excel、OneNote 等内容时自动触发图片处理。
- 修复 macOS 登录时启动状态检查及失效注册恢复，应用处于临时转移目录时提示先安装到应用程序文件夹。
- 调整悬浮窗底部打开主窗口和清空内容的图标，使其更符合对应操作。

本次未修改压缩编码器、画质、预设、候选比较、缩放或目标体积策略。桌面、网页、Docker 和 MCP 使用同一发布源码；网页镜像与远程 MCP 镜像分别运行，MCP 默认不启用。

Windows x64 / ARM64：EXE、MSI、便携 ZIP；macOS Apple Silicon / Intel：DMG；Linux x64 / ARM64：AppImage、DEB。
