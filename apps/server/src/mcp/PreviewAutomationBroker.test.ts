import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  PreviewAutomationClientDisconnectedError,
  PreviewAutomationInvalidSelectorError,
  PreviewAutomationMalformedResponseError,
  PreviewAutomationNoFocusedOwnerError,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type PreviewAutomationOwner,
  type PreviewAutomationRequest,
  type PreviewAutomationStreamEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";

const makeBroker = PreviewAutomationBroker.make.pipe(Effect.provide(NodeServices.layer));

const scope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
  expiresAt: 2,
};

const makeOwner = (overrides: Partial<PreviewAutomationOwner> = {}): PreviewAutomationOwner => ({
  clientId: "client-1",
  environmentId: scope.environmentId,
  threadId: scope.threadId,
  supportsAutomation: true,
  ...overrides,
});

type RoutedRequest = PreviewAutomationRequest & {
  readonly connectionId: PreviewAutomationStreamEvent["connectionId"];
};

const requestsFrom = (
  events: Stream.Stream<PreviewAutomationStreamEvent>,
  onConnected: (connectionId: PreviewAutomationStreamEvent["connectionId"]) => void = () => {},
): Stream.Stream<RoutedRequest> =>
  events.pipe(
    Stream.filterMap((event) => {
      if (event.type === "connected") {
        onConnected(event.connectionId);
        return Result.failVoid;
      }
      return Result.succeed({ ...event.request, connectionId: event.connectionId });
    }),
  );

it.effect("atomically registers a connected owner and correlates its response", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const requests = requestsFrom(yield* broker.connect(makeOwner()));
      yield* Stream.runForEach(requests, (request) =>
        broker.respond({
          clientId: "client-1",
          connectionId: request.connectionId,
          requestId: request.requestId,
          ok: true,
          result: { available: true },
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const result = yield* broker.invoke<{ available: boolean }>({
        scope,
        operation: "open",
        input: {},
      });

      expect(result).toEqual({ available: true });
    }),
  ),
);

it.effect("announces a live replacement stream before delivering requests", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const events = yield* broker.connect(makeOwner());
      const receivedTypes: PreviewAutomationStreamEvent["type"][] = [];
      const consumer = yield* events.pipe(
        Stream.take(2),
        Stream.runForEach((event) => {
          receivedTypes.push(event.type);
          return event.type === "connected"
            ? Effect.void
            : broker.respond({
                clientId: "client-1",
                connectionId: event.connectionId,
                requestId: event.request.requestId,
                ok: true,
                result: "ready",
              });
        }),
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;

      const result = yield* broker.invoke<string>({ scope, operation: "status", input: {} });
      yield* Fiber.join(consumer);

      expect(receivedTypes).toEqual(["connected", "request"]);
      expect(result).toBe("ready");
    }),
  ),
);

it.effect("preserves bounded request and remote selector diagnostics", () => {
  const locator = "role=button[name='request-secret']";
  const remoteMessage = "Unexpected token near remote-secret.";
  const remoteError = {
    _tag: "PreviewAutomationInvalidSelectorError",
    message: remoteMessage,
    detail: { selector: "role=button[name='remote-secret']" },
  } as const;

  return Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const requests = requestsFrom(yield* broker.connect(makeOwner()));
      yield* Stream.runForEach(requests, (request) =>
        broker.respond({
          clientId: "client-1",
          connectionId: request.connectionId,
          requestId: request.requestId,
          ok: false,
          error: remoteError,
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const error = yield* broker
        .invoke<void>({
          scope,
          operation: "click",
          input: { locator },
          tabId: PreviewTabId.make("tab-1"),
          timeoutMs: 1_234,
        })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(PreviewAutomationInvalidSelectorError);
      expect(error).toMatchObject({
        operation: "click",
        environmentId: scope.environmentId,
        threadId: scope.threadId,
        providerSessionId: scope.providerSessionId,
        providerInstanceId: scope.providerInstanceId,
        clientId: "client-1",
        requestId: "preview-0",
        tabId: "tab-1",
        timeoutMs: 1_234,
        selectorKind: "locator",
        selectorLength: locator.length,
        remoteTag: "PreviewAutomationInvalidSelectorError",
        remoteMessageLength: remoteMessage.length,
        remoteDetailKind: "object",
      });
      expect(error.message).toBe(
        `Preview automation click received an invalid locator (${locator.length} characters).`,
      );
      expect(error.message).not.toContain("secret");
      expect(error.cause).toBe(remoteError);
      expect("selector" in error).toBe(false);
      expect("remoteMessage" in error).toBe(false);
      expect("remoteDetail" in error).toBe(false);
    }),
  );
});

it.effect("distinguishes malformed remote failures", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const requests = requestsFrom(yield* broker.connect(makeOwner()));
      yield* Stream.runForEach(requests, (request) =>
        broker.respond({
          clientId: "client-1",
          connectionId: request.connectionId,
          requestId: request.requestId,
          ok: false,
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const error = yield* broker
        .invoke<void>({ scope, operation: "status", input: {}, timeoutMs: 2_000 })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(PreviewAutomationMalformedResponseError);
      expect(error).toMatchObject({
        operation: "status",
        environmentId: scope.environmentId,
        threadId: scope.threadId,
        providerSessionId: scope.providerSessionId,
        providerInstanceId: scope.providerInstanceId,
        clientId: "client-1",
        requestId: "preview-0",
        timeoutMs: 2_000,
      });
    }),
  ),
);

it.effect("rejects calls when no connected owner exists", () =>
  Effect.gen(function* () {
    const broker = yield* makeBroker;
    const error = yield* broker
      .invoke<void>({ scope, operation: "status", input: {} })
      .pipe(Effect.flip);

    expect(error).toBeInstanceOf(PreviewAutomationNoFocusedOwnerError);
    expect(error).toMatchObject({
      operation: "status",
      environmentId: scope.environmentId,
      threadId: scope.threadId,
      providerSessionId: scope.providerSessionId,
      providerInstanceId: scope.providerInstanceId,
    });
  }),
);

it.effect("does not create owner state from focus updates without a live stream", () =>
  Effect.gen(function* () {
    const broker = yield* makeBroker;
    yield* broker.focusOwner({
      clientId: "client-1",
      environmentId: scope.environmentId,
      threadId: scope.threadId,
      connectionId: "connection-missing",
      focused: true,
    });

    const error = yield* broker
      .invoke<void>({ scope, operation: "status", input: {} })
      .pipe(Effect.flip);
    expect(error).toBeInstanceOf(PreviewAutomationNoFocusedOwnerError);
  }),
);

it.effect("removes ownership when the authoritative request stream disconnects", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const requests = requestsFrom(yield* broker.connect(makeOwner()));
      const beforeAcquisition = yield* broker
        .invoke<void>({ scope, operation: "status", input: {} })
        .pipe(Effect.flip);
      expect(beforeAcquisition).toBeInstanceOf(PreviewAutomationNoFocusedOwnerError);

      const consumer = yield* Stream.runDrain(requests).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(consumer);

      const error = yield* broker
        .invoke<void>({ scope, operation: "status", input: {} })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(PreviewAutomationNoFocusedOwnerError);
    }),
  ),
);

it.effect("routes to the most recently focused live owner using server ordering", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      let firstConnectionId = "";
      let secondConnectionId = "";
      const firstRequests = requestsFrom(
        yield* broker.connect(makeOwner({ clientId: "client-first" })),
        (connectionId) => {
          firstConnectionId = connectionId;
        },
      );
      const secondRequests = requestsFrom(
        yield* broker.connect(makeOwner({ clientId: "client-second" })),
        (connectionId) => {
          secondConnectionId = connectionId;
        },
      );
      yield* Stream.runForEach(firstRequests, (request) =>
        broker.respond({
          clientId: "client-first",
          connectionId: request.connectionId,
          requestId: request.requestId,
          ok: true,
          result: "first",
        }),
      ).pipe(Effect.forkScoped);
      yield* Stream.runForEach(secondRequests, (request) =>
        broker.respond({
          clientId: "client-second",
          connectionId: request.connectionId,
          requestId: request.requestId,
          ok: true,
          result: "second",
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      yield* broker.focusOwner({
        clientId: "client-first",
        environmentId: scope.environmentId,
        threadId: scope.threadId,
        connectionId: "connection-stale",
        focused: true,
      });
      expect(yield* broker.invoke<string>({ scope, operation: "status", input: {} })).toBe(
        "second",
      );
      yield* broker.focusOwner({
        clientId: "client-first",
        environmentId: scope.environmentId,
        threadId: scope.threadId,
        connectionId: firstConnectionId,
        focused: true,
      });

      expect(yield* broker.invoke<string>({ scope, operation: "status", input: {} })).toBe("first");

      yield* broker.focusOwner({
        clientId: "client-second",
        environmentId: scope.environmentId,
        threadId: scope.threadId,
        connectionId: secondConnectionId,
        focused: true,
      });

      expect(yield* broker.invoke<string>({ scope, operation: "status", input: {} })).toBe(
        "second",
      );
    }),
  ),
);

it.effect("ignores stale focus updates from a previous thread", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      let firstConnectionId = "";
      const firstRequests = requestsFrom(
        yield* broker.connect(makeOwner({ clientId: "client-first" })),
        (connectionId) => {
          firstConnectionId = connectionId;
        },
      );
      const secondRequests = requestsFrom(
        yield* broker.connect(makeOwner({ clientId: "client-second" })),
      );
      yield* Stream.runForEach(firstRequests, (request) =>
        broker.respond({
          clientId: "client-first",
          connectionId: request.connectionId,
          requestId: request.requestId,
          ok: true,
          result: "first",
        }),
      ).pipe(Effect.forkScoped);
      yield* Stream.runForEach(secondRequests, (request) =>
        broker.respond({
          clientId: "client-second",
          connectionId: request.connectionId,
          requestId: request.requestId,
          ok: true,
          result: "second",
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      yield* broker.focusOwner({
        clientId: "client-first",
        environmentId: scope.environmentId,
        threadId: ThreadId.make("thread-stale"),
        connectionId: firstConnectionId,
        focused: true,
      });

      expect(yield* broker.invoke<string>({ scope, operation: "status", input: {} })).toBe(
        "second",
      );
    }),
  ),
);

it.effect("lets the browser host resolve an active tab locally", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const requests = requestsFrom(yield* broker.connect(makeOwner()));
      let routedTabId: string | undefined;
      yield* Stream.runForEach(requests, (request) => {
        routedTabId = request.tabId;
        return broker.respond({
          clientId: "client-1",
          connectionId: request.connectionId,
          requestId: request.requestId,
          ok: true,
        });
      }).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      yield* broker.invoke<void>({ scope, operation: "click", input: { x: 10, y: 10 } });

      expect(routedTabId).toBeUndefined();
    }),
  ),
);

it.effect("keeps a replacement stream authoritative when the old stream finalizes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      let firstConnectionId = "";
      let replacementConnectionId = "";
      const firstRequests = requestsFrom(yield* broker.connect(makeOwner()), (connectionId) => {
        firstConnectionId = connectionId;
      });
      yield* Stream.runDrain(firstRequests).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const replacementRequests = requestsFrom(
        yield* broker.connect(makeOwner()),
        (connectionId) => {
          replacementConnectionId = connectionId;
        },
      );
      yield* Stream.runForEach(replacementRequests, (request) =>
        broker.respond({
          clientId: "client-1",
          connectionId: request.connectionId,
          requestId: request.requestId,
          ok: true,
          result: "replacement",
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      expect(replacementConnectionId).not.toBe(firstConnectionId);
      const result = yield* broker.invoke<string>({ scope, operation: "status", input: {} });
      expect(result).toBe("replacement");
    }),
  ),
);

it.effect("fails requests assigned to the stream that is replaced", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const requests = requestsFrom(yield* broker.connect(makeOwner()));
      yield* Stream.runDrain(requests).pipe(Effect.forkScoped);
      const pending = yield* broker
        .invoke<void>({ scope, operation: "status", input: {} })
        .pipe(Effect.flip, Effect.forkScoped);
      yield* Effect.yieldNow;

      const replacementRequests = requestsFrom(yield* broker.connect(makeOwner()));
      yield* Stream.runDrain(replacementRequests).pipe(Effect.forkScoped);

      const error = yield* Fiber.join(pending);
      expect(error).toBeInstanceOf(PreviewAutomationClientDisconnectedError);
      expect(error).toMatchObject({
        operation: "status",
        environmentId: scope.environmentId,
        threadId: scope.threadId,
        providerSessionId: scope.providerSessionId,
        providerInstanceId: scope.providerInstanceId,
        clientId: "client-1",
        requestId: "preview-0",
        timeoutMs: 15_000,
      });
    }),
  ),
);

it.effect("accepts responses only from the owner that received the request", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const requests = requestsFrom(yield* broker.connect(makeOwner()));
      yield* Stream.runForEach(requests, (request) =>
        Effect.gen(function* () {
          yield* broker.respond({
            clientId: "client-foreign",
            connectionId: request.connectionId,
            requestId: request.requestId,
            ok: true,
            result: "foreign",
          });
          yield* broker.respond({
            clientId: "client-1",
            connectionId: "connection-stale",
            requestId: request.requestId,
            ok: true,
            result: "stale",
          });
          yield* broker.respond({
            clientId: "client-1",
            connectionId: request.connectionId,
            requestId: request.requestId,
            ok: true,
            result: "owner",
          });
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const result = yield* broker.invoke<string>({ scope, operation: "status", input: {} });
      expect(result).toBe("owner");
    }),
  ),
);
