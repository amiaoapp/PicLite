# PicLite 图轻 v1.6.0

- 批量重命名调整为默认内置插件，支持任意深度父目录提取：`【1-1】→0101`、中文词、英文词、英文首字母；支持预览和冲突保护。
- 新增独立保存的多目录监控任务：每个目录可设置不同格式、尺寸、压缩及命名规则，重启后自动恢复。
- 支持仅处理格式或尺寸不符合要求的新图片，保留原图；等待写入稳定并防止生成图片循环处理。
- 文件夹监控完成后显示系统通知（可在任务内关闭）及悬浮结果。
- 补齐 JFIF 导入、压缩、转换、监控和重命名支持。
- 新增 Windows x64 / ARM64 便携 ZIP，解压即用，数据保存在旁边的 PicLite-Data 文件夹；需要 WebView2 Runtime。

下载：Windows 安装包或 portable.zip；macOS Apple Silicon / Intel DMG；Linux x64 / ARM64 AppImage / DEB。

使用说明见 README。macOS 为 ad-hoc 签名；系统通知受系统权限与通知设置影响。
