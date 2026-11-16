// File: ai.threads.test.ts
// Path: src/tests/ai.threads.test.ts
//
// npm run test:ai — offline checks for AI threads: the free local intents and
// the {keep_N} masking of the current canvas (no id, date or FY may reach the LLM).

import { test } from "node:test";
import assert from "node:assert/strict";
import { isExplainRequest, isNewThreadRequest, tokeniseSpec } from "@/services/ai/thread.service";

test("explain requests about the canvas are answered locally", () => {
  for (const t of ["explain this report", "Explain", "give me a summary", "summarise this", "what does this show", "walk me through the report", "key takeaways"])
    assert.equal(isExplainRequest(t), true, t);
  for (const t of ["clients by industry", "summary of clients by industry and CSR spend per financial year for the last three years", "show spocs", "make it a pie"])
    assert.equal(isExplainRequest(t), false, t);
});

test("only an explicit request starts a new thread locally", () => {
  for (const t of ["new chat", "start a new canvas", "New report", "start over", "new one", "another topic"]) assert.equal(isNewThreadRequest(t), true, t);
  for (const t of ["new clients this month", "show new SPOCs", "clients added this week", "make it a pie"]) assert.equal(isNewThreadRequest(t), false, t);
});

test("the canvas sent to the LLM carries no ids, dates or FYs", () => {
  const id = "0b9c7e1e-1f0a-4b5e-9d57-0e6f1a2b3c4d";
  const spec = {
    title: "T",
    blocks: [
      { id: "b1", component: "bar" as const, query: "clients_by", params: { by: "industry", industryId: [id], added: { from: "2026-01-01", to: "2026-12-31" }, top: 5 }, title: "A", width: "half" as const },
      { id: "b2", component: "kpi" as const, query: "csr_total", params: { fy: "2024-25" }, title: "B", width: "third" as const },
    ],
  };
  const { template, keep } = tokeniseSpec(spec);
  const sent = JSON.stringify(template);
  assert.ok(!sent.includes(id) && !sent.includes("2026-01-01") && !sent.includes("2024-25"), sent);
  assert.ok(sent.includes('"by":"industry"') && sent.includes('"top":5'), "plain settings stay readable");
  assert.equal(Object.keys(keep).length, 3);
  // same shape, other values → identical template (so memory is reused across values)
  const other = structuredClone(spec);
  other.blocks[1]!.params = { fy: "2023-24" };
  assert.equal(JSON.stringify(tokeniseSpec(other).template), sent);
});
