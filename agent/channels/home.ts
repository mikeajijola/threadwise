import { defineChannel, GET } from 'eve/channels';
import { page } from '../../ui/page';
import { audioScript } from '../../ui/audio';
export default defineChannel({ routes: [
    GET('/', async () => new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'x-content-type-options': 'nosniff' } })),
    GET('/audio-capture.js', async () => new Response(audioScript, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })),
] });
