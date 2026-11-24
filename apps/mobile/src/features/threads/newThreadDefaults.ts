import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import {
  buildModelOptions,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
} from "../../lib/modelOptions";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentServerConfigsAtom } from "../../state/server";

/**
 * The model and mode a thread made without a composer starts with, read when it is made: the
 * new-task defaults of its project. Null when the environment has no config or no usable model.
 */
export function resolveNewThreadDefaults(project: EnvironmentProject) {
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(project.environmentId);
  if (config === undefined) return null;
  const projectSettings = resolveProjectSettings(config.settings, project.id, project).settings;
  const modelSelection = resolveNewTaskModelSelection({
    draftSelection: null,
    projectDefaultSelection: resolveDefaultableModelSelection(
      config,
      projectSettings.defaultModelSelection,
      project.id,
    ),
    stickySelection: null,
    modelOptions: buildModelOptions(config, null, undefined, project.id),
  });
  if (modelSelection === null) return null;
  return { modelSelection, runtimeMode: projectSettings.defaultRuntimeMode };
}
