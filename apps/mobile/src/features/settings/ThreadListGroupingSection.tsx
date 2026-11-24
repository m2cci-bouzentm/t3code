import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { msg, useGT, useMessages } from "gt-react-native";

import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import type { ProjectSortOrder } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";

const DEFAULT_PROJECT_SORT_ORDER: ProjectSortOrder = "updated_at";

const PROJECT_SORT_OPTIONS: ReadonlyArray<{
  readonly order: ProjectSortOrder;
  readonly label: string;
}> = [
  { order: "updated_at", label: msg("Last user message") },
  { order: "created_at", label: msg("Created at") },
  { order: "alphabetical", label: msg("Alphabetical") },
];

/** Whether this device's Threads tab lists each project with its threads. */
export function useGroupThreadsByProject(): boolean {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences) && preferences.value.groupThreadsByProject === true;
}

/** How this device orders projects in the Threads tab, like the desktop sidebar setting. */
export function useProjectSortOrder(): ProjectSortOrder {
  const preferences = useAtomValue(mobilePreferencesAtom);
  if (!AsyncResult.isSuccess(preferences)) return DEFAULT_PROJECT_SORT_ORDER;
  return preferences.value.projectSortOrder ?? DEFAULT_PROJECT_SORT_ORDER;
}

/** The device settings of the Threads tab: grouping by project and the project order. */
export function ThreadListGroupingSection() {
  const gt = useGT();
  const m = useMessages();
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const grouped = useGroupThreadsByProject();
  const sortOrder = useProjectSortOrder();
  return (
    <>
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
      <SettingsSection title={gt("Sort projects")}>
        {PROJECT_SORT_OPTIONS.map((option, index) => (
          <ListChoiceRow
            key={option.order}
            label={m(option.label)}
            selected={sortOrder === option.order}
            separated={index > 0}
            onPress={() => {
              void savePreferences({ projectSortOrder: option.order });
            }}
          />
        ))}
      </SettingsSection>
    </>
  );
}
