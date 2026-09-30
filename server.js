import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requiredEnv = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'ADMIN_PASSWORD',
  'SESSION_SECRET'
];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const COOKIE = 'samir_admin';

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').filter(Boolean).map((value) => {
      const i = value.indexOf('=');
      return [value.slice(0, i).trim(), decodeURIComponent(value.slice(i + 1))];
    })
  );
}

function token() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function validToken(value) {
  try {
    const [payload, sig] = value.split('.');
    if (!payload || !sig) return false;
    const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return JSON.parse(Buffer.from(payload, 'base64url')).exp > Date.now();
  } catch {
    return false;
  }
}

function adminOnly(req, res, next) {
  if (validToken(parseCookies(req)[COOKIE] || '')) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/admin/login');
}

app.get('/admin/login', (_req, res) =>
  res.sendFile(path.join(__dirname, 'private', 'admin-login.html'))
);

app.post('/admin/login', (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).send('Invalid password. <a href="/admin/login">Try again</a>');
  }
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${
      process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : ''
    }`
  );
  return res.redirect('/admin');
});

app.get('/admin', adminOnly, (_req, res) =>
  res.sendFile(path.join(__dirname, 'private', 'admin.html'))
);

app.post('/admin/logout', (_req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${
      process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : ''
    }`
  );
  return res.redirect('/admin/login');
});

function publicIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const marker = '/upload/';
    let value = parsed.pathname.split(marker)[1];
    if (!value) return null;
    value = value.replace(/^v\d+\//, '');
    return decodeURIComponent(value.replace(/\.[^/.]+$/, ''));
  } catch {
    return null;
  }
}

function isOurCloudinaryUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'res.cloudinary.com' &&
      parsed.pathname.startsWith(`/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/`);
  } catch {
    return false;
  }
}

app.get('/api/gallery', async (_req, res) => {
  const { data, error } = await supabase.from('samirgallery').select('url');
  if (error) {
    console.error('Supabase read error:', error.message);
    return res.status(500).json({ error: 'Could not load gallery.' });
  }
  return res.json({ images: data ?? [] });
});

// Return a short-lived signature. The browser uploads the image directly to Cloudinary,
// so large image bytes never pass through Vercel.
app.get('/api/upload-signature', adminOnly, (_req, res) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const assetFolder = 'samirgallery';
  const paramsToSign = { timestamp, asset_folder: assetFolder };
  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET
  );

  return res.json({
    timestamp,
    signature,
    assetFolder,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY
  });
});

// Save only the small Cloudinary metadata/URLs to Supabase.
app.post('/api/gallery', adminOnly, async (req, res) => {
  const assets = Array.isArray(req.body?.assets) ? req.body.assets : [];
  if (!assets.length) return res.status(400).json({ error: 'No uploaded assets received.' });

  const validAssets = assets.filter(
    (asset) => asset && typeof asset.url === 'string' && isOurCloudinaryUrl(asset.url)
  );
  if (validAssets.length !== assets.length) {
    return res.status(400).json({ error: 'Invalid Cloudinary asset data.' });
  }

  const { error } = await supabase
    .from('samirgallery')
    .insert(validAssets.map((asset) => ({ url: asset.url })));

  if (error) {
    const ids = validAssets.map((asset) => asset.publicId).filter(Boolean);
    await Promise.allSettled(ids.map((id) => cloudinary.uploader.destroy(id, { invalidate: true })));
    console.error('Supabase insert error:', error.message);
    return res.status(500).json({ error: 'Images uploaded, but saving the gallery failed.' });
  }

  return res.status(201).json({
    message: `${validAssets.length} image${validAssets.length === 1 ? '' : 's'} added successfully.`
  });
});

app.delete('/api/gallery', adminOnly, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL required.' });

  const { error } = await supabase.from('samirgallery').delete().eq('url', url);
  if (error) return res.status(500).json({ error: error.message });

  const publicId = publicIdFromUrl(url);
  if (publicId) {
    try {
      await cloudinary.uploader.destroy(publicId, { invalidate: true });
    } catch (error) {
      console.warn('Cloudinary delete warning:', error.message);
    }
  }

  return res.json({ message: 'Deleted.' });
});

app.use((error, _req, res, _next) =>
  res.status(400).json({ error: error?.message || 'Invalid request.' })
);

if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Samir Gallery running on http://localhost:${port}`));
}

export default app;
