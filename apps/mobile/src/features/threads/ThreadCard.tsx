import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { msg, useMessages } from "gt-react-native";
import { Pressable, View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { AppText as Text } from "../../components/ui/AppText";
import { ProjectColorBar } from "./ProjectColorBar";
import { resolveThreadListV2Status, type ThreadListV2Status } from "./threadListV2";

const STATUS_LABELS: Record<ThreadListV2Status, string | null> = {
  approval: msg("Needs approval"),
  input: msg("Needs input"),
  request: msg("Guest request"),
  working: msg("Working"),
  waiting: msg("Waiting"),
  failed: msg("Failed"),
  limited: msg("Usage limit"),
  ready: null,
};

function wakeLabel(snoozedUntil: string): string {
  return new Date(snoozedUntil).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A thread as a card, in its project's color: a line above the title (its project or machine),
 * the title, and when it last changed or wakes.
 */
export function ThreadCard(props: {
  readonly thread: EnvironmentThreadShell;
  readonly subtitle: string | undefined;
  readonly now: string;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  const m = useMessages();
  const { thread } = props;
  const statusLabel = STATUS_LABELS[resolveThreadListV2Status(thread)];
  const isSnoozed = effectiveSnoozed(thread, { now: props.now });
  return (
    <Pressable
      accessibilityRole="button"
      className="mx-4 mb-2 gap-1 overflow-hidden rounded-xl border border-border-subtle bg-card px-4 py-3 active:bg-subtle"
      onPress={() => props.onOpen(thread)}
    >
      <ProjectColorBar thread={thread} className="bottom-0 left-0 top-0 w-1" />
      <View className="flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
          {props.subtitle}
        </Text>
        {statusLabel === null ? null : (
          <Text className="font-t3-medium text-xs text-warning-foreground">{m(statusLabel)}</Text>
        )}
      </View>
      <Text className="font-t3-medium text-base text-foreground" numberOfLines={2}>
        {thread.title}
      </Text>
      <Text className="text-xs text-foreground-muted">
        {isSnoozed && thread.snoozedUntil !== null ? (
          m(msg("Wakes {time}", { time: wakeLabel(thread.snoozedUntil) }))
        ) : (
          <RelativeTime timestamp={thread.updatedAt} />
        )}
      </Text>
    </Pressable>
  );
}
