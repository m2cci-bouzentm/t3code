import type { useGT } from "gt-react";
import {
  AlarmClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  UserRoundIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import type { SidebarThreadStatus } from "../Sidebar.logic";

const TOP_STATUS_ICONS = {
  working: CircleDashedIcon,
  waiting: CircleDotDashedIcon,
  input: MessageCircleQuestionIcon,
  request: UserRoundIcon,
  approval: ShieldQuestionIcon,
  failed: CircleAlertIcon,
  done: CircleCheckIcon,
  woke: AlarmClockIcon,
} as const;

export function TopStatusIcon(props: { icon: keyof typeof TOP_STATUS_ICONS; className: string }) {
  const Icon = TOP_STATUS_ICONS[props.icon];
  return <Icon aria-hidden className={cn("shrink-0", props.className)} />;
}

/** What a thread shows next to its title in the sidebar and on the board: icon, label, color. */
export function resolveThreadTopStatus(
  input: {
    readonly status: SidebarThreadStatus;
    readonly goalActive: boolean;
    readonly isWoke: boolean;
    readonly isUnread: boolean;
  },
  gt: ReturnType<typeof useGT>,
) {
  const { status, isWoke, isUnread } = input;
  return status === "preparing" || status === "working"
    ? {
        label:
          status === "preparing"
            ? gt("Setting up")
            : input.goalActive
              ? gt("Goal", { $context: "thread status: working on a goal" })
              : gt("Working", { $context: "thread status" }),
        icon: "working" as const,
        className: "text-info-foreground",
      }
    : status === "waiting"
      ? {
          label: gt("Waiting", { $context: "thread status" }),
          icon: "waiting" as const,
          className: "text-muted-foreground",
        }
      : status === "approval"
        ? {
            label: gt("Approval", { $context: "thread status: needs approval" }),
            icon: "approval" as const,
            className: "text-warning-foreground",
          }
        : status === "input"
          ? {
              label: gt("Input", { $context: "thread status: needs user input" }),
              icon: "input" as const,
              className: "text-indigo-600 dark:text-indigo-300",
            }
          : status === "request"
            ? {
                label: gt("Request", { $context: "thread status: guest request" }),
                icon: "request" as const,
                className: "text-guest-foreground",
              }
            : status === "limited"
              ? {
                  label: gt("Limited", { $context: "thread status: usage limited" }),
                  icon: "failed" as const,
                  className: "text-warning-foreground",
                }
              : status === "failed"
                ? {
                    label: gt("Failed", { $context: "thread status" }),
                    icon: "failed" as const,
                    className: "text-error-foreground",
                  }
                : isWoke
                  ? {
                      label: gt("Woke", { $context: "thread status: woke from snooze" }),
                      icon: "woke" as const,
                      className: "text-warning-foreground",
                    }
                  : isUnread
                    ? {
                        label: gt("Done", { $context: "thread status" }),
                        icon: "done" as const,
                        className: "text-success-foreground",
                      }
                    : null;
}
