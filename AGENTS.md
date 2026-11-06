# PicLite development

When changing a shared capability or fixing a bug, check the desktop app, web app, Docker deployment and MCP entry points together. Update every affected implementation and verify the behavior through each affected entry point. Prefer shared logic and keep presets, exported pixels and API behavior consistent. Do not assume a UI fix also fixes MCP.

Clipboard fixes must preserve the existing compression mechanism and logic. Do not change encoders, quality parameters, compression presets, candidate selection, resizing or target-size strategies to fix copying or floating-window state. Copy the finished output bytes without re-encoding them. Treat the compression core as protected unless the user explicitly authorizes a change to it.
