// "Sign in with ChatGPT" for a locally run app: lets the assistant use the
// signed-in person's ChatGPT plan instead of an API key.
//
// Implements OpenAI's documented flow for open-source / locally hosted apps
// (https://developers.openai.com/siwc/token-sharing-open-source): an OAuth
// authorization-code + PKCE flow on a loopback callback, where OpenAI issues
// a client ID to this installation during the first sign-in. No client secret.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ISSUER = (process.env.ASTROLABE_OPENAI_AUTH_BASE || 'https://auth.openai.com').replace(/\/+$/, '');
export const API_BASE = (process.env.ASTROLABE_OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AUTHORIZE = ISSUER + '/api/accounts/authorize';
const TOKEN = ISSUER + '/api/accounts/oauth/token';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const SHARE_SCOPE = 'chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';
const FIRST_PORT = 1455; // the port OpenAI's docs use for the first registration
const TERMINAL = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export class ChatGPTAuth {
  constructor(dir) {
    this.dir = dir;
    this.pending = null; // { server, timer, error }
    this.lastError = null;
    this.refreshing = null;
  }

  // ---- storage (owner-only files, written atomically) -------------------------
  file(name) {
    return path.join(this.dir, name);
  }
  read(name) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch {
      return null;
    }
  }
  write(name, data) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file(name + '.' + process.pid + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file(name));
  }
  /** A stable, random ID for this installation; kept across sign-ins and accounts. */
  hostId() {
    let h = this.read('chatgpt-host.json');
    if (!h?.ext_agent_host_id) {
      h = { ext_agent_host_id: 'urn:uuid:' + crypto.randomUUID() };
      this.write('chatgpt-host.json', h);
    }
    return h.ext_agent_host_id;
  }
  record() {
    return this.read('chatgpt-auth.json');
  }

  status() {
    const r = this.record();
    const signedIn = !!r?.access_token || !!r?.refresh_token;
    return {
      signedIn,
      email: signedIn ? r.email || null : null,
      sharing: signedIn && (r.scopes || []).includes(SHARE_SCOPE),
      pending: !!this.pending,
      error: this.lastError,
    };
  }

  // ---- sign-in -------------------------------------------------------------------
  /** Starts the loopback listener and returns the URL to open in the browser. */
  async startSignIn() {
    this.cancelPending();
    this.lastError = null;
    const saved = this.record();
    const issuedClient = saved?.client_id || null;
    const state = b64url(crypto.randomBytes(24));
    const nonce = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

    const server = http.createServer();
    // The first registration uses the documented port; later sign-ins may use any free port.
    const port = await listen(server, FIRST_PORT).catch((e) => {
      if (!issuedClient) throw new Error(`Port ${FIRST_PORT} is needed for the first ChatGPT sign-in but something else is using it. Close that program and try again.`);
      return listen(server, 0);
    });
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

    const q = new URLSearchParams({
      response_type: 'code',
      client_id: issuedClient || 'dynamic_agent_client',
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
      ext_agent_host_id: this.hostId(),
    });
    if (!issuedClient) q.set('agent_name_hint', 'Astrolabe');
    else {
      if (saved.id_token) q.set('id_token_hint', saved.id_token);
      if (saved.email) q.set('login_hint', saved.email);
    }

    const finish = (res, ok, message) => {
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Astrolabe</title><body style="font:16px/1.5 system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#fbfaf8;color:#1c1b1f"><div style="text-align:center;max-width:420px;padding:24px"><h2 style="margin:0 0 8px">${ok ? 'Signed in' : 'Sign-in didn’t finish'}</h2><p style="color:#6b6876;margin:0">${escapeHtml(message)}</p></div></body>`);
      this.cancelPending();
    };

    server.on('request', async (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        return res.end();
      }
      try {
        if (url.searchParams.get('state') !== state) throw new Error('The sign-in response didn’t match this request. Please start again.');
        const err = url.searchParams.get('error');
        if (err) throw new Error(url.searchParams.get('error_description') || `ChatGPT sign-in was not completed (${err}).`);
        const code = url.searchParams.get('code');
        const clientId = url.searchParams.get('client_id') || issuedClient;
        if (!code || !clientId) throw new Error('The sign-in response was incomplete.');
        // Keep the issued client ID before exchanging, so a retry reuses it.
        this.write('chatgpt-auth.json', { ...(saved || {}), client_id: clientId, ext_agent_host_id: this.hostId(), issuer: ISSUER });

        const tokens = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE });
        const claims = await verifyIdToken(tokens.id_token, { audience: clientId, nonce });
        const scopes = String(tokens.scope || url.searchParams.get('scope') || '').split(/[\s+]+/).filter(Boolean).sort();
        this.write('chatgpt-auth.json', {
          email: claims.email || null,
          issuer: ISSUER,
          subject: claims.sub,
          client_id: clientId,
          ext_agent_host_id: this.hostId(),
          id_token: tokens.id_token,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          token_type: tokens.token_type || 'Bearer',
          expires_in: tokens.expires_in || 3600,
          scopes,
          saved_at: new Date().toISOString(),
        });
        finish(res, true, scopes.includes(SHARE_SCOPE) ? 'You can close this tab and go back to Astrolabe.' : 'You are signed in, but permission to use your ChatGPT plan wasn’t granted, so the assistant can’t use it yet. Sign in again and allow plan usage.');
      } catch (e) {
        this.lastError = e.message;
        finish(res, false, e.message);
      }
    });

    const timer = setTimeout(() => {
      this.lastError = 'The sign-in window timed out. Start it again when you’re ready.';
      this.cancelPending();
    }, 5 * 60 * 1000);
    this.pending = { server, timer };
    return { url: `${AUTHORIZE}?${q}` };
  }

  cancelPending() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.server.close();
    this.pending.server.closeAllConnections?.();
    this.pending = null;
  }

  // ---- tokens --------------------------------------------------------------------
  /** A valid access token, refreshed if it is about to expire. */
  async accessToken() {
    const r = this.record();
    if (!r?.access_token && !r?.refresh_token) throw new AuthError('signin', 'Not signed in to ChatGPT. Open Settings and choose “Sign in with ChatGPT”.');
    if (!(r.scopes || []).includes(SHARE_SCOPE)) throw new AuthError('signin', 'You are signed in to ChatGPT, but plan usage wasn’t granted. Sign in again from Settings and allow it.');
    const expires = Date.parse(r.saved_at || 0) + (r.expires_in || 0) * 1000;
    if (r.access_token && Date.now() < expires - 90_000) return r.access_token;
    if (!r.refresh_token) throw new AuthError('signin', 'Your ChatGPT sign-in has expired. Sign in again from Settings.');
    // One refresh at a time: refresh tokens rotate, so two at once would invalidate each other.
    this.refreshing ||= this.refresh(r).finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async refresh(r) {
    let tokens;
    try {
      tokens = await tokenRequest({ grant_type: 'refresh_token', client_id: r.client_id, refresh_token: r.refresh_token, resource: RESOURCE });
    } catch (e) {
      if (TERMINAL.has(e.code)) {
        // Keep the issued client + host ID so the next sign-in reuses them.
        this.write('chatgpt-auth.json', { client_id: r.client_id, ext_agent_host_id: r.ext_agent_host_id, issuer: ISSUER, email: r.email, id_token: r.id_token });
        throw new AuthError('signin', 'Your ChatGPT sign-in has expired. Sign in again from Settings.');
      }
      throw new AuthError('connect', `Couldn’t refresh your ChatGPT sign-in (${e.message}). Try again in a moment.`);
    }
    const next = {
      ...r,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || r.refresh_token,
      id_token: tokens.id_token || r.id_token,
      expires_in: tokens.expires_in || 3600,
      scopes: tokens.scope ? String(tokens.scope).split(/[\s+]+/).filter(Boolean).sort() : r.scopes,
      saved_at: new Date().toISOString(),
    };
    this.write('chatgpt-auth.json', next);
    return next.access_token;
  }

  /** Revoke the session with OpenAI and forget the tokens (the issued client ID is kept). */
  async signOut() {
    this.cancelPending();
    const r = this.record();
    if (!r) return { revoked: true };
    let revoked = !r.refresh_token;
    if (r.refresh_token) {
      try {
        const conf = await discovery();
        if (conf.revocation_endpoint) {
          const res = await fetch(conf.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: r.refresh_token, token_type_hint: 'refresh_token', client_id: r.client_id }), signal: AbortSignal.timeout(8000) });
          revoked = res.status === 200;
        }
      } catch {}
    }
    this.write('chatgpt-auth.json', { client_id: r.client_id, ext_agent_host_id: r.ext_agent_host_id, issuer: ISSUER });
    return { revoked };
  }

  /** Models the signed-in account can use: [{ id, label }]. */
  async models() {
    const token = await this.accessToken();
    const res = await fetch(API_BASE + '/models', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`error ${res.status}`);
    const data = await res.json();
    return (data.models || []).filter((m) => m.visibility === 'list').map((m) => ({ id: m.slug, label: m.display_name || m.slug }));
  }
}

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body.error?.code || (typeof body.error === 'string' ? body.error : null) || `http_${res.status}`;
    const e = new Error(body.error_description || body.error?.message || code);
    e.code = code;
    throw e;
  }
  return body;
}

let discoveryCache = null;
async function discovery() {
  if (!discoveryCache) {
    const res = await fetch(ISSUER + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('Couldn’t read OpenAI’s sign-in configuration.');
    discoveryCache = await res.json();
  }
  return discoveryCache;
}

/** Check the ID token's signature against OpenAI's published keys, plus issuer, audience, expiry and nonce. */
async function verifyIdToken(idToken, { audience, nonce }) {
  const fail = () => {
    const e = new Error('ChatGPT returned a sign-in token that couldn’t be verified. Please try again.');
    e.code = 'invalid_id_token';
    return e;
  };
  if (!idToken || idToken.split('.').length !== 3) throw fail();
  const [h, p, sig] = idToken.split('.');
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString());
    claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  } catch {
    throw fail();
  }
  const conf = await discovery();
  const jwks = await fetch(conf.jwks_uri, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid) || (jwks.keys?.length === 1 && !header.kid ? jwks.keys[0] : null);
  if (!jwk) throw fail();
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const data = Buffer.from(`${h}.${p}`);
  const signature = Buffer.from(sig, 'base64url');
  let ok = false;
  if (header.alg === 'RS256') ok = crypto.verify('RSA-SHA256', data, key, signature);
  else if (header.alg === 'ES256') ok = crypto.verify('SHA256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ok || claims.iss !== (conf.issuer || ISSUER) || !aud.includes(audience) || claims.nonce !== nonce || !(claims.exp * 1000 > Date.now() - 60_000)) throw fail();
  return claims;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
