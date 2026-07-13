import redis
import json
import os
from datetime import datetime

r = redis.Redis(host='127.0.0.1', port=6379, decode_responses=True)

backup = {
    "exported_at": datetime.utcnow().isoformat(),
    "core_memory": r.get("ava:core") or "",
    "av_data": r.get("ava:av-data") or "",
    "vision_latest": r.get("vision:latest_event") or ""
}

backup_dir = "/opt/ava-backend/backups"
os.makedirs(backup_dir, exist_ok=True)

filename = f"{backup_dir}/ava-backup-{datetime.utcnow().strftime('%Y-%m-%d')}.json"
with open(filename, 'w') as f:
    json.dump(backup, f, indent=2)

print(f"Backup saved: {filename}")
