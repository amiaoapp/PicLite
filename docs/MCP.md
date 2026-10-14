# PicLite MCP

PicLite 2.0 内置本地 MCP 服务，复用桌面压缩引擎，无需打开界面、无需 API Key。服务不会自动启动。

## 本地智能体（Claude、Hermes、WorkBuddy 等）

在客户端的 MCP 配置中添加一个 stdio 服务，command 指向已安装的 PicLite 可执行文件，args 为 `["--mcp"]`。配置结构以各客户端版本为准：

```json
{"mcpServers":{"piclite":{"command":"/Applications/PicLite.app/Contents/MacOS/piclite","args":["--mcp"]}}}
```

Windows command 指向安装目录的 `piclite.exe` 或便携版 `PicLite.exe`；Linux 指向 PicLite 二进制。Windows 使用标准流启动，禁止通过图形界面双击 `--mcp`。

工具：
- `piclite_compress`：paths 为绝对路径数组，支持 quality（1–100）、scale（0.1–100）、format（keep/image/webp/image/png/image/jpeg/image/avif）、outputDirectory、targetSizeKb。默认原目录另存，源文件不会被覆盖。
- `piclite_inspect`：path 为图片路径，返回尺寸、字节数、格式、帧数和动画状态。

示例请求：“用 PicLite 把 /绝对路径/demo.gif 缩到 50%，输出动态 WebP，然后检查它是否仍是动画。”

客户端必须支持 stdio MCP，并能访问这些本地文件。未在每个第三方客户端账户中逐一登录测试；已用官方 MCP SDK 实测协议与真实文件操作。

## HTTP / ChatGPT

源码仓库安装 Node.js 22+ 并执行 `npm ci` 后：

```sh
PICLITE_BINARY=/Applications/PicLite.app/Contents/MacOS/piclite npm run mcp:http
```

默认地址 `http://127.0.0.1:3210/mcp`，仅监听本机；可设置 `PICLITE_MCP_PORT`。`PICLITE_MCP_TOKEN` 可设置 Bearer Token。

ChatGPT 的云端不能直接访问本机回环地址。在支持的工作区中使用 [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 将 stdio 服务或上述 HTTP 服务连接到 ChatGPT，再在自定义 MCP 连接中选择 Tunnel。需要工作区开发者模式及 Platform Tunnel 权限。这些权限与账户设置由用户完成；PicLite 不会自动开放公网或写入客户端配置。也可自行部署带认证的 HTTPS 反向代理后按 [官方接入指南](https://developers.openai.com/plugins/build/app-quickstart) 配置远程 MCP。

## 验证

```sh
cargo build --manifest-path src-tauri/Cargo.toml
node tests/mcp-smoke.mjs
```

测试使用官方 SDK 连接真实二进制，覆盖 stdio / Streamable HTTP 的初始化、工具列表、GIF→动态 WebP、缩放、动图帧检查、参数错误和源文件保留。
