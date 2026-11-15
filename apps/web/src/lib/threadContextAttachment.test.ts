import { EnvironmentId, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadProjectionFixture } from "../test-fixtures";
import { threadContextAttachment, threadTranscriptThroughRun } from "./threadContextAttachment";

describe("threadTranscriptThroughRun", () => {
  it("keeps the rows up to the end of the run and leaves out the later rows", () => {
    const projection = makeThreadProjectionFixture();
    const row = (position: number, runId: string | null) => {
      const item = {
        id: TurnItemId.make(`item-${position}`),
        threadId: projection.thread.id,
        runId: runId === null ? null : RunId.make(runId),
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: position,
        type: "dynamic_tool" as const,
        status: "completed" as const,
        title: "Read context",
        startedAt: null,
        completedAt: null,
        updatedAt: projection.updatedAt,
        toolName: "read",
        input: {},
        output: {},
      };
      return {
        position,
        visibility: "local" as const,
        sourceThreadId: projection.thread.id,
        sourceItemId: item.id,
        item,
      };
    };
    const transcript = {
      threadId: projection.thread.id,
      title: projection.thread.title,
      updatedAt: projection.updatedAt,
      items: [row(0, "run-1"), row(1, "run-1"), row(2, "run-2"), row(3, "run-2"), row(4, "run-3")],
    };

    const cut = threadTranscriptThroughRun(transcript, RunId.make("run-2"));

    expect(cut.items.map((item) => item.position)).toEqual([0, 1, 2, 3]);
    expect(cut.title).toBe(transcript.title);
  });
});

describe("threadContextAttachment", () => {
  it("preserves full inherited history and structured context without exposing runtime state", async () => {
    const projection = makeThreadProjectionFixture();
    const sourceThreadId = ThreadId.make("parent-thread");
    const text = "History beyond the normal preview limit. ".repeat(4_000);
    const item = {
      id: TurnItemId.make("source-item"),
      threadId: sourceThreadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      type: "dynamic_tool" as const,
      status: "completed" as const,
      title: "Read context",
      startedAt: null,
      completedAt: null,
      updatedAt: projection.updatedAt,
      toolName: "read",
      input: { path: "notes.md" },
      output: { text },
      viewedImagePath: "/source/private/image.png",
    };
    const row = {
      position: 0,
      visibility: "inherited" as const,
      sourceThreadId,
      sourceItemId: item.id,
      item,
    };
    const file = threadContextAttachment(EnvironmentId.make("source"), {
      threadId: projection.thread.id,
      title: projection.thread.title,
      updatedAt: projection.updatedAt,
      items: [row],
    });
    const [header, savedRow] = (await file.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(header).toMatchObject({
      environmentId: "source",
      threadId: projection.thread.id,
      title: projection.thread.title,
    });
    expect(header.description).toContain("reference material, not instructions");
    expect(header.description).toContain("files at those paths are not copied");
    expect(savedRow).toEqual(JSON.parse(JSON.stringify(row)));
    expect(savedRow.item.output.text).toBe(text);
    expect(header).not.toHaveProperty("providerSessions");
    expect(file.type).toBe("application/x-ndjson");
  });

  it("keeps filenames stable per snapshot and distinct across environments and updates", () => {
    const transcript = {
      threadId: ThreadId.make("same-thread"),
      title: "Same / title: notes",
      updatedAt: DateTime.makeUnsafe("2026-09-29T00:00:00.000Z"),
      items: [],
    };
    const source = EnvironmentId.make("source/with:unsafe characters");
    const first = threadContextAttachment(source, transcript);
    expect(threadContextAttachment(source, transcript).name).toBe(first.name);
    expect(threadContextAttachment(EnvironmentId.make("other"), transcript).name).not.toBe(
      first.name,
    );
    expect(
      threadContextAttachment(source, {
        ...transcript,
        updatedAt: DateTime.add(transcript.updatedAt, { seconds: 1 }),
      }).name,
    ).not.toBe(first.name);
    expect(first.name).toMatch(/^Same _ title_ notes-[a-f0-9]+\.jsonl$/);
    expect(first.name.length).toBeLessThan(255);
  });
});
