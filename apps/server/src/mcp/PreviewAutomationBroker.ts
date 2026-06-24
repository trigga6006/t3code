import {
  PreviewAutomationClientDisconnectedError,
  PreviewAutomationControlInterruptedError,
  PreviewAutomationExecutionError,
  PreviewAutomationInvalidSelectorError,
  PreviewAutomationMalformedResponseError,
  PreviewAutomationNoFocusedOwnerError,
  PreviewAutomationRemoteUnavailableError,
  PreviewAutomationRequestQueueClosedError,
  PreviewAutomationResultTooLargeError,
  PreviewAutomationTabNotFoundError,
  PreviewAutomationTimeoutError,
  PreviewAutomationUnsupportedClientError,
  type PreviewAutomationError,
  type PreviewAutomationOperation,
  type PreviewAutomationOwner,
  type PreviewAutomationOwnerFocus,
  type PreviewAutomationResponse,
  type PreviewAutomationStreamEvent,
  type PreviewTabId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as McpInvocationContext from "./McpInvocationContext.ts";

export interface PreviewAutomationInvokeInput {
  readonly scope: McpInvocationContext.McpInvocationScope;
  readonly operation: PreviewAutomationOperation;
  readonly input: unknown;
  readonly tabId?: PreviewTabId;
  readonly timeoutMs?: number;
}

export class PreviewAutomationBroker extends Context.Service<
  PreviewAutomationBroker,
  {
    readonly connect: (
      owner: PreviewAutomationOwner,
    ) => Effect.Effect<Stream.Stream<PreviewAutomationStreamEvent>>;
    readonly focusOwner: (owner: PreviewAutomationOwnerFocus) => Effect.Effect<void>;
    readonly respond: (
      response: PreviewAutomationResponse,
    ) => Effect.Effect<void, PreviewAutomationError>;
    readonly invoke: <A = unknown>(
      request: PreviewAutomationInvokeInput,
    ) => Effect.Effect<A, PreviewAutomationError>;
  }
>()("t3/mcp/PreviewAutomationBroker") {}

interface ClientConnection {
  readonly clientId: string;
  readonly connectionId: string;
  readonly environmentId: PreviewAutomationOwner["environmentId"];
  readonly threadId: PreviewAutomationOwner["threadId"];
  readonly supportsAutomation: boolean;
  readonly focused: boolean;
  readonly focusOrder: number;
  readonly queue: Queue.Queue<PreviewAutomationStreamEvent>;
}

interface PendingRequest {
  readonly queue: ClientConnection["queue"];
  readonly deferred: Deferred.Deferred<unknown, PreviewAutomationError>;
  readonly context: PreviewAutomationRequestErrorContext;
}

interface PreviewAutomationRequestErrorContext {
  readonly operation: PreviewAutomationOperation;
  readonly environmentId: McpInvocationContext.McpInvocationScope["environmentId"];
  readonly threadId: McpInvocationContext.McpInvocationScope["threadId"];
  readonly providerSessionId: string;
  readonly providerInstanceId: McpInvocationContext.McpInvocationScope["providerInstanceId"];
  readonly clientId: string;
  readonly connectionId: ClientConnection["connectionId"];
  readonly requestId: string;
  readonly tabId?: PreviewTabId;
  readonly timeoutMs: number;
  readonly selectorKind?: "locator" | "selector";
  readonly selectorLength?: number;
}

interface BrokerState {
  readonly clients: ReadonlyMap<string, ClientConnection>;
  readonly pending: ReadonlyMap<string, PendingRequest>;
  readonly requestSequence: number;
  readonly focusSequence: number;
}

const selectorDiagnosticsFromInput = (
  input: unknown,
): Pick<PreviewAutomationRequestErrorContext, "selectorKind" | "selectorLength"> => {
  if (typeof input !== "object" || input === null) return {};
  if ("locator" in input && typeof input.locator === "string") {
    return { selectorKind: "locator", selectorLength: input.locator.length };
  }
  if ("selector" in input && typeof input.selector === "string") {
    return { selectorKind: "selector", selectorLength: input.selector.length };
  }
  return {};
};

type RemoteDetailKind = "null" | "array" | "object" | "string" | "number" | "boolean";

function remoteDetailKind(detail: unknown): RemoteDetailKind {
  if (detail === null) return "null";
  if (Array.isArray(detail)) return "array";
  switch (typeof detail) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

const classifyResponseError = (
  context: PreviewAutomationRequestErrorContext,
  error: NonNullable<PreviewAutomationResponse["error"]>,
): PreviewAutomationError => {
  const remoteDiagnostics = {
    remoteTag: error._tag,
    remoteMessageLength: error.message.length,
    ...(error.detail === undefined ? {} : { remoteDetailKind: remoteDetailKind(error.detail) }),
    cause: error,
  };
  switch (error._tag) {
    case "PreviewAutomationNoFocusedOwnerError":
      return new PreviewAutomationNoFocusedOwnerError({
        ...context,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationUnsupportedClientError":
      return new PreviewAutomationUnsupportedClientError({
        ...context,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationTabNotFoundError":
      return new PreviewAutomationTabNotFoundError({
        ...context,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationTimeoutError":
      return new PreviewAutomationTimeoutError({
        ...context,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationControlInterruptedError":
      return new PreviewAutomationControlInterruptedError({
        ...context,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationInvalidSelectorError": {
      return new PreviewAutomationInvalidSelectorError({
        ...context,
        ...remoteDiagnostics,
      });
    }
    case "PreviewAutomationResultTooLargeError": {
      const detail =
        typeof error.detail === "object" && error.detail !== null ? error.detail : undefined;
      const maximumBytes =
        detail &&
        "maximumBytes" in detail &&
        typeof detail.maximumBytes === "number" &&
        Number.isInteger(detail.maximumBytes) &&
        detail.maximumBytes > 0
          ? detail.maximumBytes
          : undefined;
      return new PreviewAutomationResultTooLargeError({
        ...context,
        ...remoteDiagnostics,
        ...(maximumBytes === undefined ? {} : { maximumBytes }),
      });
    }
    case "PreviewAutomationUnavailableError":
      return new PreviewAutomationRemoteUnavailableError({
        ...context,
        ...remoteDiagnostics,
      });
    default:
      return new PreviewAutomationExecutionError({
        ...context,
        ...remoteDiagnostics,
      });
  }
};

export const make = Effect.gen(function* PreviewAutomationBrokerMake() {
  const crypto = yield* Crypto.Crypto;
  const state = yield* SynchronizedRef.make<BrokerState>({
    clients: new Map(),
    pending: new Map(),
    requestSequence: 0,
    focusSequence: 0,
  });

  const disconnect = Effect.fn("PreviewAutomationBroker.disconnect")(function* (
    clientId: string,
    queue: ClientConnection["queue"],
  ) {
    const toFail = yield* SynchronizedRef.modify(state, (current) => {
      const clients = new Map(current.clients);
      const pending = new Map(current.pending);
      const disconnected: PendingRequest[] = [];
      if (current.clients.get(clientId)?.queue === queue) {
        clients.delete(clientId);
      }
      for (const [requestId, entry] of pending) {
        if (entry.queue === queue) {
          pending.delete(requestId);
          disconnected.push(entry);
        }
      }
      return [disconnected, { ...current, clients, pending }] as const;
    });
    yield* Effect.forEach(
      toFail,
      ({ deferred, context }) =>
        Deferred.fail(deferred, new PreviewAutomationClientDisconnectedError(context)),
      { discard: true },
    );
    yield* Queue.shutdown(queue);
  });

  const acquireConnection = Effect.fn("PreviewAutomationBroker.acquireConnection")(function* (
    owner: PreviewAutomationOwner,
  ) {
    const clientId = owner.clientId;
    const queue = yield* Queue.unbounded<PreviewAutomationStreamEvent>();
    const connectionId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    yield* Queue.offer(queue, { type: "connected", connectionId });
    const connection: ClientConnection = {
      clientId,
      connectionId,
      environmentId: owner.environmentId,
      threadId: owner.threadId,
      supportsAutomation: owner.supportsAutomation,
      focused: false,
      focusOrder: 0,
      queue,
    };
    const registration = yield* SynchronizedRef.modify(state, (current) => {
      const clients = new Map(current.clients);
      const focusSequence = current.focusSequence + 1;
      const registeredConnection = { ...connection, focusOrder: focusSequence };
      clients.set(clientId, registeredConnection);
      return [
        { previousConnection: current.clients.get(clientId), registeredConnection },
        { ...current, clients, focusSequence },
      ] as const;
    });
    if (registration.previousConnection) {
      yield* disconnect(clientId, registration.previousConnection.queue);
    }
    return registration.registeredConnection;
  });

  const connect: PreviewAutomationBroker["Service"]["connect"] = Effect.fn(
    "PreviewAutomationBroker.connect",
  )((owner) =>
    Effect.succeed(
      Stream.unwrap(
        Effect.acquireRelease(acquireConnection(owner), (connection) =>
          disconnect(connection.clientId, connection.queue),
        ).pipe(Effect.map((connection) => Stream.fromQueue(connection.queue))),
      ),
    ),
  );

  const focusOwner: PreviewAutomationBroker["Service"]["focusOwner"] = Effect.fn(
    "PreviewAutomationBroker.focusOwner",
  )(function* (owner) {
    yield* SynchronizedRef.update(state, (current) => {
      const currentOwner = current.clients.get(owner.clientId);
      if (
        !currentOwner ||
        currentOwner.environmentId !== owner.environmentId ||
        currentOwner.threadId !== owner.threadId ||
        currentOwner.connectionId !== owner.connectionId
      ) {
        return current;
      }
      const clients = new Map(current.clients);
      const focusSequence = owner.focused ? current.focusSequence + 1 : current.focusSequence;
      clients.set(owner.clientId, {
        ...currentOwner,
        focused: owner.focused,
        focusOrder: owner.focused ? focusSequence : 0,
      });
      return { ...current, clients, focusSequence };
    });
  });

  const respond: PreviewAutomationBroker["Service"]["respond"] = Effect.fn(
    "PreviewAutomationBroker.respond",
  )(function* (response) {
    const pending = yield* SynchronizedRef.modify(state, (current) => {
      const entry = current.pending.get(response.requestId);
      if (
        !entry ||
        entry.context.clientId !== response.clientId ||
        entry.context.connectionId !== response.connectionId
      ) {
        return [undefined, current] as const;
      }
      const next = new Map(current.pending);
      next.delete(response.requestId);
      return [entry, { ...current, pending: next }] as const;
    });
    if (!pending) return;
    if (response.ok) {
      yield* Deferred.succeed(pending.deferred, response.result);
    } else {
      yield* Deferred.fail(
        pending.deferred,
        response.error
          ? classifyResponseError(pending.context, response.error)
          : new PreviewAutomationMalformedResponseError(pending.context),
      );
    }
  });

  const invoke = Effect.fn("PreviewAutomationBroker.invoke")(function* <A = unknown>(
    input: Parameters<PreviewAutomationBroker["Service"]["invoke"]>[0],
  ): Effect.fn.Return<A, PreviewAutomationError> {
    const timeoutMs = input.timeoutMs ?? 15_000;
    const deferred = yield* Deferred.make<unknown, PreviewAutomationError>();
    const route = yield* SynchronizedRef.modify(state, (current) => {
      const connection = Array.from(current.clients.values())
        .filter(
          (owner) =>
            owner.environmentId === input.scope.environmentId &&
            owner.threadId === input.scope.threadId &&
            owner.supportsAutomation,
        )
        .sort(
          (left, right) =>
            Number(right.focused) - Number(left.focused) || right.focusOrder - left.focusOrder,
        )[0];
      if (!connection) return [undefined, current] as const;

      const requestId = `preview-${current.requestSequence}`;
      const tabId = input.tabId;
      const selectorDiagnostics = selectorDiagnosticsFromInput(input.input);
      const context: PreviewAutomationRequestErrorContext = {
        operation: input.operation,
        environmentId: input.scope.environmentId,
        threadId: input.scope.threadId,
        providerSessionId: input.scope.providerSessionId,
        providerInstanceId: input.scope.providerInstanceId,
        clientId: connection.clientId,
        connectionId: connection.connectionId,
        requestId,
        ...(tabId === undefined ? {} : { tabId }),
        timeoutMs,
        ...selectorDiagnostics,
      };
      const pending = new Map(current.pending);
      pending.set(requestId, { queue: connection.queue, deferred, context });
      return [
        { connection, requestId, requestContext: context },
        { ...current, pending, requestSequence: current.requestSequence + 1 },
      ] as const;
    });
    if (!route) {
      return yield* new PreviewAutomationNoFocusedOwnerError({
        operation: input.operation,
        environmentId: input.scope.environmentId,
        threadId: input.scope.threadId,
        providerSessionId: input.scope.providerSessionId,
        providerInstanceId: input.scope.providerInstanceId,
      });
    }
    const { connection, requestId, requestContext } = route;
    const removePending = SynchronizedRef.update(state, (next) => {
      if (!next.pending.has(requestId)) return next;
      const pending = new Map(next.pending);
      pending.delete(requestId);
      return { ...next, pending };
    });
    const awaitResponse = Effect.fn("PreviewAutomationBroker.awaitResponse")(function* () {
      const offered = yield* Queue.offer(connection.queue, {
        type: "request",
        connectionId: connection.connectionId,
        request: {
          requestId,
          threadId: input.scope.threadId,
          tabId: requestContext.tabId,
          operation: input.operation,
          input: input.input,
          timeoutMs,
        },
      });
      if (!offered) {
        const completion = yield* Deferred.poll(deferred);
        if (Option.isSome(completion)) {
          return (yield* completion.value) as A;
        }
        return yield* new PreviewAutomationRequestQueueClosedError(requestContext);
      }
      const result = yield* Deferred.await(deferred).pipe(Effect.timeoutOption(timeoutMs));
      return yield* Option.match(result, {
        onNone: () => Effect.fail(new PreviewAutomationTimeoutError(requestContext)),
        onSome: (value) => Effect.succeed(value as A),
      });
    });
    return yield* awaitResponse().pipe(Effect.ensuring(removePending));
  });

  return PreviewAutomationBroker.of({ connect, focusOwner, respond, invoke });
}).pipe(Effect.withSpan("PreviewAutomationBroker.make"));

export const layer = Layer.effect(PreviewAutomationBroker, make);
