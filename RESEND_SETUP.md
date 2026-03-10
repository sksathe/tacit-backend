# Resend Email Setup Guide

## Quick Setup (For Testing)

1. **Get your Resend API Key:**
   - Sign up at https://resend.com
   - Go to API Keys section
   - Create a new API key
   - Copy the key (starts with `re_`)

2. **Add to `server-api/.env`:**
   ```env
   RESEND_API_KEY=re_your_api_key_here
   ```

3. **For Testing (No Domain Verification Needed):**
   - The code now uses `onboarding@resend.dev` which works immediately
   - You can send emails to any address for testing
   - No domain verification required

4. **Restart your server:**
   ```bash
   cd server-api
   npm run dev
   ```

## Production Setup (Domain Verification)

For production, you'll need to verify your domain:

1. **Add Domain in Resend:**
   - Go to Resend Dashboard → Domains
   - Add your domain (e.g., `tacit.ai`)
   - Add the DNS records provided by Resend to your domain

2. **Update Email Service:**
   - Once verified, update `server-api/src/services/email.ts`:
   ```typescript
   from: 'Tacit <noreply@yourdomain.com>',
   ```

## Troubleshooting

### Email sending fails but meeting is created
- ✅ This is expected! The meeting creation succeeds even if email fails
- Check server logs for email error details
- Verify your `RESEND_API_KEY` is correct

### "Domain not verified" error
- Use `onboarding@resend.dev` for testing (already configured)
- Or verify your domain in Resend dashboard

### "Invalid API key" error
- Check that `RESEND_API_KEY` is set in `server-api/.env`
- Make sure there are no extra spaces or quotes
- Restart the server after adding the key

### Emails not received
- Check spam folder
- Verify the recipient email address is correct
- Check Resend dashboard → Emails for delivery status

## Current Configuration

The email service is configured to:
- ✅ Not block meeting creation if email fails
- ✅ Log detailed errors for debugging
- ✅ Use test domain for immediate testing
- ✅ Provide helpful error messages

## Testing

1. Schedule a session with your email address
2. Check server logs for email status
3. Check your inbox (and spam folder)
4. Check Resend dashboard → Emails for delivery status
