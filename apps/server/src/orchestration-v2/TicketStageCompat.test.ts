import { describe, expect, it } from "vite-plus/test";

import { hideTicketStages, isSocketClientWithoutTicketStages } from "./TicketStageCompat.ts";

describe("TicketStageCompat", () => {
  it("shows a ticket stage as no override", () => {
    const frame = JSON.stringify([
      { id: "a", settledOverride: "ready" },
      { id: "b", settledOverride: "backlog" },
      { id: "c", settledOverride: "settled" },
      { id: "d", settledOverride: "active" },
      { id: "e", settledOverride: null },
    ]);

    expect(JSON.parse(hideTicketStages(frame))).toEqual([
      { id: "a", settledOverride: null },
      { id: "b", settledOverride: null },
      { id: "c", settledOverride: "settled" },
      { id: "d", settledOverride: "active" },
      { id: "e", settledOverride: null },
    ]);
  });

  it("keeps message text that quotes the field", () => {
    const frame = JSON.stringify({ text: '{"settledOverride":"ready"}' });

    expect(hideTicketStages(frame)).toBe(frame);
  });

  it("selects only a client that does not declare the capability", () => {
    const stock = new URL("ws://host.test/ws?clientCapabilities=settingsSecretReferences");
    const fork = new URL(
      "ws://host.test/ws?clientCapabilities=settingsSecretReferences,threadTicketStages",
    );

    expect(isSocketClientWithoutTicketStages(stock)).toBe(true);
    expect(isSocketClientWithoutTicketStages(new URL("ws://host.test/ws"))).toBe(true);
    expect(isSocketClientWithoutTicketStages(fork)).toBe(false);
  });
});
