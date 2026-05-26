export const config = { runtime: 'edge' };

/*
  Secure Stripe Checkout session creator for Bidder Experts.
  - Uses STRIPE_SECRET_KEY from Vercel environment variables (NEVER hard-code it).
  - Calls Stripe's REST API directly via fetch (works in edge runtime, no SDK needed).
  - Returns a hosted Checkout URL; the client is redirected to Stripe's secure page,
    so raw card data never touches this site (keeps you PCI-compliant via Stripe).

  Setup (done once by you in Vercel):
    1. Create a Stripe account at https://stripe.com
    2. Get your Secret key from Stripe Dashboard > Developers > API keys
    3. In Vercel > your project > Settings > Environment Variables, add:
         STRIPE_SECRET_KEY = sk_live_xxx   (or sk_test_xxx while testing)
    4. Redeploy.
*/

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: corsHeaders
    });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Payment is not configured yet. Please set STRIPE_SECRET_KEY in Vercel.' }), {
      status: 500, headers: corsHeaders
    });
  }

  try {
    const body = await req.json();
    let { amount, description, email } = body;

    // --- validate amount (USD) ---
    amount = Number(amount);
    if (!amount || isNaN(amount) || amount < 5) {
      return new Response(JSON.stringify({ error: 'Please enter a valid amount (minimum $5).' }), {
        status: 400, headers: corsHeaders
      });
    }
    if (amount > 100000) {
      return new Response(JSON.stringify({ error: 'For amounts over $100,000 please contact us directly.' }), {
        status: 400, headers: corsHeaders
      });
    }

    const cents = Math.round(amount * 100);
    const origin = req.headers.get('origin') || 'https://www.bidderexperts.com';
    const productName = (description && String(description).slice(0, 120)) || 'Bidder Experts — Project Payment';

    // --- build Stripe Checkout Session via form-encoded REST call ---
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', origin + '/?payment=success');
    params.append('cancel_url', origin + '/?payment=cancelled');
    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][unit_amount]', String(cents));
    params.append('line_items[0][price_data][product_data][name]', productName);
    params.append('line_items[0][price_data][product_data][description]', 'Payment to Bidder Experts (Muhammad Abdullah Sohail)');
    if (email) params.append('customer_email', String(email).slice(0, 120));
    params.append('billing_address_collection', 'auto');

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await stripeRes.json();

    if (!stripeRes.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : 'Could not start checkout.';
      return new Response(JSON.stringify({ error: msg }), { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ url: data.url, id: data.id }), {
      status: 200, headers: corsHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server error: ' + (err && err.message ? err.message : 'unknown') }), {
      status: 500, headers: corsHeaders
    });
  }
}
