import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  presentPendingBackgroundWork,
  type PendingBackgroundWorkItem,
} from "@t3tools/client-runtime/state/thread-execution";
import type {
  EnvironmentId,
  OrchestrationV2PendingBackgroundTask,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { msg, T, useGT, useMessages } from "gt-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SheetHeader } from "../../components/ui/SheetHeader";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { cn } from "../../lib/cn";
import { environmentThreadShells } from "../../state/threads";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { ThreadCommandOutput, useCommandOutputStreaming } from "./thread-command-output";

const KIND_LABELS = {
  subagent: msg("Subagent"),
  command: msg("Command", { $context: "noun, a running shell command" }),
  monitor: msg("Monitor", { $context: "noun, a background watcher task" }),
  background_task: msg("Background task"),
} as const;

type BackgroundWorkTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

interface CommandOutputSource {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
}

/** The output a background command streams, from the thread that ran it; null for other work. */
function commandOutputSource(
  tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>,
  item: PendingBackgroundWorkItem,
  target: BackgroundWorkTarget,
): CommandOutputSource | null {
  if (item.kind !== "command") return null;
  const task = tasks.find((candidate) => candidate.taskId === item.taskId);
  if (task?.itemId === undefined) return null;
  return {
    environmentId: target.environmentId,
    threadId: task.sourceThreadId ?? target.threadId,
    itemId: task.itemId,
  };
}

export function ThreadBackgroundWorkSheet({ route }: StaticScreenProps<BackgroundWorkTarget>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const m = useMessages();
  const target = route.params;
  const thread = useAtomValue(
    environmentThreadShells.threadShellAtom(scopeThreadRef(target.environmentId, target.threadId)),
  );
  const streamsOutput = useCommandOutputStreaming(target.environmentId);
  const { themeAppearance } = useAppearancePreferences();
  const presentation = presentPendingBackgroundWork(thread?.pendingBackgroundTasks ?? [], m);
  const openThread = (threadId: ThreadId) => {
    void Haptics.selectionAsync();
    // A thread replaces the leaf sheet so workspace back navigation still works.
    navigation.dispatch(
      StackActions.replace("Thread", { environmentId: target.environmentId, threadId }),
    );
  };
  const content = (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-5 pb-6"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {presentation === null ? (
        <Text className="pt-6 text-center text-sm text-foreground-muted">
          <T>Nothing running in the background.</T>
        </Text>
      ) : (
        presentation.items.map((item) => (
          <BackgroundWorkRow
            key={item.taskId}
            item={item}
            onOpen={openThread}
            output={
              streamsOutput
                ? commandOutputSource(thread?.pendingBackgroundTasks ?? [], item, target)
                : null
            }
            themeAppearance={themeAppearance}
          />
        ))
      )}
    </ScrollView>
  );
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("Background work")} onClose={() => navigation.goBack()} />
      <ScreenContent>{content}</ScreenContent>
    </View>
  );
}

function BackgroundWorkRow(props: {
  readonly item: PendingBackgroundWorkItem;
  readonly onOpen: (threadId: ThreadId) => void;
  readonly output: CommandOutputSource | null;
  readonly themeAppearance: "light" | "dark";
}) {
  const { item, output } = props;
  const gt = useGT();
  const m = useMessages();
  const childThreadId = item.childThreadId;
  const row = (
    <View
      className={cn(
        "flex-row items-center gap-3 py-3.5",
        output === null && "border-b border-border",
      )}
    >
      <SymbolView
        name={
          item.kind === "subagent" ? "person.2" : item.kind === "monitor" ? "clock" : "terminal"
        }
        size={15}
        tintColorClassName="accent-foreground-muted"
        type="monochrome"
      />
      <View className="min-w-0 flex-1">
        <Text className="font-t3-medium text-sm text-foreground">{item.label}</Text>
        <Text className="text-xs text-foreground-muted">{m(KIND_LABELS[item.kind])}</Text>
      </View>
      {childThreadId === undefined ? null : (
        <SymbolView name="chevron.right" size={12} tintColorClassName="accent-icon-subtle" />
      )}
    </View>
  );
  if (output !== null) {
    return (
      <View className="border-b border-border pb-3">
        <View accessible>{row}</View>
        <ThreadCommandOutput
          environmentId={output.environmentId}
          threadId={output.threadId}
          itemId={output.itemId}
          themeAppearance={props.themeAppearance}
        />
      </View>
    );
  }
  return childThreadId === undefined ? (
    <View accessible>{row}</View>
  ) : (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={gt("Open subagent {label}", { label: item.label })}
      onPress={() => props.onOpen(childThreadId)}
      className="active:opacity-70"
    >
      {row}
    </Pressable>
  );
}
