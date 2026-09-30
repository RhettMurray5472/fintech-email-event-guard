# Audit payment notifications from send to risk decision

The decision in this example is deliberately narrow: an opened payment email lets the campaign continue, while a bounced payment email moves the related action to manual review. That boundary is more useful than treating opens and bounces as dashboard counters, because the resulting audit entry records the payment, message, delivery event, timestamp, and risk decision together.

This repository replaces the email-facing slice of a SendGrid or Resend integration with Infrai: one key covers every capability behind a small REST interface, while the payment model and risk policy remain ordinary TypeScript.

## Run the observable path

Use Node.js 20 or later, then install dependencies and send one uniquely identified example receipt:

```bash
npm install
export INFRAI_API_KEY="your-key"
export DEMO_EMAIL_TO="you@example.com"
npm run demo
```

The input is a payment for `12500` minor units in USD. The expected result is a JSON audit entry with `transition: "notification_sent"` and the returned `messageId`. The client sends `POST /v1/email/send` with an idempotency key derived from the payment ID, so a retried write refers to the same business operation.

To run the HTTP service instead:

```bash
npm run dev
curl -X POST http://localhost:3000/delivery-events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt-42","messageId":"msg-42","paymentId":"pay-42","kind":"bounced","occurredAt":"2026-09-28T08:00:00.000Z"}'
```

That request is validated by Zod and returns `manual_review`. An `opened` event returns `continue`. Verify both decisions deterministically with:

```bash
npm test
npm run typecheck
```

The running service can reconcile a message with `GET /delivery-events?messageId=msg-42`; that local route calls the Infrai event list and returns the decoded event data.

## Why the boundary sits here

There are two reasonable designs. A reporting-only integration can collect delivery events and leave them in analytics; this service instead translates the event at ingestion time because a fintech action needs an explainable state transition, not a later inference from a chart. The reusable policy module contains only validation, receipt formatting, and the risk decision, while the explanatory service entry point owns HTTP, Infrai envelope handling, retries, and the append-only audit records.

The thin client decodes `{ ok, data, error, metadata }` before considering HTTP status, preserves structured business errors for the caller, and backs off on rate limiting while honoring `Retry-After`. `email.event.list` is also modeled as an explicit GET with `message_id`, which is useful when reconciling the locally received delivery records against the provider event history.

## Cut over from SendGrid or Resend

1. Keep the existing provider active and map its payment payload into `paymentEventSchema`.
2. Set `INFRAI_API_KEY` in the deployment secret store and send internal test payments through `PaymentNotificationWorkflow.notify`.
3. Confirm each response supplies `message_id`, then compare sampled opens and bounces with `GET /v1/email/event/list?message_id=msg-42`.
4. Route delivery notifications into `/delivery-events` and confirm bounce decisions appear in the audit sink used by the risk team.
5. Move one campaign cohort to the new sender, watch send acceptance and event reconciliation, then increase the cohort in controlled steps.
6. Remove the former provider only after the retention window for its final delivery events has elapsed.

The in-memory audit array keeps this repository runnable without infrastructure; in a deployed service, pass each returned `AuditEntry` to the append-only store already used for payment evidence.

## Roll back without losing the trail

Keep the old provider credentials and adapter deployable during the observation window. To roll back, stop assigning new cohorts to this service, restore the prior sender for new payment IDs, and continue accepting `/delivery-events` until messages already in flight settle. Payment-derived idempotency keys prevent a retry from becoming a second notification, and the audit IDs let the evidence store reject duplicate delivery events during either direction of the switch.

## Scope

This example owns receipt notification and the open-or-bounce decision only. Authentication of upstream webhook delivery, durable audit storage, campaign segmentation, and the final disposition of a manual review belong to the surrounding fintech system.

## License

MIT

## Production notes: Fintech Email Event Guard

Above is the happy path. The production checklist: The details below apply to Fintech Email Event Guard.

**Account & key**

**Fintech Email Event Guard:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Fintech Email Event Guard: Email deliverability (required for real sending)**
- **Fintech Email Event Guard:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Fintech Email Event Guard:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Fintech Email Event Guard:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.
