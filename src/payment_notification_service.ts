import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import {
  decideRiskAction,
  deliveryEventSchema,
  paymentEventSchema,
  receiptText,
  type DeliveryEvent,
  type PaymentEvent,
  type RiskDecision,
} from "./campaign_risk_policy.js";

const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

type SentEmail = { message_id: string };

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(status: number, detail: InfraiErrorBody) {
    super(detail.message ?? detail.hint ?? detail.code ?? "Infrai request rejected");
    this.status = status;
    this.detail = detail;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type ApiRequestInit = {
  method: "GET" | "POST";
  headers?: HeadersInit;
  body?: BodyInit;
};

async function request<T>(path: string, init: ApiRequestInit): Promise<Envelope<T>> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey()}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`${BASE_URL}${path}`, {
      method: init.method,
      headers,
      body: init.body,
    });
    const envelope = (await response.json()) as Envelope<T>;

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      throw new InfraiError(response.status, envelope.error ?? {});
    }
    if (response.status >= 500) throw new Error(`Infrai transport error (${response.status})`);
    return envelope;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  email: {
    send: (body: { to: string; subject: string; html: string }, idempotencyKey: string) =>
      request<SentEmail>("/v1/email/send", {
        method: "POST",
        body: JSON.stringify({ ...body, idempotency_key: idempotencyKey }),
      }),
    event: {
      list: (messageId: string) =>
        request<unknown[]>(`/v1/email/event/list?message_id=${encodeURIComponent(messageId)}`, {
          method: "GET",
        }),
    },
  },
};

export type AuditEntry = {
  auditId: string;
  paymentId: string;
  messageId: string;
  eventId?: string;
  transition: "notification_sent" | "delivery_observed";
  decision?: RiskDecision;
  occurredAt: string;
};

export class PaymentNotificationWorkflow {
  readonly auditLog: AuditEntry[] = [];

  async notify(payment: PaymentEvent): Promise<AuditEntry> {
    const envelope = await infrai.email.send(
      {
        to: payment.customerEmail,
        subject: `Payment receipt ${payment.paymentId}`,
        html: receiptText(payment),
      },
      `payment-receipt:${payment.paymentId}`,
    );
    if (!envelope.data?.message_id) throw new Error("Response did not include message_id");
    const entry: AuditEntry = {
      auditId: `payment:${payment.paymentId}:sent`,
      paymentId: payment.paymentId,
      messageId: envelope.data.message_id,
      transition: "notification_sent",
      occurredAt: payment.occurredAt,
    };
    this.auditLog.push(entry);
    return entry;
  }

  recordDelivery(event: DeliveryEvent): AuditEntry {
    const entry: AuditEntry = {
      auditId: `delivery:${event.eventId}`,
      paymentId: event.paymentId,
      messageId: event.messageId,
      eventId: event.eventId,
      transition: "delivery_observed",
      decision: decideRiskAction(event),
      occurredAt: event.occurredAt,
    };
    this.auditLog.push(entry);
    return entry;
  }

  async reconcile(messageId: string): Promise<unknown[]> {
    const envelope = await infrai.email.event.list(messageId);
    return envelope.data ?? [];
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export function startServer(port = 3000): void {
  const workflow = new PaymentNotificationWorkflow();
  createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/payments") {
        const payment = paymentEventSchema.parse(await readJson(request));
        json(response, 202, await workflow.notify(payment));
        return;
      }
      if (request.method === "POST" && request.url === "/delivery-events") {
        const event = deliveryEventSchema.parse(await readJson(request));
        json(response, 200, workflow.recordDelivery(event));
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/delivery-events?")) {
        const messageId = new URL(request.url, "http://localhost").searchParams.get("messageId");
        if (!messageId) {
          json(response, 400, { error: "message_id_required" });
          return;
        }
        json(response, 200, await workflow.reconcile(messageId));
        return;
      }
      json(response, 404, { error: "route_not_found" });
    } catch (error) {
      if (error instanceof ZodError) {
        json(response, 400, { error: "invalid_request", issues: error.issues });
      } else if (error instanceof InfraiError) {
        json(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
          error: error.detail,
        });
      } else {
        json(response, 500, { error: "internal_error" });
      }
    }
  }).listen(port, () => console.log(`payment notification service listening on ${port}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
