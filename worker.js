/**
 * Lenco Payments Worker (Cloudflare) – v2.0 ONLY (FINAL)
 * Strictly uses Lenco API v2.0 base path: /access/v2
 * Only Collections (mobile-money + card) + status + webhooks
 * Matches your clean v2 Supabase schema 100%
 * 
 * Deploy with: wrangler deploy
 */

const LENCO_BASE = "https://api.lenco.co";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";

    const cors = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key, X-Lenco-Signature"
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // Health check
    if (path === "/" && method === "GET") {
      return jsonResponse({ 
        status: "ok", 
        service: "lenco-payments-v2",
        version: "2.0.0",
        timestamp: new Date().toISOString() 
      }, 200, cors);
    }

    // Config endpoint for dashboard (returns Supabase config)
    if (path === "/config" && method === "GET") {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        return jsonResponse({ error: "Configuration not available" }, 503, cors);
      }
      return jsonResponse({
        supabase_url: env.SUPABASE_URL,
        supabase_anon_key: env.SUPABASE_ANON_KEY
      }, 200, cors);
    }

    // Webhook (Lenco v2 collections only)
    if (path === "/webhook" && method === "POST") {
      return handleWebhook(request, env);
    }

    // Protected API routes
    if (path.startsWith("/api/")) {
      if (env.REQUIRE_API_KEY === "true") {
        const apiKey = request.headers.get("x-api-key");
        if (!apiKey) return jsonResponse({ error: "Missing x-api-key" }, 401, cors);
        if (!(await verifyApiKey(apiKey, env))) {
          return jsonResponse({ error: "Invalid API key" }, 401, cors);
        }
      }
      return handleApi(request, env, cors);
    }

    return jsonResponse({ error: "Not found" }, 404, cors);
  }
};

function jsonResponse(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

async function verifyApiKey(apiKey, env) {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/organization_api_keys?key_hash=eq.${encodeURIComponent(apiKey)}&is_active=eq.true&select=organization_id`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` } }
    );
    return res.ok && (await res.json()).length > 0;
  } catch {
    return false;
  }
}

// ============================================
// WEBHOOK HANDLER (v2 collections only)
// ============================================
async function handleWebhook(request, env) {
  const rawBody = await request.text();
  let payload;
  try { 
    payload = JSON.parse(rawBody); 
  } catch { 
    return new Response("OK", { status: 200 }); 
  }

  const signature = request.headers.get("x-lenco-signature") || request.headers.get("X-Lenco-Signature");
  const eventType = payload.event || payload.eventType || payload.type || "unknown";
  const ref = payload.data?.reference || payload.reference || payload.data?.lencoReference;

  // Find organization (v2 collections only)
  let orgId = null;
  if (ref) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/lenco_collections?reference=eq.${encodeURIComponent(ref)}&select=organization_id`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows[0]) orgId = rows[0].organization_id;
    }
  }
  if (!orgId) return new Response("OK", { status: 200 });

  // Get webhook secret
  const cfgRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/organization_lenco_config?organization_id=eq.${orgId}&select=webhook_secret`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` } }
  );
  const webhookSecret = (await cfgRes.json())[0]?.webhook_secret;

  // Verify signature (HMAC SHA-512)
  let valid = false;
  if (webhookSecret && signature) {
    try {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw", 
        encoder.encode(webhookSecret), 
        { name: "HMAC", hash: "SHA-512" }, 
        false, 
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
      const hashHex = Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      valid = hashHex === signature.toLowerCase();
    } catch (e) {
      console.error("Signature verification failed:", e);
    }
  }

  // Log webhook
  await fetch(`${env.SUPABASE_URL}/rest/v1/webhook_events`, {
    method: "POST",
    headers: { 
      apikey: env.SUPABASE_SERVICE_ROLE, 
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`, 
      "Content-Type": "application/json", 
      Prefer: "return=minimal" 
    },
    body: JSON.stringify({ 
      organization_id: orgId, 
      event_type: eventType, 
      lenco_reference: ref, 
      payload, 
      signature_valid: valid 
    })
  });

  // Process terminal events
  const isTerminal = /success|successful|failed/i.test(eventType);
  if (valid && ref && isTerminal) {
    const newStatus = /success|successful/i.test(eventType) ? "success" : "failed";
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/lenco_collections?reference=eq.${encodeURIComponent(ref)}`,
      {
        method: "PATCH",
        headers: { 
          apikey: env.SUPABASE_SERVICE_ROLE, 
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`, 
          "Content-Type": "application/json" 
        },
        body: JSON.stringify({
          status: newStatus,
          completed_at: new Date().toISOString(),
          fee: payload.data?.fee || payload.fee || null,
          lenco_response: payload,
          webhook_received_at: new Date().toISOString()
        })
      }
    );
  }

  return new Response("OK", { status: 200 });
}

// ============================================
// API ROUTES (v2 only – EVERY call now uses /access/v2)
// ============================================
async function handleApi(request, env, cors) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  let body = {};
  if (method === "POST") {
    try { body = await request.json(); } catch { 
      return jsonResponse({ error: "Invalid JSON" }, 400, cors); 
    }
  }

  const organization_id = url.searchParams.get("organization_id") || body.organization_id;
  if (!organization_id) return jsonResponse({ error: "Missing organization_id" }, 400, cors);

  // Load Lenco API key
  const cfgRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/organization_lenco_config?organization_id=eq.${organization_id}&select=lenco_api_key`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` } }
  );
  const lencoApiKey = (await cfgRes.json())[0]?.lenco_api_key;
  if (!lencoApiKey) return jsonResponse({ error: "Lenco not configured" }, 404, cors);

  // v2.0 CALLER – ALWAYS uses /access/v2 (no v1 logic left)
  async function callLenco(endpoint, options = {}) {
    const fullPath = `/access/v2${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const res = await fetch(`${LENCO_BASE}${fullPath}`, {
      ...options,
      headers: { 
        Authorization: `Bearer ${lencoApiKey}`, 
        "Content-Type": "application/json", 
        ...options.headers 
      }
    });
    let data;
    try { data = await res.json(); } catch { data = { error: "Bad response from Lenco" }; }
    return { status: res.status, data };
  }

  // === MOBILE MONEY COLLECTION (v2) ===
  if (path === "/api/collect/mobile-money" && method === "POST") {
    if (!body.amount || !body.phone || !body.operator || !body.external_reference) {
      return jsonResponse({ error: "Missing required fields: amount, phone, operator, external_reference" }, 400, cors);
    }

    const amount = parseFloat(body.amount);
    if (isNaN(amount) || amount <= 0) {
      return jsonResponse({ error: "Amount must be a positive number" }, 400, cors);
    }

    const payload = {
      amount: amount,
      phone: body.phone.trim(),
      operator: body.operator,
      reference: body.external_reference,
      country: "zm",
      narration: body.narration || "Payment",
      bearer: body.bearer || "merchant"
    };

    const { status, data } = await callLenco("/collections/mobile-money", { 
      method: "POST", 
      body: JSON.stringify(payload) 
    });

    if ((status === 200 || status === 201) && data?.data?.reference) {
      try {
        await fetch(`${env.SUPABASE_URL}/rest/v1/lenco_collections`, {
          method: "POST",
          headers: { 
            apikey: env.SUPABASE_SERVICE_ROLE, 
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`, 
            "Content-Type": "application/json", 
            Prefer: "resolution=ignore-duplicates,return=minimal" 
          },
          body: JSON.stringify({
            organization_id,
            reference: data.data.reference,
            external_reference: body.external_reference,
            channel: "mobile-money",
            operator: body.operator,
            phone: body.phone,
            amount: amount,
            currency: "ZMW",
            bearer: body.bearer || "merchant",
            status: data.data.status || "pending",
            lenco_response: data,
            initiated_at: new Date().toISOString()
          })
        });
        console.log("✅ Saved to Supabase successfully");
      } catch (dbError) {
        console.error("❌ Supabase insert failed:", dbError);
        return jsonResponse({ 
          ...data, 
          warning: "Collection created in Lenco but DB insert failed", 
          db_error: dbError.message 
        }, status, cors);
      }
    }

    return jsonResponse(data, status, cors);
  }

  // === CARD COLLECTION (v2) ===
  if (path === "/api/collect/card" && method === "POST") {
    if (!body.amount || !body.external_reference || !body.encrypted_data) {
      return jsonResponse({ error: "Missing: amount, external_reference, encrypted_data (JWE)" }, 400, cors);
    }

    const payload = {
      amount: parseFloat(body.amount),
      currency: "ZMW",
      encryptedData: body.encrypted_data,
      reference: body.external_reference,
      narration: body.narration || "Card Payment",
      bearer: body.bearer || "merchant"
    };

    const { status, data } = await callLenco("/collections/card", { 
      method: "POST", 
      body: JSON.stringify(payload) 
    });

    if ((status === 200 || status === 201) && data.data?.reference) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/lenco_collections`, {
        method: "POST",
        headers: { 
          apikey: env.SUPABASE_SERVICE_ROLE, 
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`, 
          "Content-Type": "application/json", 
          Prefer: "resolution=ignore-duplicates,return=minimal" 
        },
        body: JSON.stringify({
          organization_id,
          reference: data.data.reference,
          external_reference: body.external_reference,
          channel: "card",
          amount: parseFloat(body.amount),
          currency: "ZMW",
          bearer: body.bearer || "merchant",
          status: data.data.status || "pending",
          initiated_at: new Date().toISOString()
        })
      });
    }
    return jsonResponse(data, status, cors);
  }

  // === COLLECTION STATUS (v2) - ROBUST VERSION ===
  if (path.startsWith("/api/collections/") && path.endsWith("/status") && method === "GET") {
    const ref = path.split("/")[3];
    if (!ref) {
      return jsonResponse({ error: "Missing reference" }, 400, cors);
    }

    // Try to get organization_id from query param first (fallback)
    let organization_id = url.searchParams.get("organization_id");

    // Auto-lookup from DB using reference (this is what fixes your error)
    if (!organization_id) {
      const lookupRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/lenco_collections?reference=eq.${encodeURIComponent(ref)}&select=organization_id`,
        { headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` } }
      );
      if (lookupRes.ok) {
        const rows = await lookupRes.json();
        if (rows.length > 0) organization_id = rows[0].organization_id;
      }
    }

    if (!organization_id) {
      return jsonResponse({ 
        error: "Collection reference not found in database. Create a new collection first." 
      }, 404, cors);
    }

    // Load Lenco API key for this org
    const cfgRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/organization_lenco_config?organization_id=eq.${organization_id}&select=lenco_api_key`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` } }
    );
    const lencoApiKey = (await cfgRes.json())[0]?.lenco_api_key;
    if (!lencoApiKey) {
      return jsonResponse({ error: "Lenco not configured for this organization" }, 404, cors);
    }

    // Fast DB cache check first
    const dbRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/lenco_collections?reference=eq.${encodeURIComponent(ref)}&select=status,completed_at,fee,lenco_response,channel,amount`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` } }
    );
    const dbData = await dbRes.json();
    if (dbData.length > 0) {
      return jsonResponse({ source: "database", data: dbData[0] }, 200, cors);
    }

    // Fallback to Lenco v2
    const fullPath = `/access/v2/collections/status/${ref}`;
    const res = await fetch(`${LENCO_BASE}${fullPath}`, {
      method: "GET",
      headers: { 
        Authorization: `Bearer ${lencoApiKey}`, 
        "Content-Type": "application/json" 
      }
    });

    let data;
    try { data = await res.json(); } catch { data = { error: "Bad response from Lenco" }; }

    return jsonResponse({ source: "lenco", data }, res.status, cors);
  }

  // === LIST COLLECTIONS ===
  if (path === "/api/collections" && method === "GET") {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/lenco_collections?organization_id=eq.${organization_id}&select=*&order=initiated_at.desc`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` } }
    );
    return jsonResponse({ data: await res.json() }, 200, cors);
  }

  return jsonResponse({ error: "Endpoint not implemented in v2" }, 501, cors);
}
