import { DurableObject } from 'cloudflare:workers';
import { hashPassword, verifyPassword } from './password-kdf';

/** Internal computation only. No fetch handler, storage, logging, or retained credentials. */
export class PasswordCrypto extends DurableObject {
  async hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  async verify(encoded: string, password: string): Promise<boolean> {
    return verifyPassword(encoded, password);
  }
}
