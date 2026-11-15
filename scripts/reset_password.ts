import { openDb } from '../server/db.js';
import crypto from 'node:crypto';

const hashPw = (pw: string) => {
  const s = crypto.randomBytes(16).toString('hex');
  return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex');
};

const db = openDb(process.env.DATABASE_PATH ?? './data/studio.db');
const email = (process.argv[2] || 'abhishek.suman854@gmail.com').toLowerCase().trim();
const newPassword = process.argv[3] || 'Auravo2026!';

if (newPassword.length < 8) {
  console.error('Password must be at least 8 characters long.');
  process.exit(1);
}

const user = db.prepare('SELECT id, email FROM users WHERE email=?').get(email) as any;
if (!user) {
  console.error(`User not found for email: ${email}`);
  process.exit(1);
}

const newHash = hashPw(newPassword);
db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(newHash, user.id);
// Invalidate any active sessions for this user so clean login occurs
db.prepare('DELETE FROM sessions WHERE userId=?').run(user.id);

console.log(`✅ Password successfully reset for ${email}`);
console.log(`🔑 New password: ${newPassword}`);

