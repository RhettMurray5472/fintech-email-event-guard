import { PaymentNotificationWorkflow } from "../src/payment_notification_service.js";
import { paymentEventSchema } from "../src/campaign_risk_policy.js";

const recipient = process.env.DEMO_EMAIL_TO;
if (!recipient) throw new Error("DEMO_EMAIL_TO is required");

const payment = paymentEventSchema.parse({
  paymentId: `pay-demo-${Date.now()}`,
  customerEmail: recipient,
  amountMinor: 12500,
  currency: "usd",
  occurredAt: new Date().toISOString(),
});

const entry = await new PaymentNotificationWorkflow().notify(payment);
console.log(JSON.stringify(entry, null, 2));
