import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { emailFailed } from '../lib/errors';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  /** Body contains a secret (reset link). Not persisted when real SMTP delivery is used. */
  sensitive?: boolean;
}

let transporter: Transporter | null = null;
export const smtpConfigured = () => Boolean(env.SMTP_HOST);

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/**
 * Email abstraction.
 *  - SMTP_HOST set   → delivered through nodemailer.
 *  - SMTP_HOST empty → development mode: the message is logged and stored in EmailLog,
 *                      visible to admins under Settings → Dev outbox. Nothing leaves the server.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ delivered: boolean; mode: 'smtp' | 'dev' }> {
  const attachmentNote = msg.attachments?.length
    ? `\n\n[Attachments: ${msg.attachments.map((a) => a.filename).join(', ')}]`
    : '';
  if (!smtpConfigured()) {
    await prisma.emailLog.create({
      data: { to: msg.to, subject: msg.subject, body: msg.text + attachmentNote, status: 'LOGGED' },
    });
    logger.info({ to: msg.to, subject: msg.subject }, '📧 [dev mail] email logged (SMTP not configured)');
    if (!env.isTest && !env.isProd) {
       
      console.log(`\n──── DEV EMAIL to ${msg.to} ────\nSubject: ${msg.subject}\n\n${msg.text}${attachmentNote}\n────────────────────────────\n`);
    }
    return { delivered: false, mode: 'dev' };
  }
  try {
    await getTransporter().sendMail({
      from: env.MAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      attachments: msg.attachments,
    });
    await prisma.emailLog.create({
      data: {
        to: msg.to,
        subject: msg.subject,
        body: msg.sensitive ? '[sensitive content not stored]' : msg.text + attachmentNote,
        status: 'SENT',
      },
    });
    return { delivered: true, mode: 'smtp' };
  } catch (err) {
    logger.error({ err, to: msg.to }, 'Email delivery failed');
    await prisma.emailLog.create({
      data: { to: msg.to, subject: msg.subject, body: '[not delivered]', status: 'FAILED', error: String(err).slice(0, 500) },
    });
    throw emailFailed();
  }
}
