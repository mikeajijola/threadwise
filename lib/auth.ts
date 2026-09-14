import { createHash, timingSafeEqual } from 'node:crypto';
import { type AuthFn } from 'eve/channels/auth';
export const operatorAuth: AuthFn<Request> = async request => {
  const expected = process.env.COPILOT_PASSWORD;
  const header = request.headers.get('authorization') || '';
  if (!expected || !header.startsWith('Bearer ')) return null;
  const hash = (s: string) => createHash('sha256').update(s).digest();
  if (!timingSafeEqual(hash(header.slice(7)), hash(expected))) return null;
  return { authenticator: 'operator', principalId: 'operator', principalType: 'user', attributes: {} };
};
