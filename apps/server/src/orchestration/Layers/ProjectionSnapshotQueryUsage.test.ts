import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const usageLayer = it.layer(
  OrchestrationProjectionSnapshotQueryLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

usageLayer("ProjectionSnapshotQuery.getUsageAnalytics", (it) => {
  it.effect("aggregates device-wide usage analytics", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;

      const insertThread = (id: string, model: string, createdAt: string) => sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, latest_user_message_at,
          pending_approval_count, pending_user_input_count, has_actionable_proposed_plan,
          created_at, updated_at, deleted_at
        ) VALUES (
          ${id}, 'project-1', ${`Thread ${id}`},
          ${`{"provider":"x","model":"${model}"}`},
          'full-access', 'default', NULL, NULL, NULL, NULL, 0, 0, 0,
          ${createdAt}, ${createdAt}, NULL
        )
      `;
      yield* insertThread("thread-1", "gpt-5-codex", "2026-02-24T10:00:00.000Z");
      yield* insertThread("thread-2", "claude-opus-4-8", "2026-02-25T10:00:00.000Z");

      const insertMessage = (id: string, threadId: string, createdAt: string) => sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
        ) VALUES (${id}, ${threadId}, 'turn-1', 'user', 'hi', 0, ${createdAt}, ${createdAt})
      `;
      yield* insertMessage("m1", "thread-1", "2026-02-24T23:00:00.000Z");
      yield* insertMessage("m2", "thread-1", "2026-02-24T23:30:00.000Z");
      yield* insertMessage("m3", "thread-2", "2026-02-25T11:00:00.000Z");

      const insertActivity = (
        id: string,
        threadId: string,
        turnId: string,
        seq: number,
        lastIn: number,
        lastOut: number,
        createdAt: string,
      ) => sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        ) VALUES (
          ${id}, ${threadId}, ${turnId}, 'info', 'context-window.updated', 'ctx',
          ${`{"usedTokens":1,"lastInputTokens":${lastIn},"lastOutputTokens":${lastOut}}`},
          ${seq}, ${createdAt}
        )
      `;
      // thread-1 turn-1 emits two updates; the final (seq 2) must win.
      yield* insertActivity("a1", "thread-1", "turn-1", 1, 30, 200, "2026-02-24T23:01:00.000Z");
      yield* insertActivity("a2", "thread-1", "turn-1", 2, 100, 400, "2026-02-24T23:02:00.000Z");
      yield* insertActivity("a3", "thread-2", "turn-2", 1, 1000, 2000, "2026-02-25T11:01:00.000Z");

      const summary = yield* query.getUsageAnalytics({ timeRange: "all" });

      assert.equal(summary.sessionCount, 2);
      assert.equal(summary.messageCount, 3);
      assert.equal(summary.totalTokens, 3500); // (100+400) + (1000+2000)
      assert.equal(summary.activeDays, 2);
      assert.equal(summary.peakHour, "11 PM"); // hour 23 has two messages

      assert.equal(summary.favoriteModel, "claude-opus-4-8");
      assert.equal(summary.modelBreakdown.length, 2);
      const codex = summary.modelBreakdown.find((row) => row.model === "gpt-5-codex");
      const opus = summary.modelBreakdown.find((row) => row.model === "claude-opus-4-8");
      assert.equal(codex?.inputTokens, 100);
      assert.equal(codex?.outputTokens, 400);
      assert.equal(opus?.inputTokens, 1000);
      assert.equal(opus?.outputTokens, 2000);

      const day24 = summary.dailyTokens.find((day) => day.date === "2026-02-24");
      assert.equal(day24?.tokens, 500);
    }),
  );
});
