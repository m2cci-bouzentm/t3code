import type {
  EnvironmentId,
  ProjectIconColor,
  ProjectId,
  ScopedProjectRef,
  ServerSettingsPatch,
} from "@t3tools/contracts";

/** The project colors each environment's settings hold, by environment. */
export type ProjectColorsByEnvironment = ReadonlyMap<
  EnvironmentId,
  Readonly<Record<ProjectId, ProjectIconColor>>
>;

/** The project colors of each connected environment, from its server settings. */
export function projectColorsByEnvironment(
  configs: ReadonlyMap<
    EnvironmentId,
    { readonly settings: { readonly projectColors: Readonly<Record<ProjectId, ProjectIconColor>> } }
  >,
): ProjectColorsByEnvironment {
  return new Map([...configs].map(([id, config]) => [id, config.settings.projectColors]));
}

/** The color a thread carries in thread lists: its project's color on its own machine. */
export function resolveThreadProjectColor(
  thread: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
  colors: ProjectColorsByEnvironment,
): ProjectIconColor | null {
  const environmentColors = colors.get(thread.environmentId);
  if (environmentColors === undefined) return null;
  return environmentColors[thread.projectId] ?? null;
}

/** The color of a project shown once for all its machines: the first copy that has one. */
export function resolveProjectRefsColor(
  projectRefs: ReadonlyArray<ScopedProjectRef>,
  colors: ProjectColorsByEnvironment,
): ProjectIconColor | null {
  for (const ref of projectRefs) {
    const color = resolveThreadProjectColor(ref, colors);
    if (color !== null) return color;
  }
  return null;
}

/**
 * The settings writes that give a project one color on every machine that has a copy of it.
 * `null` removes the color. Each environment gets its whole map, the others' entries kept.
 */
export function planProjectColorWrites(input: {
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
  readonly color: ProjectIconColor | null;
  readonly colors: ProjectColorsByEnvironment;
}): Array<{ readonly environmentId: EnvironmentId; readonly patch: ServerSettingsPatch }> {
  const next = new Map<EnvironmentId, Record<ProjectId, ProjectIconColor>>();
  for (const ref of input.projectRefs) {
    const current = next.get(ref.environmentId) ?? { ...input.colors.get(ref.environmentId) };
    if (input.color === null) delete current[ref.projectId];
    else current[ref.projectId] = input.color;
    next.set(ref.environmentId, current);
  }
  return [...next].map(([environmentId, projectColors]) => ({
    environmentId,
    patch: { projectColors },
  }));
}
