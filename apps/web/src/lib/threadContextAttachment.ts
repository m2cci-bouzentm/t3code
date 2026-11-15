import type {
  EnvironmentId,
  OrchestrationV2ImportedHistoryMessage,
  OrchestrationV2ThreadTranscript,
  RunId,
} from "@t3tools/contracts";
import { toKindScopedComposerContextId } from "@t3tools/shared/composerContextReferences";
import { threadTranscriptHeader } from "@t3tools/shared/threadTranscript";
import * as DateTime from "effect/DateTime";

/** The thread as it was when the run ended: the rows after that run are left out. */
export function threadTranscriptThroughRun(
  transcript: OrchestrationV2ThreadTranscript,
  runId: RunId,
): OrchestrationV2ThreadTranscript {
  const lastRow = transcript.items.findLastIndex((row) => row.item.runId === runId);
  return { ...transcript, items: transcript.items.slice(0, lastRow + 1) };
}

/** The conversation of the thread: what the user and the agent said, and the reasoning. */
export function importedHistoryFromTranscript(
  transcript: OrchestrationV2ThreadTranscript,
): OrchestrationV2ImportedHistoryMessage[] {
  return transcript.items.flatMap(({ item }): OrchestrationV2ImportedHistoryMessage[] => {
    if (item.type === "user_message") {
      return [{ role: "user", text: item.text, createdAt: item.updatedAt }];
    }
    if (item.type === "assistant_message") {
      return [{ role: "assistant", text: item.text, createdAt: item.updatedAt }];
    }
    if (item.type === "reasoning") {
      return [{ role: "reasoning", text: item.text, createdAt: item.updatedAt }];
    }
    return [];
  });
}

export function threadContextAttachment(
  environmentId: EnvironmentId,
  transcript: OrchestrationV2ThreadTranscript,
): File {
  const updatedAt = DateTime.formatIso(transcript.updatedAt);
  const name = toKindScopedComposerContextId(
    "thread",
    `${environmentId}:${transcript.threadId}:${updatedAt}`,
  );
  const title = transcript.title.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 64) || "Thread";
  return new File(
    [
      threadTranscriptHeader(environmentId, transcript),
      ...transcript.items.map((row) => `${JSON.stringify(row)}\n`),
    ],
    `${title}-${name.slice(-16)}.jsonl`,
    { type: "application/x-ndjson" },
  );
}
