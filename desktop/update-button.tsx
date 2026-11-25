import { useState } from "react";
import type { DesktopUpdateBridge, UpdateInfo, UpdateProgress } from "./update-types";

export function UpdateButton({ api, info, t, onError, className }: {
  api: DesktopUpdateBridge;
  info: UpdateInfo;
  t: (zh: string, en: string) => string;
  onError: (message: string) => void;
  className?: string;
}) {
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [failed, setFailed] = useState(false);

  async function install() {
    setFailed(false);
    if (info.inApp) setProgress({ stage: "downloading", percent: null });
    try {
      if (info.inApp) await api.installUpdate(setProgress);
      else await api.openExternal(info.releaseUrl);
    } catch (error) {
      setProgress(null);
      setFailed(true);
      const detail = error instanceof Error ? error.message : String(error);
      onError(t(`更新失败：${detail}`, `Update failed: ${detail}`));
    }
  }

  let label = info.inApp ? t("更新并重启", "Update and restart") : t("下载更新包", "Download update");
  if (failed) label = t("重试更新", "Retry update");
  if (progress?.stage === "installing") label = t("正在安装并重启…", "Installing and restarting…");
  if (progress?.stage === "downloading") {
    const percent = progress.percent == null ? "" : ` ${progress.percent}%`;
    label = t(`正在下载${percent}…`, `Downloading${percent}…`);
  }
  return <button className={className} type="button" disabled={!!progress} aria-busy={!!progress} aria-live="polite" onClick={() => void install()}>{label}</button>;
}
