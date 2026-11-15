import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from "effect/http";
import { describe, expect } from "vite-plus/test";

import * as ServerHttp from "../http.ts";
import * as TicketStageCompat from "./TicketStageCompat.ts";

const threads = Array.from({ length: 400 }, (_, index) => ({
  id: `thread-${index}`,
  settledOverride: "ready",
}));

const layerShellRoute = HttpRouter.add(
  "GET",
  "/api/orchestration/shell",
  HttpServerResponse.json({ threads }),
);

const makeRequest = Effect.gen(function* () {
  const layerApp = layerShellRoute.pipe(
    Layer.provide(TicketStageCompat.layerHttp),
    Layer.provide(ServerHttp.layerHttpCompression),
  );
  const services = yield* Layer.build(
    HttpRouter.serve(layerApp, { disableListenLog: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layerTest),
    ),
  );
  const client = Context.get(services, HttpClient.HttpClient);
  return (headers: Record<string, string>) =>
    client.execute(HttpClientRequest.get("/api/orchestration/shell", { headers }));
});

describe("TicketStageCompat HTTP", () => {
  it.effect("shows no ticket stage to a client that does not declare the capability", () =>
    Effect.gen(function* () {
      const request = yield* makeRequest;

      const response = yield* request({ "accept-encoding": "identity" });

      expect(yield* response.text).not.toContain('"ready"');
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("shows no ticket stage in a compressed response", () =>
    Effect.gen(function* () {
      const request = yield* makeRequest;

      const response = yield* request({ "accept-encoding": "gzip" });

      expect(response.headers["content-encoding"]).toBe("gzip");
      const json = yield* response.text;
      expect(json).toContain('"settledOverride":null');
      expect(json).not.toContain('"ready"');
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the ticket stage for a client that declares the capability", () =>
    Effect.gen(function* () {
      const request = yield* makeRequest;

      const response = yield* request({
        "accept-encoding": "identity",
        "x-t3-client-capabilities": "settingsSecretReferences,threadTicketStages",
      });

      expect(yield* response.text).toContain('"settledOverride":"ready"');
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
