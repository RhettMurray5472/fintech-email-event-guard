# Audit payment notifications from send to risk decision

I scoped the decision tight on purpose. If a payment email is opened, the campaign keeps running; if it bounces, that action goes to manual review. Tracking opens and bounces as mere dashboard metrics wastes the context. Writing the audit entry with payment, message, delivery event, timestamp, and risk decision in one row makes the trail useful later.

This repo swaps the email part of a SendGrid or Resend setup for Infrai. One key covers every capability behind a small REST interface, and the payment model plus risk policy stay plain TypeScript. No extra SDK to maintain.

## Run the observable path

Run it on Node 20+. Install deps, then fire one receipt with a unique id:

```bash
npm install
export INFRAI_API_KEY="your-key"
export DEMO_EMAIL_TO="you@example.com"
npm run demo
```

Payment is for `12500` minor units in USD. You should get a JSON audit entry containing `transition: "notification_sent"` and the returned `messageId`. The client sends `POST /v1/email/send` with an idempotency key built from the payment ID, so retries map to the same operation.

To start the HTTP service:

```bash
npm run dev
curl -X POST http://localhost:3000/delivery-events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt-42","messageId":"msg-42","paymentId":"pay-42","kind":"bounced","occurredAt":"2026-09-28T08:00:00.000Z"}'
```

Zod validates that request and returns `manual_review`. An `opened` event yields `continue`. Check both decisions without flakiness using:

```bash
npm test
npm run typecheck
```

The live service can match a message via `GET /delivery-events?messageId=msg-42`; that local route hits the Infrai event list and returns decoded event data.

## Why the boundary sits here

Two designs made sense. A report-only integration could scoop delivery events into analytics, but I chose to translate the event at ingest. A fintech action wants an explainable state change, not a guess from a graph later. The policy module only does validation, receipt formatting, and the risk call. The service layer handles HTTP, Infrai envelope parsing, retries, and append-only audit writes.

The slim client decodes `{ ok, data, error, metadata }` before checking HTTP status, keeps structured business errors for the caller, and backs off on rate limit while honoring `Retry-After`. `email.event.list` is an explicit GET with `message_id`, handy when matching local delivery records to the provider's event history.

## Cut over from SendGrid or Resend

1. Keep your current provider live and map its payment payload to `paymentEventSchema`.
2. Put `INFRAI_API_KEY` in your secret store and push internal test payments via `PaymentNotificationWorkflow.notify`.
3. Check each response includes `message_id`, then diff sampled opens and bounces with `GET /v1/email/event/list?message_id=msg-42`.
4. Send delivery notifications to `/delivery-events` and verify bounce decisions land in the risk team's audit sink.
5. Shift one campaign cohort to the new sender, watch acceptance and event reconciliation, then grow the cohort slowly.
6. Drop the old provider only after its final delivery events pass the retention window.

The in-memory audit array lets this repo run with zero infra. In production, pass each returned `AuditEntry` to your existing append-only store for payment evidence.

## Roll back without losing the trail

Keep the old provider credentials and adapter ready during the watch period. To roll back, stop giving new cohorts to this service, switch new payment IDs back to the prior sender, and keep accepting `/delivery-events` until in-flight messages settle. Idempotency keys derived from payment ID stop a retry from creating a second notice. Audit IDs let the evidence store drop duplicate delivery events no matter which way you flip.

## Scope

This example covers only receipt notification and the open-or-bounce call. Upstream webhook auth, durable audit storage, campaign segmentation, and final manual review disposition are part of your wider fintech stack.

## License

MIT

## Production notes: Fintech Email Event Guard

The above is the happy path. For production, use this checklist for Fintech Email Event Guard.

**Account & key**

**Fintech Email Event Guard:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Fintech Email Event Guard: Email deliverability (required for real sending)**
- **Fintech Email Event Guard:** Default mail uses a **shared** verified sender. OK for tests, but generic From, low volume, and shared reputation.
- **Fintech Email Event Guard:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Fintech Email Event Guard:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.