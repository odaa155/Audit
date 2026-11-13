# audit — غرفة عمليات الحسابات الإعلانية
Deploy: Coolify → Dockerfile, port 3000, domain https://audit.mahmoudbedier.com
Persistent storage: /data
Env:
- Users are managed inside the app (first visit creates the admin).
- Platform connections (optional per platform): META_APP_ID, META_APP_SECRET, TIKTOK_APP_ID, TIKTOK_APP_SECRET, SNAP_CLIENT_ID, SNAP_CLIENT_SECRET
- OAuth redirect URLs: https://audit.mahmoudbedier.com/api/oauth/{meta|tiktok|snapchat}/callback
- SESSION_SECRET = long random string
