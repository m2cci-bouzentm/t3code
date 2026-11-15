import {
  MessageId,
  TurnItemId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ImportedHistoryMessage,
  type OrchestrationV2TurnItem,
  type ThreadId,
} from "@t3tools/contracts";

type ImportedHistoryEvent = Omit<
  Extract<OrchestrationV2DomainEvent, { readonly type: "message.updated" | "turn-item.updated" }>,
  "id"
>;

/**
 * The events that give a new thread the conversation of a thread on another machine. The rows
 * belong to no run, so the first turn hands them to the provider as its context.
 */
export function importedHistoryEvents(
  threadId: ThreadId,
  history: ReadonlyArray<OrchestrationV2ImportedHistoryMessage>,
): ReadonlyArray<ImportedHistoryEvent> {
  return history.flatMap((imported, index): ReadonlyArray<ImportedHistoryEvent> => {
    const suffix = String(index).padStart(6, "0");
    const at = imported.createdAt;
    const common = {
      id: TurnItemId.make(`imported-history:turn-item:${threadId}:${suffix}`),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: index + 1,
      status: "completed" as const,
      title: null,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
    };
    const turnItemEvent = (payload: OrchestrationV2TurnItem): ImportedHistoryEvent => ({
      type: "turn-item.updated",
      threadId,
      occurredAt: at,
      payload,
    });
    if (imported.role === "reasoning") {
      return [
        turnItemEvent({ ...common, type: "reasoning", text: imported.text, streaming: false }),
      ];
    }
    const messageId = MessageId.make(`${threadId}:${suffix}`);
    const message: OrchestrationV2ConversationMessage = {
      createdBy: imported.role === "user" ? "user" : "agent",
      creationSource: "server",
      id: messageId,
      threadId,
      runId: null,
      nodeId: null,
      role: imported.role,
      text: imported.text,
      attachments: [],
      streaming: false,
      createdAt: at,
      updatedAt: at,
    };
    const turnItem: OrchestrationV2TurnItem =
      imported.role === "user"
        ? {
            ...common,
            createdBy: "user",
            creationSource: "server",
            type: "user_message",
            messageId,
            inputIntent: "turn_start",
            text: imported.text,
            attachments: [],
          }
        : {
            ...common,
            type: "assistant_message",
            messageId,
            text: imported.text,
            streaming: false,
          };
    return [
      { type: "message.updated", threadId, occurredAt: at, payload: message },
      turnItemEvent(turnItem),
    ];
  });
}
