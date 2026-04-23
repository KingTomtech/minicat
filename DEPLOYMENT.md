# Lenco Admin Dashboard - Deployment Guide

## Overview
This is a complete admin dashboard for Lenco Payments v2.0 with the following features:
- **Authentication**: Supabase-based login system
- **Dashboard Stats**: Real-time balance, pending, success, and failed transaction counts
- **Collections Management**: View, filter, and search all payment collections
- **Create Collections**: Mobile Money and Card payment collection forms
- **Transaction Details**: Modal view with full transaction information
- **Live Status Check**: Manually check transaction status from Lenco API
- **Toast Notifications**: Success/error feedback for all actions
- **Auto-refresh**: Data refreshes every 30 seconds

## Files
- `admin-dashboard.html` - The complete admin dashboard (single-file SPA)
- `worker.js` - Cloudflare Worker backend API
- `wrangler.toml` - Wrangler configuration

## Prerequisites

### 1. Supabase Setup
Ensure you have the following tables in your Supabase database:
- `users` - Authentication users
- `organizations` - Organization records
- `organization_lenco_config` - Lenco API configuration per org
- `lenco_collections` - Payment collection records
- `webhook_events` - Webhook event logs
- `organization_api_keys` - API key management

### 2. Environment Variables (Cloudflare Worker)
Set these in your `wrangler.toml` or Cloudflare dashboard:

```toml
[vars]
ALLOWED_ORIGIN = "*"  # Or your specific domain
REQUIRE_API_KEY = "false"  # Set to "true" to require x-api-key header

[secrets]
SUPABASE_URL = "https://your-project.supabase.co"
SUPABASE_ANON_KEY = "your-anon-key"
SUPABASE_SERVICE_ROLE = "your-service-role-key"
```

### 3. Organization ID
Your organization ID is already configured in the dashboard:
```
67e9f077-4fcc-4741-b20a-64be71230892
```

## Deployment Steps

### Step 1: Deploy the Worker
```bash
cd /workspace
wrangler deploy
```

### Step 2: Configure Supabase
1. Go to your Supabase project settings
2. Copy the `SUPABASE_URL` and `SUPABASE_ANON_KEY`
3. Add them as secrets to your worker:
   ```bash
   wrangler secret put SUPABASE_URL
   wrangler secret put SUPABASE_ANON_KEY
   wrangler secret put SUPABASE_SERVICE_ROLE
   ```

### Step 3: Create Admin User in Supabase
Use the Supabase dashboard or SQL editor to create an admin user:
```sql
-- In Supabase SQL Editor
INSERT INTO auth.users (email, encrypted_password, ...) 
VALUES ('admin@yourcompany.zm', 'hashed-password', ...);
```

Or use the Supabase Auth UI to create a user.

### Step 4: Access the Dashboard
1. Open `admin-dashboard.html` in a browser
2. Or host it on any static hosting service (Netlify, Vercel, GitHub Pages)
3. Login with your admin credentials

## Features

### Dashboard Statistics
- **Total Balance**: Sum of all successful transactions
- **Pending**: Count of pending/pay-offline transactions
- **Successful Today**: Count and amount of today's successful transactions
- **Failed Today**: Count of failed transactions requiring attention

### Collection Filters
- Filter by status (All, Pending, Pay Offline, Success, Failed)
- Filter by channel (All, Mobile Money, Card)
- Search by reference or external reference

### Create Mobile Money Collection
Fields required:
- Amount (ZMW)
- Operator (MTN, Airtel, Zamtel)
- Phone Number (+260 format)
- External Reference (your unique ID)
- Narration (optional)
- Fee Bearer (merchant/customer)

### Create Card Collection
Fields required:
- Amount (ZMW)
- External Reference
- Encrypted Card Data (JWE format)
- Narration (optional)

### Transaction Details Modal
Shows:
- Reference & External Reference
- Channel & Status
- Amount & Currency
- Operator & Phone (for mobile money)
- Fee Bearer
- Initiated & Completed timestamps
- Fee amount
- Full Lenco API response

### Live Status Check
Click "Check Status" in the details modal to:
1. Query Lenco API for latest status
2. Update local database record
3. Refresh dashboard statistics

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/config` | GET | Returns Supabase configuration |
| `/api/collections` | GET | List all collections for org |
| `/api/collections/:ref/status` | GET | Check status of specific collection |
| `/api/collect/mobile-money` | POST | Create mobile money collection |
| `/api/collect/card` | POST | Create card collection |
| `/webhook` | POST | Lenco webhook handler |

## Security Notes

1. **API Key Protection**: Set `REQUIRE_API_KEY = "true"` to require `x-api-key` header for API calls
2. **CORS**: Configure `ALLOWED_ORIGIN` to restrict access to specific domains
3. **Supabase RLS**: Enable Row Level Security policies in Supabase
4. **Webhook Signature**: All webhooks are verified using HMAC SHA-512

## Troubleshooting

### Login Fails
- Verify Supabase credentials in worker secrets
- Check that user exists in Supabase Auth
- Ensure `/config` endpoint returns valid JSON

### Collections Don't Load
- Verify organization_id is correct
- Check that `lenco_collections` table has data
- Ensure worker can access Supabase (check CORS)

### Mobile Money Collection Fails
- Verify Lenco API key is configured in `organization_lenco_config`
- Check phone number format (+260XXXXXXXXX)
- Ensure operator value is valid (mtn, airtel, zamtel)

### Webhooks Not Working
- Verify webhook URL is registered in Lenco dashboard
- Check webhook secret in `organization_lenco_config`
- Review `webhook_events` table for logged events

## Support

For issues with Lenco API, refer to: https://lenco-api.readme.io/v2.0/reference/

For Supabase issues, check: https://supabase.com/docs
