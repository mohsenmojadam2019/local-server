import pg from "pg";
import crypto from "node:crypto";
export class PostgresStore {
  constructor(connectionString) { this.pool = new pg.Pool({ connectionString }); }
  async close() { await this.pool.end(); }
  async query(sql, params = []) { return this.pool.query(sql, params); }
  async createUser({ email, passwordHash, emailVerified = true }) { const id = crypto.randomUUID(); const r = await this.query("INSERT INTO users(id,email,password_hash,email_verified) VALUES($1,$2,$3,$4) RETURNING *", [id, email.toLowerCase(), passwordHash, emailVerified]); return mapUser(r.rows[0]); }
  async getUserByEmail(email) { const r = await this.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase()]); return mapUser(r.rows[0]); }
  async getUser(id) { const r = await this.query("SELECT * FROM users WHERE id=$1", [id]); return mapUser(r.rows[0]); }
  async saveClient(c) { await this.query("INSERT INTO oauth_clients(client_id,redirect_uris,token_endpoint_auth_method) VALUES($1,$2,$3) ON CONFLICT(client_id) DO UPDATE SET redirect_uris=EXCLUDED.redirect_uris", [c.client_id, JSON.stringify(c.redirect_uris), c.token_endpoint_auth_method]); return c; }
  async getClient(id) { const r = await this.query("SELECT * FROM oauth_clients WHERE client_id=$1", [id]); return r.rows[0] && { client_id:r.rows[0].client_id, redirect_uris:r.rows[0].redirect_uris, token_endpoint_auth_method:r.rows[0].token_endpoint_auth_method }; }
  async saveAuthCode(c) { await this.query("INSERT INTO authorization_codes(code_hash,client_id,user_id,redirect_uri,resource,scope,code_challenge,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0))", [c.codeHash,c.clientId,c.userId,c.redirectUri,c.resource,c.scope,c.codeChallenge,c.expiresAt]); }
  async consumeAuthCode(hash) { const r = await this.query("UPDATE authorization_codes SET used_at=now() WHERE code_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING *", [hash]); const c=r.rows[0]; return c && { codeHash:c.code_hash,clientId:c.client_id,userId:c.user_id,redirectUri:c.redirect_uri,resource:c.resource,scope:c.scope,codeChallenge:c.code_challenge,expiresAt:new Date(c.expires_at).getTime() }; }
  async saveAccess(t) { await this.query("INSERT INTO access_tokens(token_hash,user_id,client_id,resource,scope,expires_at) VALUES($1,$2,$3,$4,$5,to_timestamp($6/1000.0))", [t.tokenHash,t.userId,t.clientId,t.resource,t.scope,t.expiresAt]); }
  async getAccess(raw) { const r=await this.query("SELECT * FROM access_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()", [hashToken(raw)]); const t=r.rows[0]; return t&&{tokenHash:t.token_hash,userId:t.user_id,clientId:t.client_id,resource:t.resource,scope:t.scope,expiresAt:new Date(t.expires_at).getTime()}; }
  async saveRefresh(t) { await this.query("INSERT INTO refresh_tokens(token_hash,user_id,client_id,resource,scope,expires_at) VALUES($1,$2,$3,$4,$5,to_timestamp($6/1000.0))", [t.tokenHash,t.userId,t.clientId,t.resource,t.scope,t.expiresAt]); }
  async getRefresh(raw) { const r=await this.query("SELECT * FROM refresh_tokens WHERE token_hash=$1",[hashToken(raw)]); const t=r.rows[0]; return t&&{tokenHash:t.token_hash,userId:t.user_id,clientId:t.client_id,resource:t.resource,scope:t.scope,expiresAt:new Date(t.expires_at).getTime(),revokedAt:t.revoked_at,replacedBy:t.replaced_by}; }
  async rotateRefresh(raw,next) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const oldResult = await client.query("UPDATE refresh_tokens SET revoked_at=now(),replaced_by=$2 WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() RETURNING *", [hashToken(raw), next.tokenHash]);
      if (!oldResult.rowCount) { await client.query("ROLLBACK"); return null; }
      const old = oldResult.rows[0];
      await client.query("INSERT INTO refresh_tokens(token_hash,user_id,client_id,resource,scope,expires_at) VALUES($1,$2,$3,$4,$5,to_timestamp($6/1000.0))", [next.tokenHash, next.userId, next.clientId, next.resource, next.scope, next.expiresAt]);
      await client.query("COMMIT");
      return { tokenHash: old.token_hash, userId: old.user_id, clientId: old.client_id, resource: old.resource, scope: old.scope, expiresAt: new Date(old.expires_at).getTime(), revokedAt: Date.now(), replacedBy: next.tokenHash };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async createEnrollment(c) { await this.query("INSERT INTO enrollment_codes(code_hash,user_id,expires_at) VALUES($1,$2,to_timestamp($3/1000.0))",[c.codeHash,c.userId,c.expiresAt]); }
  async consumeEnrollment(raw) { const r=await this.query("UPDATE enrollment_codes SET used_at=now() WHERE code_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING *",[hashToken(raw)]); const c=r.rows[0]; return c&&{codeHash:c.code_hash,userId:c.user_id,expiresAt:new Date(c.expires_at).getTime(),usedAt:Date.now()}; }
  async saveDevice(d) { await this.query("INSERT INTO devices(id,user_id,name,token_hash,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status",[d.id,d.userId,d.name,d.tokenHash,JSON.stringify(d.status)]); return d; }
  async listDevices(userId) { const r=await this.query("SELECT id,user_id,name,status,created_at,last_seen_at FROM devices WHERE user_id=$1",[userId]); return r.rows.map(d=>({id:d.id,userId:d.user_id,name:d.name,status:d.status,createdAt:d.created_at})); }
  async getDevice(userId,id) { const r=await this.query("SELECT * FROM devices WHERE user_id=$1 AND id=$2",[userId,id]); const d=r.rows[0]; return d&&{id:d.id,userId:d.user_id,name:d.name,tokenHash:d.token_hash,status:d.status}; }
  async getDeviceByToken(raw) { const r=await this.query("SELECT * FROM devices WHERE token_hash=$1",[hashToken(raw)]); const d=r.rows[0]; return d&&{id:d.id,userId:d.user_id,name:d.name,tokenHash:d.token_hash,status:d.status}; }
  async enqueueCall(c) { const r=await this.query("INSERT INTO remote_calls(id,user_id,device_id,tool,args,status,idempotency_key,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),to_timestamp($9/1000.0)) ON CONFLICT(id) DO NOTHING RETURNING *",[c.id,c.userId,c.deviceId,c.tool,JSON.stringify(c.args),c.status,c.idempotencyKey,c.createdAt,c.expiresAt]); return r.rows[0] ? c : (await this.getCall(c.id)); }
  async getCall(id) { await this.query("UPDATE remote_calls SET status='expired',error='call expired',completed_at=now() WHERE id=$1 AND status IN ('pending','executing') AND expires_at<=now()", [id]); const r=await this.query("SELECT * FROM remote_calls WHERE id=$1",[id]); return mapCall(r.rows[0]); }
  async claimPending(deviceId) { const c=await this.query("UPDATE remote_calls SET status='executing',claimed_at=now() WHERE id IN (SELECT id FROM remote_calls WHERE device_id=$1 AND (status='pending' OR (status='executing' AND claimed_at<now()-interval '2 minutes')) AND expires_at>now() FOR UPDATE SKIP LOCKED) RETURNING *",[deviceId]); return c.rows.map(mapCall); }
  async completeCall(id,status,result,error) { const r=await this.query("UPDATE remote_calls SET status=$2,result=$3,error=$4,completed_at=now() WHERE id=$1 AND status IN ('pending','executing') RETURNING *",[id,status,result==null?null:JSON.stringify(result),error??null]); return mapCall(r.rows[0]); }
  async auditEvent(e) { await this.query("INSERT INTO audit_log(user_id,device_id,call_id,event,metadata) VALUES($1,$2,$3,$4,$5)",[e.userId,e.deviceId,e.callId,e.event,JSON.stringify(e.metadata??{})]); }
}

const mapUser = r => r && { id:r.id,email:r.email,passwordHash:r.password_hash,emailVerified:r.email_verified,createdAt:r.created_at };
const mapCall = r => r && ({ id:r.id,userId:r.user_id,deviceId:r.device_id,tool:r.tool,args:r.args,status:r.status,result:r.result,error:r.error,createdAt:new Date(r.created_at).getTime(),expiresAt:new Date(r.expires_at).getTime(),claimedAt:r.claimed_at ? new Date(r.claimed_at).getTime() : null });
