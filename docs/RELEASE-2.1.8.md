## PicLite 图轻 v2.1.8

- 修复 Windows x64 / ARM64 发布任务：Windows Server 2025 无法启动 Cargo 生成的 Rust 测试执行文件时，改为编译测试目标，并继续用真实桌面应用的 WebView2 smoke test 验证运行。
- 修复 Windows 剪贴板来源检测的系统 API 解析，来源识别不可用时优雅回退，不阻止应用启动。
- 修复 Docker 多架构发布：网页与 MCP 镜像分别下载 amd64 / arm64 digest，避免交叉混入；仅由版本标签触发发布，避免 `main` 和标签任务相互取消。
- 保留 2.1.7 的功能：独立 Docker 远程 MCP 镜像、Bearer Token 认证、剪贴板临时暂停、Office 来源排除和 macOS 登录时启动修复。

压缩编码器、画质、预设、候选比较、缩放和目标体积策略未改变。桌面安装包覆盖 Windows x64 / ARM64、macOS Apple Silicon / Intel、Linux x64 / ARM64。
