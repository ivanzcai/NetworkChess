import { Resend } from 'resend';
import crypto from 'crypto';

const apiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.RESEND_FROM_ADDRESS || 'SkyMate <noreply@skymate.local>';
const fromName = process.env.RESEND_FROM_NAME || 'SkyMate';
const isDev = !apiKey;

let resend: Resend | null = null;
if (apiKey) resend = new Resend(apiKey);

export interface SentMagicLink {
  success: boolean;
  devCode?: string;
  error?: string;
}

export function isEmailDevMode(): boolean {
  return isDev;
}

export function generateSixDigitCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function hashMagicCode(code: string, email: string): string {
  return crypto
    .createHash('sha256')
    .update(code + email.toLowerCase().trim() + 'chess-magic-salt')
    .digest('hex');
}

export async function sendMagicCodeEmail(email: string, code: string): Promise<SentMagicLink> {
  if (isDev || !resend) {
    console.log('\n================================\n[DEV MAGIC LINK] for ' + email + '\ncode: ' + code + '\n================================\n');
    return { success: true, devCode: code };
  }
  try {
    await resend.emails.send({
      from: fromAddress,
      to: email,
      subject: fromName + ' verification code',
      text: 'Your ' + fromName + ' verification code is: ' + code + '\n\nThis code expires in 10 minutes. If you did not request it, you can safely ignore this email.\n',
    });
    return { success: true };
  } catch (err) {
    console.error('[email] Failed to send magic code', err);
    return { success: false, error: 'Failed to send verification email' };
  }
}
