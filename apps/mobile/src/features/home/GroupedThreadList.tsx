import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { resolveThreadStage } from "@t3tools/client-runtime/state/thread-stage";
import type { EnvironmentId, SidebarProjectGroupingMode } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import { useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironments } from "../../state/environments";
import { ThreadCard } from "../threads/ThreadCard";
import { useThreadListNow } from "../threads/use-thread-list-now";
import { buildHomeProjectScopes, type HomeProjectScope } from "./homeThreadList";
import { ProjectColorSheet } from "./ProjectColorSheet";

interface ThreadGroup {
  readonly key: string;
  readonly scope: HomeProjectScope | null;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}

const NO_PROJECT_KEY = "no-project";

const NEWEST_THREAD_FIRST = Order.mapInput(
  Order.flip(Order.String),
  (thread: EnvironmentThreadShell) => thread.updatedAt,
);
const PROJECT_A_TO_Z = Order.mapInput(Order.String, (group: { readonly scope: HomeProjectScope }) =>
  group.scope.title.toLocaleLowerCase(),
);

function isThreadInScope(thread: EnvironmentThreadShell, scope: HomeProjectScope): boolean {
  return scope.projectRefs.some(
    (ref) => ref.environmentId === thread.environmentId && ref.projectId === thread.projectId,
  );
}

function matchesSearch(thread: EnvironmentThreadShell, query: string): boolean {
  return query === "" || thread.title.toLocaleLowerCase().includes(query);
}

/**
 * Each project with its active threads, like the desktop sidebar: projects A to Z so they keep
 * their places, threads newest first. The threads of no listed project come last under
 * "No project". Empty projects are left out.
 */
function groupThreads(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly scopes: ReadonlyArray<HomeProjectScope>;
  readonly now: string;
  readonly query: string;
}): ThreadGroup[] {
  const listed = Arr.sort(
    input.threads.filter(
      (thread) =>
        resolveThreadStage(thread, { now: input.now }) === "open" &&
        matchesSearch(thread, input.query),
    ),
    NEWEST_THREAD_FIRST,
  );
  const groups = Arr.sort(
    input.scopes
      .map((scope) => ({
        key: scope.key,
        scope,
        threads: listed.filter((thread) => isThreadInScope(thread, scope)),
      }))
      .filter((group) => group.threads.length > 0),
    PROJECT_A_TO_Z,
  );
  const grouped = new Set(groups.flatMap((group) => group.threads));
  const ungrouped = listed.filter((thread) => !grouped.has(thread));
  if (ungrouped.length === 0) return groups;
  return [...groups, { key: NO_PROJECT_KEY, scope: null, threads: ungrouped }];
}

function GroupHeader(props: {
  readonly group: ThreadGroup;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onLongPress: () => void;
}) {
  const gt = useGT();
  const { scope } = props.group;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !props.collapsed }}
      onPress={props.onToggle}
      onLongPress={props.onLongPress}
      className="flex-row items-center gap-2.5 px-5 py-2.5 active:bg-subtle"
    >
      {scope === null ? (
        <View className="size-6 items-center justify-center rounded-md bg-subtle">
          <Text className="text-xs text-foreground-muted">⋯</Text>
        </View>
      ) : (
        <ProjectFavicon
          environmentId={scope.representative.environmentId}
          faviconPath={scope.representative.faviconPath}
          projectIcon={scope.representative.projectIcon}
          size={24}
          projectTitle={scope.representative.title}
          workspaceRoot={scope.representative.workspaceRoot}
        />
      )}
      <Text className="min-w-0 flex-1 font-t3-medium text-base text-foreground" numberOfLines={1}>
        {scope === null ? gt("No project") : scope.title}
      </Text>
      {props.collapsed ? (
        <Text className="text-sm text-foreground-muted">{props.group.threads.length}</Text>
      ) : null}
      <SymbolView
        name={props.collapsed ? "chevron.right" : "chevron.down"}
        size={13}
        tintColorClassName="accent-foreground-muted"
      />
    </Pressable>
  );
}

/** The Threads tab grouped by project, when the device setting asks for it. */
export function GroupedThreadList(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly searchQuery: string;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
}) {
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(new Set());
  const [colorScope, setColorScope] = useState<HomeProjectScope | null>(null);

  const m = useMessages();
  const insets = useSafeAreaInsets();
  const now = useThreadListNow(props.threads);
  const { environments } = useEnvironments();

  const machineLabels = new Map(environments.map((entry) => [entry.environmentId, entry.label]));
  const scopes = buildHomeProjectScopes(
    {
      projects: props.projects,
      environmentId: props.selectedEnvironmentId,
      projectGroupingMode: props.projectGroupingMode,
    },
    m,
  ).filter((scope) => props.selectedProjectKey === null || scope.key === props.selectedProjectKey);
  const groups = groupThreads({
    threads: props.threads,
    scopes,
    now,
    query: props.searchQuery.trim().toLocaleLowerCase(),
  });

  const toggle = (key: string) =>
    setCollapsedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
      >
        {groups.map((group) => {
          const collapsed = collapsedKeys.has(group.key);
          return (
            <View key={group.key}>
              <GroupHeader
                group={group}
                collapsed={collapsed}
                onToggle={() => toggle(group.key)}
                onLongPress={() => {
                  if (group.scope !== null) setColorScope(group.scope);
                }}
              />
              {collapsed
                ? null
                : group.threads.map((thread) => (
                    <ThreadCard
                      key={`${thread.environmentId}:${thread.id}`}
                      thread={thread}
                      subtitle={machineLabels.get(thread.environmentId)}
                      now={now}
                      onOpen={props.onSelectThread}
                    />
                  ))}
            </View>
          );
        })}
      </ScreenScrollView>
      <ProjectColorSheet scope={colorScope} onClose={() => setColorScope(null)} />
    </>
  );
}
