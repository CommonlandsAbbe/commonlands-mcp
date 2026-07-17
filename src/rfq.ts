import { fetchWithTimeout } from './http-safety';

/**
 * submit_rfq — let an assistant forward a buyer's request-for-quote or
 * engineering question to the Commonlands sales/engineering inbox.
 *
 * Safety model:
 * - The recipient is FIXED to the Commonlands inbox from server config
 *   (RFQ_TO_EMAIL). An agent can never choose the destination, so this cannot
 *   be used to send mail to arbitrary third parties.
 * - The buyer's own reply-to email is required so Commonlands can respond; it
 *   is validated and only used as the SendGrid reply-to.
 * - Outbound is limited to the allowlisted SendGrid API host.
 * - Env-gated: with no SENDGRID_API_KEY / RFQ_TO_EMAIL / RFQ_FROM_EMAIL, the
 *   tool stays inert and returns a routed handoff to the public contact page
 *   instead of failing (parity with the other live integrations).
 * - Writes nothing to Shopify, orders, customers, or inventory.
 */

export interface RfqEnv {
  SENDGRID_API_KEY?: string;
  // Recipient/sender accept either the *_EMAIL names or the shorter RFQ_TO /
  // RFQ_FROM names (whichever is set in Cloudflare). RFQ_FROM_NAME is optional.
  RFQ_TO_EMAIL?: string;
  RFQ_FROM_EMAIL?: string;
  RFQ_TO?: string;
  RFQ_FROM?: string;
  RFQ_FROM_NAME?: string;
}

function rfqToEmail(env: RfqEnv): string | undefined {
  return env.RFQ_TO_EMAIL ?? env.RFQ_TO;
}

function rfqFromEmail(env: RfqEnv): string | undefined {
  return env.RFQ_FROM_EMAIL ?? env.RFQ_FROM;
}

export interface RfqArgs {
  message?: unknown;
  email?: unknown;
  name?: unknown;
  company?: unknown;
  partNumbers?: unknown;
  sensor?: unknown;
  quantity?: unknown;
  application?: unknown;
  kind?: unknown;
}

const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';
const CONTACT_PAGE = 'https://commonlands.com/pages/contact';
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// Reject control characters other than tab/newline/carriage-return, so a
// multi-line message is fine but header-injection/control bytes are not.
// \p{Cc} avoids literal control chars in source (keeps eslint no-control-regex happy).
function hasDisallowedControlChars(value: string): boolean {
  return /\p{Cc}/u.test(value.replace(/[\t\n\r]/g, ''));
}

type RfqResult = Record<string, unknown>;

function baseResult(env: RfqEnv): RfqResult {
  const configured = Boolean(env.SENDGRID_API_KEY && rfqToEmail(env) && rfqFromEmail(env));
  return {
    schemaVersion: 'commonlands.rfq.v1',
    configured,
    channel: 'commonlands_engineering_inbox',
    contactPage: CONTACT_PAGE,
    safety: { sendsEmail: true, fixedRecipient: true, writesShopify: false, createsOrder: false, collectsPayment: false },
  };
}

function invalid(env: RfqEnv, message: string): RfqResult {
  return { ...baseResult(env), status: 'invalid_request', message };
}

function optionalText(value: unknown, field: string, max = 500): { value?: string } | { error: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') return { error: `Invalid params: ${field} must be a string` };
  const trimmed = value.trim();
  if (trimmed === '') return {};
  if (trimmed.length > max) return { error: `Invalid params: ${field} is too long (max ${max} characters)` };
  if (hasDisallowedControlChars(trimmed)) return { error: `Invalid params: ${field} contains unsupported characters` };
  return { value: trimmed };
}

export async function submitRfq(env: RfqEnv, args: RfqArgs): Promise<RfqResult> {
  // Required: a message/question and a reply-to email.
  const message = optionalText(args.message, 'message', 4000);
  if ('error' in message) return invalid(env, message.error);
  if (!message.value) return invalid(env, 'Invalid params: message is required (the buyer question or RFQ details)');

  const emailRaw = typeof args.email === 'string' ? args.email.trim() : '';
  if (!emailRaw) return invalid(env, 'Invalid params: email is required so Commonlands can reply to the buyer');
  if (emailRaw.length > 320 || !EMAIL_PATTERN.test(emailRaw)) return invalid(env, 'Invalid params: email is not a valid address');

  const fields: Record<string, string> = {};
  for (const [field, max] of [['name', 120], ['company', 200], ['sensor', 120], ['application', 500], ['kind', 40]] as const) {
    const parsed = optionalText((args as Record<string, unknown>)[field], field, max);
    if ('error' in parsed) return invalid(env, parsed.error);
    if (parsed.value) fields[field] = parsed.value;
  }

  // partNumbers: string or array of strings.
  const partList = Array.isArray(args.partNumbers) ? args.partNumbers : args.partNumbers === undefined ? [] : [args.partNumbers];
  const parts: string[] = [];
  for (const part of partList) {
    const parsed = optionalText(part, 'partNumbers', 60);
    if ('error' in parsed) return invalid(env, parsed.error);
    if (parsed.value) parts.push(parsed.value);
  }
  if (parts.length > 25) return invalid(env, 'Invalid params: partNumbers may include at most 25 entries');

  let quantity: number | undefined;
  if (args.quantity !== undefined) {
    if (typeof args.quantity !== 'number' || !Number.isFinite(args.quantity) || args.quantity < 1 || args.quantity > 1_000_000) {
      return invalid(env, 'Invalid params: quantity must be a positive number');
    }
    quantity = Math.trunc(args.quantity);
  }

  const summary = {
    kind: fields.kind ?? 'question',
    ...(fields.name ? { name: fields.name } : {}),
    email: emailRaw,
    ...(fields.company ? { company: fields.company } : {}),
    ...(parts.length ? { partNumbers: parts } : {}),
    ...(fields.sensor ? { sensor: fields.sensor } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(fields.application ? { application: fields.application } : {}),
    message: message.value,
  };

  // Not configured: return a routed handoff instead of failing.
  const toEmail = rfqToEmail(env);
  const fromEmail = rfqFromEmail(env);
  if (!env.SENDGRID_API_KEY || !toEmail || !fromEmail) {
    return {
      ...baseResult(env),
      status: 'not_configured',
      message: 'Email submission is not enabled on this server. Send the buyer to the Commonlands contact page with the details below.',
      handoff: { url: CONTACT_PAGE, prefill: summary },
    };
  }

  const label = summary.kind === 'rfq' ? 'RFQ' : 'Question';
  const subjectParts = [`Agentic ${label}`, fields.company, parts.length ? parts.join(', ') : undefined].filter(Boolean);
  const lines = [
    `Kind: ${summary.kind}`,
    fields.name ? `Name: ${fields.name}` : undefined,
    `Reply-to: ${emailRaw}`,
    fields.company ? `Company: ${fields.company}` : undefined,
    parts.length ? `Part numbers: ${parts.join(', ')}` : undefined,
    fields.sensor ? `Sensor: ${fields.sensor}` : undefined,
    quantity !== undefined ? `Quantity: ${quantity}` : undefined,
    fields.application ? `Application: ${fields.application}` : undefined,
    '',
    'Message:',
    message.value,
    '',
    'Submitted via the Commonlands MCP submit_rfq tool.',
  ].filter((line): line is string => line !== undefined);

  const payload = {
    personalizations: [{ to: [{ email: toEmail }] }],
    // from.name is optional; internal engineering-to-sales mail needs no display name.
    from: { email: fromEmail, ...(env.RFQ_FROM_NAME ? { name: env.RFQ_FROM_NAME } : {}) },
    reply_to: { email: emailRaw, ...(fields.name ? { name: fields.name } : {}) },
    subject: subjectParts.join(' - ').slice(0, 200),
    content: [{ type: 'text/plain', value: lines.join('\n') }],
  };

  try {
    const response = await fetchWithTimeout(SENDGRID_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 202) {
      return {
        ...baseResult(env),
        status: 'submitted',
        message: `Your ${label.toLowerCase()} was sent to the Commonlands engineering team. They reply by email, usually within one business day.`,
        summary,
      };
    }

    // SendGrid returns 4xx/5xx with a JSON error body; never surface the key.
    return {
      ...baseResult(env),
      status: 'delivery_failed',
      message: `The email service rejected the request (HTTP ${response.status}). Send the buyer to the Commonlands contact page instead.`,
      handoff: { url: CONTACT_PAGE, prefill: summary },
    };
  } catch {
    return {
      ...baseResult(env),
      status: 'delivery_failed',
      message: 'The email service could not be reached. Send the buyer to the Commonlands contact page instead.',
      handoff: { url: CONTACT_PAGE, prefill: summary },
    };
  }
}
