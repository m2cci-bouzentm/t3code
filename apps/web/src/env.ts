// Preload installs desktopBridge before web code runs, so module-load detection is reliable.
export const isElectron = typeof window !== "undefined" && window.desktopBridge !== undefined;

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(display-mode: standalone)").matches;
}

export const isInstalledApp = isElectron || isStandaloneDisplayMode();

export const isSecretsFeatureEnabled = ["1", "true"].includes(
  import.meta.env.T3CODE_FEATURE_SECRETS?.trim().toLowerCase() ?? "",
);
