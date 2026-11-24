import {
  planProjectColorWrites,
  projectColorsByEnvironment,
  resolveProjectRefsColor,
} from "@t3tools/client-runtime/state/project-colors";
import type { ProjectIconColor } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";

import { cn } from "~/lib/utils";
import { PROJECT_ICON_COLORS } from "../../projectIconColors";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useServerConfigs } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Popover, PopoverPopup } from "../ui/popover";
import { toastManager } from "../ui/toast";

export interface ProjectColorTarget {
  readonly group: SidebarProjectSnapshot;
  readonly position: { readonly x: number; readonly y: number };
}

/**
 * The project color picker, opened at the project's context menu. The color is saved on every
 * machine that has a copy of the project, so every client shows the same one.
 */
export function ProjectColorPopover(props: {
  readonly target: ProjectColorTarget | null;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const serverConfigs = useServerConfigs();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const { target } = props;
  const colors = projectColorsByEnvironment(serverConfigs);
  const current =
    target === null ? null : resolveProjectRefsColor(target.group.memberProjectRefs, colors);

  const choose = async (group: SidebarProjectSnapshot, color: ProjectIconColor | null) => {
    props.onClose();
    const writes = planProjectColorWrites({
      projectRefs: group.memberProjectRefs,
      color,
      colors,
    });
    const results = await Promise.all(
      writes.map((write) =>
        updateSettings({ environmentId: write.environmentId, input: { patch: write.patch } }),
      ),
    );
    if (results.some((result) => result._tag === "Failure")) {
      toastManager.add({ type: "error", title: gt("Could not save the project color") });
    }
  };

  return (
    <Popover open={target !== null} onOpenChange={(open) => !open && props.onClose()}>
      <PopoverPopup
        anchor={
          target === null
            ? undefined
            : {
                getBoundingClientRect: () =>
                  new DOMRect(target.position.x, target.position.y, 0, 0),
              }
        }
        align="start"
        side="bottom"
      >
        {target === null ? null : (
          <div className="flex flex-col gap-2">
            <div role="group" aria-label={gt("Project color")} className="grid grid-cols-6 gap-2">
              {PROJECT_ICON_COLORS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  title={m(entry.label)}
                  aria-label={m(entry.label)}
                  aria-pressed={entry.value === current}
                  onClick={() => void choose(target.group, entry.value)}
                  className={cn(
                    "size-6 cursor-pointer rounded-full outline-offset-2",
                    entry.swatchClassName,
                    entry.value === current && "outline-2 outline-foreground",
                  )}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => void choose(target.group, null)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span className="size-4 rounded-full border-[1.5px] border-dashed border-muted-foreground/60" />
              <T>No color</T>
            </button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}
