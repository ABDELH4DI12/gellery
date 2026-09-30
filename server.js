import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = process.env.PORT || 3000;
const requiredEnv = ['SUPABASE_URL','SUPABASE_SECRET_KEY','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET','ADMIN_PASSWORD','SESSION_SECRET'];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) { console.error(`Missing environment variables: ${missing.join(', ')}`); process.exit(1); }

cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });
const upload = multer({ storage: multer.memoryStorage(), limits:{fileSize:10*1024*1024}, fileFilter:(_req,file,cb)=>file.mimetype.startsWith('image/')?cb(null,true):cb(new Error('Only image files are allowed.')) });

app.use(express.json());
app.use(express.urlencoded({extended:false}));
app.use(express.static('public'));

const COOKIE='samir_admin';
function parseCookies(req){ return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i).trim(),decodeURIComponent(v.slice(i+1))]})); }
function token(){ const payload=Buffer.from(JSON.stringify({exp:Date.now()+12*60*60*1000})).toString('base64url'); const sig=crypto.createHmac('sha256',process.env.SESSION_SECRET).update(payload).digest('base64url'); return `${payload}.${sig}`; }
function validToken(value){ try { const [payload,sig]=value.split('.'); const expected=crypto.createHmac('sha256',process.env.SESSION_SECRET).update(payload).digest('base64url'); if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return false; return JSON.parse(Buffer.from(payload,'base64url')).exp>Date.now(); } catch{return false;} }
function adminOnly(req,res,next){ if(validToken(parseCookies(req)[COOKIE]||'')) return next(); if(req.path.startsWith('/api/')) return res.status(401).json({error:'Unauthorized'}); return res.redirect('/admin/login'); }

app.get('/admin/login', (req,res)=>res.sendFile('admin-login.html',{root:'private'}));
app.post('/admin/login', (req,res)=>{ if(req.body.password!==process.env.ADMIN_PASSWORD) return res.status(401).send('Invalid password. <a href="/admin/login">Try again</a>'); res.setHeader('Set-Cookie',`${COOKIE}=${token()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV==='production'?'; Secure':''}`); res.redirect('/admin'); });
app.get('/admin', adminOnly, (_req,res)=>res.sendFile('admin.html',{root:'private'}));
app.post('/admin/logout', (_req,res)=>{ res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`); res.redirect('/admin/login'); });

function uploadToCloudinary(buffer){ return new Promise((resolve,reject)=>{ const stream=cloudinary.uploader.upload_stream({resource_type:'image',asset_folder:'samirgallery',use_filename:true,unique_filename:true,overwrite:false},(e,r)=>e?reject(e):resolve(r)); stream.end(buffer); }); }
function publicIdFromUrl(url){ try { const u=new URL(url); const marker='/upload/'; let p=u.pathname.split(marker)[1]; if(!p)return null; p=p.replace(/^v\d+\//,''); return decodeURIComponent(p.replace(/\.[^/.]+$/,'')); } catch{return null;} }

app.get('/api/gallery', async (_req,res)=>{ const {data,error}=await supabase.from('samirgallery').select('url'); if(error){console.error('Supabase read error:',error.message);return res.status(500).json({error:'Could not load gallery.'});} res.json({images:data??[]}); });
app.post('/api/upload', adminOnly, upload.single('image'), async (req,res)=>{ if(!req.file)return res.status(400).json({error:'Please choose an image.'}); let result; try { result=await uploadToCloudinary(req.file.buffer); const {error}=await supabase.from('samirgallery').insert({url:result.secure_url}); if(error){await cloudinary.uploader.destroy(result.public_id,{invalidate:true});throw error;} res.status(201).json({message:'Image uploaded successfully.',url:result.secure_url}); } catch(e){console.error('Upload error:',e?.message||e);res.status(500).json({error:e?.message||'Upload failed.'});} });
app.delete('/api/gallery', adminOnly, async (req,res)=>{ const {url}=req.body||{}; if(!url)return res.status(400).json({error:'URL required.'}); const {error}=await supabase.from('samirgallery').delete().eq('url',url); if(error)return res.status(500).json({error:error.message}); const pid=publicIdFromUrl(url); if(pid){try{await cloudinary.uploader.destroy(pid,{invalidate:true});}catch(e){console.warn('Cloudinary delete warning:',e.message)}} res.json({message:'Deleted.'}); });

app.use((error,_req,res,_next)=>{ if(error instanceof multer.MulterError)return res.status(400).json({error:error.message}); return res.status(400).json({error:error?.message||'Invalid request.'}); });
app.listen(port,()=>console.log(`Samir Gallery running on http://localhost:${port}`));
