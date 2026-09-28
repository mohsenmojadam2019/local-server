import pg from "pg";
import crypto from "node:crypto";
import { passwordHash } from "../shared/crypto.js";
const [email, password] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !email || !password || password.length < 12) { console.error("usage: DATABASE_URL=... node scripts/create-user.js EMAIL PASSWORD (password >= 12 chars)"); process.exit(2); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query("INSERT INTO users(id,email,password_hash,email_verified) VALUES($1,$2,$3,true)", [crypto.randomUUID(), email.toLowerCase(), await passwordHash(password)]);
await pool.end(); console.log(`created ${email.toLowerCase()}`);
