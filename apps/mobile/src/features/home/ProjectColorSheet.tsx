import {
  planProjectColorWrites,
  projectColorsByEnvironment,
  resolveProjectRefsColor,
} from "@t3tools/client-runtime/state/project-colors";
import { ProjectIconColor } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { cn } from "../../lib/cn";
import { projectIconColorClassNames } from "../../lib/projectIcon";
import { useServerConfigs } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { HomeProjectScope } from "./homeThreadList";

/**
 * The color picker of a project, opened by a long press on its header. The color is saved on
 * every machine that has a copy of the project, so every client shows the same one.
 */
export function ProjectColorSheet(props: {
  readonly scope: HomeProjectScope | null;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const colors = projectColorsByEnvironment(useServerConfigs());
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const { scope } = props;
  const current = scope === null ? null : resolveProjectRefsColor(scope.projectRefs, colors);

  const choose = async (picked: HomeProjectScope, color: ProjectIconColor | null) => {
    props.onClose();
    const writes = planProjectColorWrites({ projectRefs: picked.projectRefs, color, colors });
    const results = await Promise.all(
      writes.map((write) =>
        updateSettings({ environmentId: write.environmentId, input: { patch: write.patch } }),
      ),
    );
    if (results.some((result) => result._tag === "Failure")) {
      Dialog.alert(
        gt("Could not save the project color"),
        gt("Try again when the machine is connected."),
      );
    }
  };

  return (
    <Modal
      transparent
      animationType="slide"
      visible={scope !== null}
      onRequestClose={props.onClose}
    >
      <Pressable
        accessibilityLabel={gt("Close")}
        className="flex-1 bg-black/55"
        onPress={props.onClose}
      />
      {scope === null ? null : (
        <View
          className="rounded-t-3xl bg-sheet px-5 pt-2.5"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 12 }}
        >
          <View className="mb-3.5 h-1 w-9 self-center rounded-full bg-foreground-muted/50" />
          <Text className="font-t3-medium text-base text-foreground">{scope.title}</Text>
          <Text className="mb-4 text-sm text-foreground-muted">
            {gt("Color, on every machine and device")}
          </Text>
          <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-y-3.5">
            {ProjectIconColor.literals.map((color) => (
              <View key={color} className="w-1/6 items-center">
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel={color}
                  accessibilityState={{ selected: color === current }}
                  onPress={() => void choose(scope, color)}
                  className={cn(
                    "size-9 rounded-full",
                    projectIconColorClassNames(color).bar,
                    color === current && "border-2 border-foreground",
                  )}
                />
              </View>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void choose(scope, null)}
            className="mt-3 flex-row items-center gap-2 rounded-lg py-2 active:bg-subtle"
          >
            <View className="size-4 rounded-full border-[1.5px] border-dashed border-foreground-muted" />
            <Text className="text-sm text-foreground-muted">{gt("No color")}</Text>
          </Pressable>
        </View>
      )}
    </Modal>
  );
}
