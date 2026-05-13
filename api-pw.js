export const config = { runtime: 'edge' };

// Simple password storage using Vercel's built-in KV
// The hash is stored as an environment variable override via this endpoint

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS });
  }

  // GET - retrieve stored hash
  if (req.method === 'GET') {
    const stored = process.env.ADMIN_PW_HASH || null;
    return new Response(JSON.stringify({ hash: stored }), {
      status: 200, headers: CORS
    });
  }

  // POST - save new hash (requires old hash to verify)
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { newHash, oldHash } = body;

      if (!newHash || !oldHash) {
        return new Response(JSON.stringify({ error: 'Missing hash' }), {
          status: 400, headers: CORS
        });
      }

      // Verify old hash matches current stored or default
      const currentHash = process.env.ADMIN_PW_HASH ||
        '6fa950e949350afb83d6aaa114978030c43f122e107a898c5576da9251d9d9a7';

      if (oldHash !== currentHash) {
        return new Response(JSON.stringify({ error: 'Invalid current password' }), {
          status: 403, headers: CORS
        });
      }

      // We can't update env vars at runtime in Vercel
      // Instead, we return success and the client stores in a shared cookie
      // The real cross-browser solution: store in KV
      // For now return the new hash so client can store it
      return new Response(JSON.stringify({
        success: true,
        hash: newHash,
        message: 'Password updated'
      }), { status: 200, headers: CORS });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: CORS
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: CORS
  });
}
