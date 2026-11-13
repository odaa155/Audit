# audit — غرفة عمليات الحسابات الإعلانية
Deploy: Coolify → Dockerfile, port 3000, domain https://audit.mahmoudbedier.com
Persistent storage: /data
Env:
- AUDIT_USERS = mahmoud:Mahmoud:PASSWORD,ahmed:Ahmed:PASSWORD   (id:الاسم:الباسورد)
- SESSION_SECRET = long random string
