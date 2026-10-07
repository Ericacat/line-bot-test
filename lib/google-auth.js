import { createSign } from 'node:crypto';

export function serviceAccount() {
    const account = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
    if (!account.client_email || !account.private_key) throw new Error('Google service account not configured');
    return account;
}

let cachedToken;
let pendingToken;

export async function googleAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
        const account = serviceAccount();
        const now = Math.floor(Date.now() / 1000);
        const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
            iss: account.client_email,
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600,
            scope: 'https://www.googleapis.com/auth/cloud-platform',
        })}`;
        const signer = createSign('RSA-SHA256');
        signer.update(unsigned);
        const jwt = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`;
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
        });
        if (!response.ok) throw new Error(`Google authentication failed (${response.status})`);
        const data = await response.json();
        if (!data.access_token || !Number.isFinite(data.expires_in)) throw new Error('Invalid Google token response');
        cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
        return cachedToken.value;
    })();
    try {
        return await pendingToken;
    } finally {
        pendingToken = undefined;
    }
}
