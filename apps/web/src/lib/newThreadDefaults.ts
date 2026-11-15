import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ModelSelection, RuntimeMode } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { resolveProjectDefaultProviderModelSelection } from "../providerInstances";
import { environmentPresentations } from "../state/presentation";
import { serverEnvironment } from "../state/server";

interface NewThreadDefaults {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
}

/** The model and mode a new thread in this project starts with, read when the thread is made. */
export function resolveNewThreadDefaults(
  project: Pick<EnvironmentProject, "environmentId" | "id"> &
    Parameters<typeof resolveProjectSettings>[2],
): NewThreadDefaults | null {
  const settings = appAtomRegistry.get(serverEnvironment.settingsValueAtom(project.environmentId));
  if (settings === null) return null;
  const projectSettings = resolveProjectSettings(settings, project.id, project).settings;
  const runtimeMode = projectSettings.defaultRuntimeMode;
  if (projectSettings.defaultModelSelection) {
    return { modelSelection: projectSettings.defaultModelSelection, runtimeMode };
  }
  const providersByEnvironment = appAtomRegistry.get(
    environmentPresentations.providersByEnvironmentAtom,
  );
  const providers = providersByEnvironment.get(project.environmentId);
  if (providers === undefined) return null;
  const modelSelection = resolveProjectDefaultProviderModelSelection(
    providers,
    settings,
    project.id,
  );
  if (modelSelection === null) return null;
  return { modelSelection, runtimeMode };
}
