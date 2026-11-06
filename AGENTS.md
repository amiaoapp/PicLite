# PicLite development

When changing a shared capability or fixing a bug, check the desktop app, web app, Docker deployment and MCP entry points together. Update every affected implementation and verify the behavior through each affected entry point. Prefer shared logic and keep presets, exported pixels and API behavior consistent. Do not assume a UI fix also fixes MCP.
