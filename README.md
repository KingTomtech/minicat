# Lenco Payments Dashboard v2.1

A modern admin dashboard for managing Lenco payment collections (Mobile Money & Card) in Zambia.

## Features

- 🔐 **Secure Authentication** - Supabase-based login system
- 📊 **Real-time Dashboard** - View total balance, pending, successful, and failed transactions
- 📱 **Mobile Money Collections** - Initiate MTN, Airtel, and Zamtel payments
- 💳 **Card Collections** - Process encrypted card payments
- 🔍 **Search & Filter** - Filter by status, channel, or search by reference
- 📋 **Transaction Details** - View complete transaction information and Lenco responses
- 🔄 **Status Checking** - Manually check transaction status from Lenco
- 🔔 **Toast Notifications** - Beautiful success/error notifications
- 📈 **Statistics** - Daily transaction summaries and amounts

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Admin Dashboard│────▶│  Cloudflare Worker│────▶│  Lenco API  │
│  (HTML/JS)      │     │  (worker.js)      │     │  (v2.0)     │
└─────────────────┘     └──────────────────┘     └─────────────┘
                              │
                              ▼
                        ┌─────────────┐
                        │   Supabase  │
                        │  (Database) │
                        └─────────────┘
```

## Files

- `admin-dashboard.html` - Complete frontend dashboard (single file)
- `worker.js` - Cloudflare Worker backend
- `wrangler.toml` - Worker configuration (create this)

## Setup

### 1. Cloudflare Worker Configuration

Create a `wrangler.toml` file:

```toml
name = "lenco-payments-worker"
main = "worker.js"
compatibility_date = "2024-01-01"

[vars]
ALLOWED_ORIGIN = "*"
REQUIRE_API_KEY = "false"

# Add your secrets via wrangler secret put
# SUPABASE_URL
# SUPABASE_ANON_KEY
# SUPABASE_SERVICE_ROLE
```

### 2. Set Environment Variables

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE
```

### 3. Deploy Worker

```bash
wrangler deploy
```

### 4. Update Dashboard

Edit `admin-dashboard.html` line 356 to set your worker URL if different:

```javascript
const WORKER_URL = "https://your-worker.your-subdomain.workers.dev";
```

Your organization ID is already set: `67e9f077-4fcc-4741-b20a-64be71230892`

## Supabase Schema Required

Ensure these tables exist in your Supabase project:

- `organizations` - Organization details
- `organization_lenco_config` - Lenco API keys per org
- `lenco_collections` - Transaction records
- `webhook_events` - Webhook logs
- `organization_api_keys` - API key management (optional)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/config` | GET | Returns Supabase configuration |
| `/api/collections` | GET | List all collections for org |
| `/api/collect/mobile-money` | POST | Create mobile money collection |
| `/api/collect/card` | POST | Create card collection |
| `/api/collections/:ref/status` | GET | Check collection status |
| `/webhook` | POST | Lenco webhook handler |

## Usage

1. Open `admin-dashboard.html` in a browser
2. Login with your Supabase credentials
3. View dashboard statistics
4. Create new collections using the action buttons
5. Search, filter, and view transaction details
6. Manually check status if needed

## Security Notes

- The dashboard uses Supabase authentication
- Worker validates API keys if `REQUIRE_API_KEY` is enabled
- Webhooks are verified using HMAC SHA-512 signatures
- All sensitive data should be stored as Worker secrets

## Support

For issues, check:
1. Worker logs in Cloudflare Dashboard
2. Supabase logs for database errors
3. Browser console for frontend errors
