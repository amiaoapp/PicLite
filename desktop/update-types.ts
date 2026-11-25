export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  releaseUrl: string;
  inApp: boolean;
};

export type UpdateProgress =
  | { stage: "downloading"; percent: number | null }
  | { stage: "installing" };

export type DesktopUpdateBridge = {
  checkForUpdates: () => Promise<UpdateInfo>;
  installUpdate: (onProgress: (progress: UpdateProgress) => void) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
};
