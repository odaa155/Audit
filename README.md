# audit — غرفة عمليات الحسابات الإعلانية
Deploy: Coolify → Dockerfile, port 3000, domain https://audit.mahmoudbedier.com
Persistent storage: /data
Env:
- Users are managed inside the app (first visit creates the admin).
- SESSION_SECRET = long random string
