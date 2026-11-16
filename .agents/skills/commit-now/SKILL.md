---
name: commit-now
description: "Workflow untuk melakukan atomic git commit langsung untuk perubahan ad-hoc di luar task aktif pada repositori git."
---

# Skill: Commit Now

Skill ini dipanggil dengan slash command `/commit-now` atau ketika developer meminta commit langsung untuk perubahan yang sedang berlangsung.

---

## Steps Execution
1. **Pemeriksaan Status Git**:
   Jalankan pemeriksaan status dan diff pada workspace:
   ```bash
   git status
   git diff
   ```
2. **Evaluasi Perubahan**:
   Pastikan perubahan terisolasi, logis, dan bersih dari debug artifacts atau file yang tidak sengaja ter-stage.
3. **Atomic Commit**:
   Buat commit message dengan format Conventional Commit:
   ```bash
   git commit -m "<type>(<scope>): <deskripsi ringkas>"
   ```
4. **Laporan**:
   Laporkan commit hash dan ringkasan perubahan kepada developer.
