import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react-native";

import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";

/** Whether this device's Threads tab lists each project with its threads. */
export function useGroupThreadsByProject(): boolean {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences) && preferences.value.groupThreadsByProject === true;
}

/** The device setting that groups the Threads tab by project, like the desktop sidebar. */
export function ThreadListGroupingSection() {
  const gt = useGT();
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const grouped = useGroupThreadsByProject();
  return (
    <SettingsSection title={gt("This device")}>
      <ListToggleRow
        label={gt("Group by project")}
        description={gt(
          "Threads list shows each project with its threads, like the desktop sidebar",
        )}
        value={grouped}
        onValueChange={(groupThreadsByProject) => {
          void savePreferences({ groupThreadsByProject });
        }}
      />
    </SettingsSection>
  );
}
