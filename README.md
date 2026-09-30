# Samir Gallery Event Showcase

Public showcase: `/`

Protected admin: `/admin`

## Setup
1. Copy `.env.example` to `.env` and fill in your existing Supabase + Cloudinary credentials.
2. Set `ADMIN_PASSWORD` and a long random `SESSION_SECRET`.
3. Run `npm install` then `npm start`.

The admin password and service secrets stay server-side. Images are uploaded to Cloudinary and their URLs are stored in `public.samirgallery(url text not null)`.
