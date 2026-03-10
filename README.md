## tacit-backend: server-api

Express REST API for Tacit.

### Run locally

```bash
cd server-api
npm install
cp .env.example .env
npm run dev
```

### Key environment variables
- **Supabase**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **CORS**: `FRONTEND_ORIGINS` (comma-separated), optional `CORS_ALLOW_NGROK`
- **Email**: `RESEND_API_KEY`, optional `EMAIL_FROM`
- **Telephony**: `TWILIO_NUMBER`

### CORS / multi-domain deployments
Set `FRONTEND_ORIGINS` to include your deployed frontend domain(s), for example:

```text
FRONTEND_ORIGINS=https://app.example.com,https://preview--tacit-frontend.vercel.app
```
