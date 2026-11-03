// Authentification du portail personnel. Aucun mot de passe ni jeton n'est stocké en clair.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const COOKIE = 'mavie_session';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const USERNAME = /^[a-z0-9_]{3,20}$/;
const PASSWORD_MIN = 12;
const scrypt = (password, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(password, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key.toString('hex'))));
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');

function createAuth({ dataDir, trustProxy = false, log = () => {} }) {
  const dir = path.join(dataDir, 'auth');
  fs.mkdirSync(dir, { recursive: true });
  const accountFile = path.join(dir, 'accounts.json');
  const sessionFile = path.join(dir, 'sessions.json');
  const adminCodeFile = path.join(dir, 'admin-setup-code.txt');
  const adminClaimFile = path.join(dir, 'admin-claim.json');
  const accounts = fs.existsSync(accountFile) ? JSON.parse(fs.readFileSync(accountFile, 'utf8')) : [];
  const sessions = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, 'utf8')) : [];
  if (!Array.isArray(accounts) || !Array.isArray(sessions)) throw new Error('Fichiers des comptes invalides dans data/auth');
  const attempts = new Map();
  const signups = new Map();
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of attempts) { const recent = times.filter(t => now - t < 15 * 60 * 1000); if (recent.length) attempts.set(ip, recent); else attempts.delete(ip); }
    for (const [ip, times] of signups) { const recent = times.filter(t => now - t < 60 * 60 * 1000); if (recent.length) signups.set(ip, recent); else signups.delete(ip); }
  }, 60 * 60 * 1000);
  cleanupTimer.unref();
  const persist = (file, value) => {
    const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    fs.renameSync(temporary, file);
  };
  if (!accounts.some(a => a.role === 'admin') && (!fs.existsSync(adminClaimFile) || !fs.existsSync(adminCodeFile))) {
    for (const file of [adminCodeFile, adminClaimFile]) try { fs.rmSync(file, { force: true }); } catch {}
    const code = crypto.randomBytes(32).toString('base64url');
    persist(adminClaimFile, { hash: tokenHash(code), createdAt: new Date().toISOString() });
    fs.writeFileSync(adminCodeFile, `Code d’activation unique du compte administrateur :\n${code}\n\nÀ supprimer après utilisation. Ne le partage pas.\n`, { mode: 0o600 });
    log(`Code initial d’administration créé dans ${adminCodeFile}`);
  }
  if (accounts.some(a => a.role === 'admin')) { for (const file of [adminCodeFile, adminClaimFile]) try { fs.rmSync(file, { force: true }); } catch {} }
  const isSecure = req => {
    const ip = req.socket.remoteAddress || '';
    const host = String(req.headers.host || '').toLowerCase();
    const loopbackIp = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    const localTest = loopbackIp && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
    // Ne croire X-Forwarded-Proto que si la requête vient du proxy local (Caddy).
    return Boolean(req.socket.encrypted || localTest || (trustProxy && loopbackIp && req.headers['x-forwarded-proto'] === 'https'));
  };
  const send = (res, status, value, extra = {}) => {
    const body = Buffer.from(JSON.stringify(value));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(body);
  };
  const cookieHeader = (token, maxAge, secure) => `${COOKIE}=${token}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAge}`;
  function getSession(req) {
    const raw = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const hash = tokenHash(raw.slice(COOKIE.length + 1));
    const session = sessions.find(s => s.hash === hash && s.expiresAt > Date.now());
    return session ? { session, account: accounts.find(a => a.id === session.accountId) } : null;
  }
  function cleanSessions() {
    const before = sessions.length;
    for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].expiresAt <= Date.now() || !accounts.some(a => a.id === sessions[i].accountId)) sessions.splice(i, 1);
    if (sessions.length !== before) persist(sessionFile, sessions);
  }
  function originOkay(req) {
    try { return req.headers.origin && new URL(req.headers.origin).host === req.headers.host; }
    catch { return false; }
  }
  function rateOkay(req) {
    const now = Date.now(), ip = req.socket.remoteAddress || '?';
    const entries = (attempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
    if (entries.length >= 12) { attempts.set(ip, entries); return false; }
    entries.push(now); attempts.set(ip, entries); return true;
  }
  function signupRateOkay(req) {
    const now = Date.now(), ip = req.socket.remoteAddress || '?';
    const entries = (signups.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
    if (entries.length >= 3) { signups.set(ip, entries); return false; }
    entries.push(now); signups.set(ip, entries); return true;
  }
  async function body(req) {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw Object.assign(new Error('Requête trop volumineuse'), { status: 413 }); }
    try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Requête invalide'), { status: 400 }); }
  }
  async function newSession(req, res, account) {
    cleanSessions();
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.push({ hash: tokenHash(token), accountId: account.id, expiresAt: Date.now() + SESSION_MS });
    persist(sessionFile, sessions);
    res.setHeader('Set-Cookie', cookieHeader(token, SESSION_MS / 1000, isSecure(req)));
  }
  const publicAccount = a => ({ id: a.id, username: a.username, displayName: a.displayName, role: a.role === 'admin' ? 'admin' : 'member', createdAt: a.createdAt });
  const passwordOkay = password => typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= 128;

  const handleAuth = async function handleAuth(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith('/api/auth/')) return false;
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) { send(res, 405, { error: 'Méthode refusée' }, { Allow: 'GET, POST, PATCH' }); return true; }
    if (req.method !== 'GET' && !originOkay(req)) { send(res, 403, { error: 'Origine de la requête refusée' }); return true; }
    if (req.method !== 'GET' && !rateOkay(req)) { send(res, 429, { error: 'Trop de tentatives. Réessaie dans quinze minutes.' }); return true; }
    cleanSessions();

    if (p === '/api/auth/me' && req.method === 'GET') {
      const current = getSession(req);
      return send(res, 200, { account: current?.account ? publicAccount(current.account) : null,
        adminSetupAvailable: !accounts.some(a => a.role === 'admin') && fs.existsSync(adminCodeFile) });
    }
    if (p === '/api/auth/admin/claim' && req.method === 'POST') {
      const current = getSession(req);
      if (!current?.account) return send(res, 401, { error: 'Crée un compte ou connecte-toi avant d’activer l’administration.' });
      if (accounts.some(a => a.role === 'admin')) return send(res, 409, { error: 'Un compte administrateur existe déjà.' });
      let input; try { input = await body(req); } catch (error) { send(res, error.status || 400, { error: error.message }); return true; }
      let claim; try { claim = JSON.parse(fs.readFileSync(adminClaimFile, 'utf8')); } catch { return send(res, 409, { error: 'L’activation administrateur a déjà été utilisée ou doit être réinitialisée sur le serveur.' }); }
      const supplied = tokenHash(typeof input.code === 'string' ? input.code.trim() : '');
      if (!/^[a-f0-9]{64}$/.test(claim.hash || '') || !/^[A-Za-z0-9_-]{40,50}$/.test(String(input.code || '').trim()) || !crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(claim.hash, 'hex'))) return send(res, 403, { error: 'Code d’activation incorrect.' });
      current.account.role = 'admin'; persist(accountFile, accounts);
      fs.rmSync(adminCodeFile, { force: true }); fs.rmSync(adminClaimFile, { force: true });
      log(`Administration du portail activée pour ${current.account.username}`);
      return send(res, 200, { account: publicAccount(current.account) });
    }
    if (p === '/api/auth/register' && req.method === 'POST') {
      if (!signupRateOkay(req)) return send(res, 429, { error: 'Limite de création atteinte. Réessaie dans une heure.' });
      let input; try { input = await body(req); } catch (error) { send(res, error.status || 400, { error: error.message }); return true; }
      const username = String(input.username || '').trim().toLowerCase();
      const displayName = String(input.displayName || username).trim();
      if (!USERNAME.test(username)) return send(res, 400, { error: 'Le pseudo doit contenir 3 à 20 lettres, chiffres ou tirets bas.' });
      if (!passwordOkay(input.password)) return send(res, 400, { error: `Le mot de passe doit contenir entre ${PASSWORD_MIN} et 128 caractères.` });
      if (displayName.length < 1 || displayName.length > 32) return send(res, 400, { error: 'Le nom affiché doit contenir de 1 à 32 caractères.' });
      if (accounts.length >= 5000) return send(res, 503, { error: 'Les inscriptions sont temporairement fermées.' });
      if (accounts.some(a => a.username === username)) return send(res, 409, { error: 'Ce pseudo est déjà utilisé.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = await scrypt(input.password, salt);
      if (accounts.some(a => a.username === username)) return send(res, 409, { error: 'Ce pseudo est déjà utilisé.' });
      const account = { id: crypto.randomUUID(), username, displayName, salt, passwordHash, role: 'member', createdAt: new Date().toISOString() };
      accounts.push(account); persist(accountFile, accounts); await newSession(req, res, account);
      log(`Nouveau compte portail : ${username}`);
      return send(res, 201, { account: publicAccount(account) });
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      let input; try { input = await body(req); } catch (error) { send(res, error.status || 400, { error: error.message }); return true; }
      const username = String(input.username || '').trim().toLowerCase();
      const account = accounts.find(a => a.username === username);
      const salt = account?.salt || '00000000000000000000000000000000';
      const actual = await scrypt(typeof input.password === 'string' ? input.password.slice(0, 128) : '', salt);
      const expected = account?.passwordHash || '0'.repeat(128);
      const valid = crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
      if (!account || !valid) return send(res, 401, { error: 'Pseudo ou mot de passe incorrect.' });
      await newSession(req, res, account);
      return send(res, 200, { account: publicAccount(account) });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const current = getSession(req);
      if (current) { const index = sessions.indexOf(current.session); if (index >= 0) sessions.splice(index, 1); persist(sessionFile, sessions); }
      res.setHeader('Set-Cookie', cookieHeader('', 0, isSecure(req)));
      return send(res, 200, { ok: true });
    }
    if (p === '/api/auth/profile' && req.method === 'PATCH') {
      const current = getSession(req);
      if (!current?.account) return send(res, 401, { error: 'Connecte-toi pour modifier ton profil.' });
      let input; try { input = await body(req); } catch (error) { send(res, error.status || 400, { error: error.message }); return true; }
      const displayName = String(input.displayName || '').trim();
      if (displayName.length < 1 || displayName.length > 32) return send(res, 400, { error: 'Le nom affiché doit contenir de 1 à 32 caractères.' });
      current.account.displayName = displayName;
      persist(accountFile, accounts);
      return send(res, 200, { account: publicAccount(current.account) });
    }
    if (p === '/api/auth/password' && req.method === 'PATCH') {
      const current = getSession(req);
      if (!current?.account) return send(res, 401, { error: 'Connecte-toi pour changer ton mot de passe.' });
      let input; try { input = await body(req); } catch (error) { send(res, error.status || 400, { error: error.message }); return true; }
      if (!passwordOkay(input.newPassword)) return send(res, 400, { error: `Le nouveau mot de passe doit contenir entre ${PASSWORD_MIN} et 128 caractères.` });
      const check = await scrypt(typeof input.currentPassword === 'string' ? input.currentPassword.slice(0, 128) : '', current.account.salt);
      if (!crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(current.account.passwordHash, 'hex'))) return send(res, 401, { error: 'Mot de passe actuel incorrect.' });
      current.account.salt = crypto.randomBytes(16).toString('hex');
      current.account.passwordHash = await scrypt(input.newPassword, current.account.salt);
      persist(accountFile, accounts);
      for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].accountId === current.account.id) sessions.splice(i, 1);
      await newSession(req, res, current.account);
      return send(res, 200, { account: publicAccount(current.account) });
    }
    send(res, 404, { error: 'Route de compte introuvable' });
    return true;
  };
  handleAuth.isSecure = isSecure;
  handleAuth.isAdmin = req => Boolean(getSession(req)?.account?.role === 'admin');
  handleAuth.originOkay = originOkay;
  return handleAuth;
}

module.exports = { createAuth };
