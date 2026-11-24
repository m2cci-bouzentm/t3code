/**
 * A thread stores its ticket stage in `settledOverride`. A client that does not declare
 * the ticket stage capability rejects those values, so everything the server sends to
 * such a client passes through here and shows a ticket stage as no override.
 * A client that declares the capability never enters this module.
 */
import {
  CLIENT_CAPABILITIES_HEADER,
  CLIENT_CAPABILITIES_QUERY_PARAM,
  THREAD_TICKET_STAGES_CAPABILITY,
  ThreadTicketStage,
} from "@t3tools/contracts";
import {
  SOCKET_FRAME_PARTS_QUERY_PARAM,
  splitLargeSocketFrames,
} from "@t3tools/shared/socketFrameParts";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import { HttpBody, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as Socket from "effect/socket/Socket";

import { withSocketHeartbeat } from "../socketHeartbeat.ts";

const ORCHESTRATION_HTTP_PATH_PREFIX = "/api/orchestration/";
const NO_OVERRIDE_FIELD = '"settledOverride":null';
const TICKET_STAGE_FIELDS = ThreadTicketStage.literals.map(
  (stage) => `"settledOverride":"${stage}"`,
);

function isWithoutTicketStages(capabilities: string | null | undefined): boolean {
  return !(capabilities ?? "").split(",").includes(THREAD_TICKET_STAGES_CAPABILITY);
}

export function isSocketClientWithoutTicketStages(url: URL): boolean {
  return isWithoutTicketStages(url.searchParams.get(CLIENT_CAPABILITIES_QUERY_PARAM));
}

/** JSON text escapes quotes inside strings, so only a real field matches. */
export function hideTicketStages(json: string): string {
  return TICKET_STAGE_FIELDS.reduce(
    (text, field) => text.replaceAll(field, NO_OVERRIDE_FIELD),
    json,
  );
}

function hideTicketStagesInFrame<Frame>(frame: Frame): Frame | string {
  return typeof frame === "string" ? hideTicketStages(frame) : frame;
}

function hideTicketStagesOnSocket(socket: Socket.Socket): Socket.Socket {
  return Socket.make({
    reader: socket.reader,
    writer: Effect.map(socket.writer, (writer) => ({
      write: (frame) => writer.write(hideTicketStagesInFrame(frame)),
      writeAll: (frames) => writer.writeAll(Arr.map(frames, hideTicketStagesInFrame)),
    })),
  });
}

/** The RPC server upgrades the request itself, so its socket is wrapped through the request it reads. */
export function serveSocketClientWithoutTicketStages<A, E, R>(
  rpcWebSocketHttpEffect: Effect.Effect<A, E, R>,
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
): Effect.Effect<A, E, R> {
  const frameSocket = url.searchParams.has(SOCKET_FRAME_PARTS_QUERY_PARAM)
    ? splitLargeSocketFrames
    : identity<Socket.Socket>;
  const upgrade = Effect.map(request.upgrade, (socket) =>
    withSocketHeartbeat(hideTicketStagesOnSocket(frameSocket(socket))),
  );
  return rpcWebSocketHttpEffect.pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      Object.create(request, { upgrade: { value: upgrade } }),
    ),
  );
}

function hideTicketStagesInResponse(
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse {
  const body = response.body;
  if (body._tag !== "Uint8Array") return response;
  const json = body.text ?? new TextDecoder().decode(body.body);
  return HttpServerResponse.setBody(
    response,
    HttpBody.text(hideTicketStages(json), body.contentType),
  );
}

export const layerHttp = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const isOrchestrationRequestWithoutTicketStages =
        request.url.startsWith(ORCHESTRATION_HTTP_PATH_PREFIX) &&
        isWithoutTicketStages(request.headers[CLIENT_CAPABILITIES_HEADER]);
      if (!isOrchestrationRequestWithoutTicketStages) return yield* httpEffect;
      return hideTicketStagesInResponse(yield* httpEffect);
    }),
  { global: true },
);
