import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TWILIO_NUMBER = process.env.TWILIO_NUMBER || '+1 (980) 499-5308';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
/** From address. Use onboarding@resend.dev for testing (no domain verification). Set EMAIL_FROM for production. */
const EMAIL_FROM = process.env.EMAIL_FROM || 'Tacit <onboarding@resend.dev>';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export interface AgentCardForEmail {
  name: string;
  tagline: string;
  role: string;
  persona: string;
  description: string;
  descriptionContinued?: string;
  specialties: string[];
}

export interface MeetingInviteEmailParams {
  inviteeName: string;
  inviteeEmail: string;
  meetingTitle: string;
  meetingCode: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  agenda?: string;
  agentName?: string;
  agentCard?: AgentCardForEmail;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSessionScheduledHtml(params: {
  first_name: string;
  date_human: string;
  time_human: string;
  timezone: string;
  call_title: string;
  agent_name: string;
  twilio_number: string;
  access_code: string;
  agenda_text: string;
  agent_card?: AgentCardForEmail;
}): string {
  const {
    first_name,
    date_human,
    time_human,
    timezone,
    call_title,
    agent_name,
    twilio_number,
    access_code,
    agenda_text,
    agent_card,
  } = params;
  const f = escapeHtml;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Scheduled</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #020617;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #020617; padding: 24px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #020617; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 45px rgba(0,0,0,0.75); border: 1px solid #22c55e33;">
          <!-- Header: dark gradient with Tacit green accent -->
          <tr>
            <td style="background-color: #020617; background: radial-gradient(circle at top left, #22c55e33 0%, transparent 55%), radial-gradient(circle at bottom right, #0ea5e933 0%, transparent 55%), linear-gradient(135deg, #020617 0%, #020617 55%, #020617 100%); padding: 28px 28px 22px; text-align: center; border-bottom: 1px solid #22c55e33;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="text-align: left;">
                    <span style="font-size: 12px; font-weight: 700; color: #bbf7d0; letter-spacing: 0.18em; text-transform: uppercase;">TACIT</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 16px; text-align: center;">
                    <span style="display:inline-block; font-size: 24px; line-height: 1; margin-right: 4px;">📞</span>
                    <span style="display: inline-block; font-size: 24px; font-weight: 800; color: #e5fdf5; margin-left: 2px; vertical-align: middle;">Session Scheduled</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 12px; text-align: center;">
                    <p style="margin: 0; font-size: 14px; color: #86efac; font-weight: 500;">Hi ${f(first_name)}, your Tacit phone session is confirmed.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Main content -->
          <tr>
            <td style="padding: 24px 24px 28px; background: radial-gradient(circle at top, #0b1120 0%, #020617 52%, #020617 100%);">
              <!-- Session Details card -->
              <p style="margin: 0 0 12px; font-size: 15px; font-weight: 700; color: #bbf7d0;">Session Details</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: radial-gradient(circle at top left, #0f172a 0%, #020617 60%); border-radius: 14px; border: 1px solid #22c55e22; padding: 18px 18px 16px;">
                <tr>
                  <td style="padding: 6px 0;">
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b;">When</span><br>
                    <span style="font-size: 14px; font-weight: 600; color: #e5e7eb;">${f(date_human)} &#8226; ${f(time_human)} (${f(timezone)})</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0;">
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b;">Session Title</span><br>
                    <span style="font-size: 14px; font-weight: 600; color: #e5e7eb;">${f(call_title)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0;">
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b;">Agent</span><br>
                    <span style="font-size: 14px; font-weight: 600; color: #bbf7d0;">${f(agent_name)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0;">
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b;">Call-in Number</span><br>
                    <span style="font-size: 14px; font-weight: 600; color: #e5e7eb;">${f(twilio_number)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0;">
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b;">Access Code</span><br>
                    <span style="font-size: 16px; font-weight: 700; color: #22c55e;">${f(access_code)}</span>
                  </td>
                </tr>
              </table>
${agent_card ? `
              <!-- Agent card -->
              <p style="margin: 22px 0 10px; font-size: 15px; font-weight: 700; color: #bbf7d0;">Your session agent</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: radial-gradient(circle at top, #0f172a 0%, #020617 60%); border-radius: 14px; border: 1px solid #22c55e22; padding: 18px;">
                <tr><td>
                  <p style="margin: 0 0 4px; font-size: 18px; font-weight: 700; color: #e5e7eb;">${f(agent_card.name)}</p>
                  <p style="margin: 0 0 12px; font-size: 13px; font-weight: 600; color: #22c55e;">${f(agent_card.tagline)}</p>
                  <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b;">Role</p>
                  <p style="margin: 0 0 10px; font-size: 13px; color: #cbd5f5;">${f(agent_card.role)}</p>
                  <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b;">Persona</p>
                  <p style="margin: 0 0 10px; font-size: 13px; color: #cbd5f5;">${f(agent_card.persona)}</p>
                  <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b;">Description</p>
                  <p style="margin: 0 0 6px; font-size: 13px; color: #e5e7eb; line-height: 1.5;">${f(agent_card.description)}</p>
                  ${agent_card.descriptionContinued ? `<p style="margin: 0 0 10px; font-size: 13px; color: #e5e7eb; line-height: 1.5;">${f(agent_card.descriptionContinued)}</p>` : ''}
                  <p style="margin: 10px 0 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b;">Specialties</p>
                  <ul style="margin: 0 0 0 18px; padding: 0; font-size: 13px; color: #e5e7eb; line-height: 1.6;">
                    ${agent_card.specialties.map((s) => `<li style="margin: 2px 0; color: #e5e7eb;"><span style="color: #22c55e;">•</span> ${f(s)}</li>`).join('')}
                  </ul>
                </td></tr>
              </table>
` : ''}

              <p style="margin: 20px 0 6px; font-size: 15px; font-weight: 700; color: #bbf7d0;">How to join</p>
              <p style="margin: 0 0 20px; font-size: 14px; color: #cbd5f5; line-height: 1.5;">Dial ${f(
                twilio_number,
              )}, say your name when prompted, then enter access code ${f(access_code)}.</p>

              <p style="margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #bbf7d0;">Agenda</p>
              <p style="margin: 0; font-size: 14px; color: #cbd5f5; line-height: 1.5;">${f(agenda_text)}</p>

              <p style="margin: 28px 0 0; padding-top: 18px; border-top: 1px solid #111827; font-size: 11px; color: #6b7280;">If you didn't schedule this session, you can safely ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export type SendMeetingInviteResult = { ok: true } | { ok: false; error: string };

export async function sendMeetingInviteEmail(params: MeetingInviteEmailParams): Promise<SendMeetingInviteResult> {
  if (!resend) {
    console.warn('⚠️ Resend API key not configured, skipping email send');
    console.warn('💡 Set RESEND_API_KEY in server-api/.env to enable email sending');
    return { ok: false, error: 'Email not configured (RESEND_API_KEY missing)' };
  }

  const { inviteeName, inviteeEmail, meetingTitle, meetingCode, scheduledStartAt, scheduledEndAt, agenda, agentName, agentCard } = params;

  const first_name = inviteeName.split(/\s+/)[0] || inviteeName;
  const start = new Date(scheduledStartAt);
  const date_human = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time_human = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const agenda_text = agenda && agenda.trim() ? agenda.trim() : 'No agenda provided.';

  const html = buildSessionScheduledHtml({
    first_name,
    date_human,
    time_human,
    timezone,
    call_title: meetingTitle,
    agent_name: agentName || agentCard?.name || 'Tacit Voice Agent',
    twilio_number: TWILIO_NUMBER,
    access_code: meetingCode,
    agenda_text,
    agent_card: agentCard,
  });

  const textBody = `
Hello ${inviteeName},

Your phone session is confirmed.

When: ${date_human} at ${time_human} (${timezone})
Session: ${meetingTitle}
Call-in: ${TWILIO_NUMBER}
Access code: ${meetingCode}

How to join: Dial ${TWILIO_NUMBER}, say your name when prompted, then enter access code ${meetingCode}.

Agenda: ${agenda_text}

— Tacit
  `.trim();

  try {
    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to: inviteeEmail,
      subject: `Session Scheduled: ${meetingTitle}`,
      text: textBody,
      html,
    });

    console.log(`✅ Email sent successfully to ${inviteeEmail}:`, (result as { data?: { id?: string } })?.data?.id ?? result);
    return { ok: true };
  } catch (error: any) {
    console.error(`❌ Failed to send email to ${inviteeEmail}:`, error);
    console.error('Error details:', {
      message: error?.message,
      name: error?.name,
      statusCode: error?.statusCode,
    });
    if (error?.message?.includes('domain')) {
      console.error('💡 Tip: Set EMAIL_FROM=Tacit <onboarding@resend.dev> in server-api/.env for testing');
    }
    if (error?.message?.includes('API key')) {
      console.error('💡 Tip: Check RESEND_API_KEY in server-api/.env');
    }
    return { ok: false, error: error?.message || 'Failed to send email' };
  }
}
