import {
  projectColorsByEnvironment,
  resolveThreadProjectColor,
} from "@t3tools/client-runtime/state/project-colors";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { View } from "react-native";

import { cn } from "../../lib/cn";
import { projectIconColorClassNames } from "../../lib/projectIcon";
import { useServerConfigs } from "../../state/entities";

/**
 * The bar in the thread's project color along the left edge of its row or card; nothing when
 * the project has no color. `className` places it inside the row.
 */
export function ProjectColorBar(props: {
  readonly thread: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
  readonly className: string;
}) {
  const color = resolveThreadProjectColor(
    props.thread,
    projectColorsByEnvironment(useServerConfigs()),
  );
  if (color === null) return null;
  return (
    <View
      pointerEvents="none"
      className={cn("absolute", props.className, projectIconColorClassNames(color).bar)}
    />
  );
}
