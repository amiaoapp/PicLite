## PicLite 图轻 v2.1.6

- 新增 SVG 矢量压缩：清理冗余 XML、普通注释与可选元数据，保留路径精度、渐变、蒙版、CSS、ID 和动画元素。
- 扩展桌面、网页、Docker 与 MCP 格式转换：支持 WebP、JPEG、JFIF、PNG、AVIF、GIF、BMP、TIFF、ICO、QOI、TGA、PPM、PAM，以及 SVG → SVG。新增格式支持本地导入与兼容预览。
- 工作台显示 SVG 实际输出尺寸，禁用不适用的位图画质、快速方案和目标体积控件，并提供“转为 WebP 压缩”入口。SVG 缩放改变画布尺寸，文件体积可能基本不变；SVG 转位图得到静态画面。
- 在「设置 → 剪贴板」增加可用的“自动复制压缩结果到剪贴板”开关，默认关闭。悬浮窗与批量窗口处理后复制最终输出，批量复制最后一张成功图片；不依赖预览加载，不重复触发压缩。
- 调整 Windows 悬浮窗圆角，统一裁剪图片、背景与悬停遮罩，改善边缘毛刺及不同显示缩放下的圆角效果。
- MCP 新增 `piclite_convert` 工具，同步 SVG 检查、压缩、转换及封面输入支持；保留 SVG 时明确说明 quality / targetSizeKb 不适用。

现有 JPEG / PNG / WebP 等栅格压缩编码器、预设、质量、候选比较、缩放和目标体积策略保持不变。网页新增格式通过 Worker 在本地处理；首次加载 ImageMagick WASM 约 15.5 MB。网页动画跨格式转换暂提示使用桌面版，避免静默丢帧。

Windows x64 / ARM64：EXE、MSI、便携 ZIP；macOS Apple Silicon / Intel：DMG；Linux x64 / ARM64：AppImage、DEB。网页、Docker 与 MCP 使用同一发布源码；Docker 同步构建 amd64 / arm64 镜像。
