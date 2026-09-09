import "./tauri-bridge";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("PicLite renderer root is missing");

const floatingWindow = ["dropzone", "preferences"].includes(window.picLite?.windowLabel || "main");

async function mount() {
  if (floatingWindow) {
    const [{ PicLiteDesktopApp }] = await Promise.all([
      import("./clop-desktop-app"),
      import("./clop-desktop.css"),
    ]);
    createRoot(root!).render(<PicLiteDesktopApp />);
    return;
  }
  const { startSavedWatchTasks } = await import("./watcher-runtime");
  startSavedWatchTasks(window.picLite as unknown as import("./clop-types").PicLiteBridge);
  const [{ PicLiteApp }] = await Promise.all([
    import("../app/piclite-app"),
    import("../app/globals.css"),
  ]);
  createRoot(root!).render(<PicLiteApp />);
}

void mount();
