# 图片格式与 SVG

以下说明对应当前源码，已发布版本以安装包实际功能为准。

## SVG 压缩

将 `.svg` 拖入工作台或桌面悬浮窗，保持原格式即可优化。SVG 始终保持矢量，不会因为自动方案而转成位图。优化仅精简 XML、普通注释，以及开启「移除元数据」时的 metadata；保留版权注释、ID、viewBox、路径精度、CSS、渐变、蒙版与动画元素。

尺寸缩放通过 SVG 的 width / height 和 viewBox 完成。工作台会显示真实输出尺寸，并禁用不适用的位图质量、快速方案和目标体积控件，支持一键明确切换为 WebP。SVG 缩小画布不会减少图形元素，因此尺寸变化后体积可能基本不变。质量滑块不降低 SVG 路径精度；目标体积仅对位图编码生效，SVG 不会为满足体积而栅格化。需要水印时请先明确选择 PNG / WebP 等位图输出。

在格式转换中选择 PNG、WebP、JPEG 等即可将 SVG 渲染为位图。渲染器不读取外部图片文件或网络资源；使用外链图片的 SVG 应先嵌入资源。SVG 动画转位图得到静态画面；要保留动画，请保持 SVG。

## 格式转换

桌面、网页、Docker 和 MCP 共用以下输出范围：

| 格式 | 说明 |
| --- | --- |
| JPEG / JFIF | 照片与兼容场景；不支持透明通道。JFIF 使用 JPEG 编码，文件扩展名为 .jfif |
| PNG / WebP / AVIF | 常用网页图片格式，支持透明通道 |
| GIF | 支持静态图片和动态 WebP 转 GIF |
| BMP / TIFF | 位图与交换格式 |
| ICO | 最大 256×256，超出时等比缩小 |
| QOI / TGA | 支持透明通道的图片交换格式 |
| PPM / PAM | PPM 为 RGB；PAM 保留透明通道 |
| SVG → SVG | 优化已有矢量图；不提供位图描摹，也不把 PNG 包装进 SVG 冒充矢量 |

网页与 Docker 的转换工具新增 AVIF、JFIF、GIF、BMP、TIFF、ICO、QOI、TGA、PPM、PAM、SVG。新解码器支持 TIFF、ICO、QOI、TGA、PPM、PAM 的导入与预览。新增格式用独立 Worker 本地处理，60 秒超时会终止该任务。ImageMagick WASM 约 15.5 MB（gzip 约 5.5 MB），首次处理需要它的格式时加载；无需上传图片。

动态 WebP 可转为 GIF，保留各帧、播放时长和循环次数。桌面、MCP 和 Docker MCP 使用同一转换逻辑；网页及 Docker 的网页界面需要支持 WebCodecs 图像解码的浏览器（如 Chrome、Edge）。已有压缩方案继续使用原有的编码和目标体积策略。

## 开源选型

调研时间：2026-11-17。Star 数仅作为维护与采用情况的参考，同时检查了版本、许可证和实际反馈。

| 项目 | 约 Star 数 | 采用方式 |
| --- | ---: | --- |
| [SVGO](https://github.com/svg/svgo) | 22,800 | 浏览器 SVG 优化，固定 4.1.0；仅启用保守插件，不使用默认的路径重写与数值取整 |
| [resvg](https://github.com/linebender/resvg) | 4,200 | Rust 桌面与 MCP 的 SVG 渲染与透明预览；浏览器使用自身 SVG 图像渲染器 |
| [ImageMagick](https://github.com/ImageMagick/ImageMagick) | 17,900 | 浏览器新增格式转换，使用 [magick-wasm](https://github.com/dlemstra/magick-wasm) 0.0.46；不替换原有常用格式压缩流程 |
| [OXVG](https://github.com/noahbald/oxvg) | 640 | Rust SVG 优化，固定 0.0.9；提供与浏览器相同的保守优化范围，无需给桌面 / MCP 用户附带 Node.js |
| [Sharp](https://github.com/lovell/sharp) | 32,900 | 已评估，未引入；Node 原生运行环境与浏览器 / Tauri 的跨端要求不匹配 |
| [Squoosh](https://github.com/GoogleChromeLabs/squoosh) | 26,200 | 已评估，未替换现有栅格压缩器 |

SVGO 最近曾有[路径转换改变形状](https://github.com/svg/svgo/issues/2319)和[复杂多边形长时间占用 CPU](https://github.com/svg/svgo/issues/2299)的反馈，因此不启用路径重写、形状转换、ID 清理等激进步骤。浏览器与原生优化器不保证输出 XML 字节完全相同，但保留矢量的规则一致，并分别验证实际渲染像素、尺寸、透明度与元数据开关。

## 验证

- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：包含 SVG 精简前后像素一致、渐变 / 蒙版 / ID、缩放、版权注释、元数据和输出解码测试。
- Vite 根目录服务打开 `tests/fixtures/image-formats.html`：浏览器真实 Worker、SVG 像素对比，以及全部位图输出的回读、尺寸、透明度与预览验证。
- `node tests/mcp-smoke.mjs`：通过官方 MCP SDK 检查 stdio / HTTP、SVG 压缩与转换和原图保护。
- 桌面、Web standalone 和 Pages 均需构建，确认 Worker 和 WASM 资源已进入相应构建产物。

## 悬浮窗与剪贴板

桌面设置 → 剪贴板 → **自动复制压缩结果到剪贴板**，默认关闭。开启后，悬浮窗与批量窗口将完成的输出交给现有原生复制接口，不重新编码；批量只复制最后一张成功结果。预览加载、浏览旧结果和打开开关都不会复制已有图片；复制失败单独提示，不影响压缩状态。文件夹监测和主工作台不受此开关影响，网页、Docker 和 MCP 不执行桌面剪贴板自动化。

Windows 悬浮窗使用单层 SVG alpha 遮罩统一裁剪图片、背景与悬停控件，随窗口尺寸重新计算，保留圆角像素的抗锯齿透明度。macOS 保留原生裁剪。浏览器回归覆盖 100%、125%、150%、200% 比例，但 Windows 原生 WebView2 仍需 Windows 机器复核。

浏览器集成页还包括 `tests/fixtures/floating-behavior.html`（真实 React 悬浮窗 + 桥接 mock，验证预览挂起时仍完成复制、默认关闭、批量和边缘 alpha）与 `tests/fixtures/workbench-formats.html`（主工作台文件导入、SVG 优化及 SVG → PNG）。
