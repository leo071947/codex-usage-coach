// 账号信息：只读 ~/.codex/auth.json，本地解 id_token，不联网
import fs from 'node:fs';
import path from 'node:path';
import { codexHome } from './paths.mjs';

function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** 脱敏：demo@example.com -> dem**@example.com */
export function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const [name, domain] = email.split('@');
  const keep = name.slice(0, 3);
  return `${keep}${'*'.repeat(Math.max(2, Math.min(4, name.length - keep.length)))}@${domain}`;
}

export function readAccount() {
  const candidates = [path.join(codexHome(), 'auth.json')];
  for (const file of candidates) {
    try {
      const auth = JSON.parse(fs.readFileSync(file, 'utf8'));
      const idToken = auth?.tokens?.id_token;
      const claims = idToken ? decodeJwt(idToken) : null;
      const info = (claims && claims['https://api.openai.com/auth']) || {};
      return {
        email: claims?.email ?? null,
        plan: info.chatgpt_plan_type ?? null,
        accountId: info.chatgpt_account_id ?? auth?.tokens?.account_id ?? null,
        authMode: auth?.auth_mode ?? null,
        lastRefresh: auth?.last_refresh ?? null,
        expiresAt: claims?.exp ? claims.exp * 1000 : null,
      };
    } catch {
      // 试下一个位置
    }
  }
  return null;
}

export function planLabel(plan) {
  const map = { plus: 'Plus', pro: 'Pro', business: 'Business', enterprise: 'Enterprise', free: 'Free', team: 'Team' };
  if (!plan) return null;
  return map[String(plan).toLowerCase()] ?? String(plan);
}
