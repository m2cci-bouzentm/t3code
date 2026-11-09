// Preload installs desktopBridge before web code runs, so module-load detection is reliable.
export const isElectron = typeof window !== "undefined" && window.desktopBridge !== undefined;

export const isInstalledApp =
  isElectron ||
  (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches);

export const isSecretsFeatureEnabled = ["1", "true"].includes(
  import.meta.env.T3CODE_FEATURE_SECRETS?.trim().toLowerCase() ?? "",
);
