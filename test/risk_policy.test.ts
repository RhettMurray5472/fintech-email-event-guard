import assert from "node:assert/strict";
import test from "node:test";
import { decideRiskAction, deliveryEventSchema } from "../src/campaign_risk_policy.js";

test("a bounce sends the payment workflow to manual review", () => {
  const event = deliveryEventSchema.parse({
    eventId: "evt-bounce-42",
    messageId: "msg-42",
    paymentId: "pay-42",
    kind: "bounced",
    occurredAt: "2026-09-28T08:00:00.000Z",
  });

  assert.deepEqual(decideRiskAction(event), {
    action: "manual_review",
    reason: "delivery_failed",
  });
});

test("an open keeps the payment workflow moving", () => {
  const event = deliveryEventSchema.parse({
    eventId: "evt-open-42",
    messageId: "msg-42",
    paymentId: "pay-42",
    kind: "opened",
    occurredAt: "2026-09-28T08:01:00.000Z",
  });

  assert.deepEqual(decideRiskAction(event), {
    action: "continue",
    reason: "customer_engaged",
  });
});
