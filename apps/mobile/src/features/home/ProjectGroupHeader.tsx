import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import type { HomeProjectScope } from "./homeThreadList";

/**
 * The header of a project in the grouped Threads list: a tap folds its threads, a long press
 * opens its color. A null scope heads the threads of no listed project.
 */
export function ProjectGroupHeader(props: {
  readonly scope: HomeProjectScope | null;
  readonly count: number;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onLongPress: () => void;
}) {
  const gt = useGT();
  const { scope } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !props.collapsed }}
      onPress={props.onToggle}
      onLongPress={props.onLongPress}
      className="flex-row items-center gap-2.5 px-3 pb-1.5 pt-4 active:bg-subtle"
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
        <Text className="text-sm text-foreground-muted">{props.count}</Text>
      ) : null}
      <SymbolView
        name={props.collapsed ? "chevron.right" : "chevron.down"}
        size={13}
        tintColorClassName="accent-foreground-muted"
      />
    </Pressable>
  );
}
