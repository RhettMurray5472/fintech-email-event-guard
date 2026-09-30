import { z } from "zod";

export const paymentEventSchema = z.object({
  paymentId: z.string().min(1),
  customerEmail: z.string().email(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  occurredAt: z.string().datetime(),
});

export const deliveryEventSchema = z.object({
  eventId: z.string().min(1),
  messageId: z.string().min(1),
  paymentId: z.string().min(1),
  kind: z.enum(["opened", "bounced"]),
  occurredAt: z.string().datetime(),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;

export type RiskDecision = {
  action: "continue" | "manual_review";
  reason: "customer_engaged" | "delivery_failed";
};

export function decideRiskAction(event: DeliveryEvent): RiskDecision {
  return event.kind === "bounced"
    ? { action: "manual_review", reason: "delivery_failed" }
    : { action: "continue", reason: "customer_engaged" };
}

export function receiptText(payment: PaymentEvent): string {
  const amount = (payment.amountMinor / 100).toFixed(2);
  return `Payment ${payment.paymentId} for ${amount} ${payment.currency} was received.`;
}
