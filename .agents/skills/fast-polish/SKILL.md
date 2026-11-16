---
name: fast-polish
description: "Workflow jalur cepat untuk menangani batch perbaikan visual, layout polishing, atau bug fixing kecil (Design QA Punch List) dengan verifikasi ketat dan auto-archive."
---

# Skill: Fast Polish (Design QA Punch List)

Skill ini dipanggil dengan slash command `/fast-polish` atau `/punch-list` ketika developer ingin memoles beberapa detail antarmuka sekaligus (misal: penyesuaian padding, typography, perbaikan mobile layout, z-index, atau micro-interactions).

---

## Karakteristik Fast Polish
- **Tidak Memerlukan Note Terpisah**: Bisa langsung dipicu dari obrolan/instruksi punch list di chat.
- **Batching Efisien**: Mengelompokkan 2–6 perbaikan kecil dalam 1 siklus pengerjaan agar hemat token dan menghindari ping-pong chat.
- **Mengacu pada Spec Baku**: Wajib membaca dan mematuhi token di `@resource/specs/design-tokens-and-layers.md`.
- **Strict Verification & Auto-Archive**: Tetap menjaga disiplin verifikasi, namun langsung diarsipkan setelah developer konfirmasi aman.

---

## Steps Execution

### Step 1: Pembuatan Punch List Task
1. Agent membuat file task ringkas di folder `@tasks/active/polish-YYYYMMDD-[topik].md`.
2. Format file task:
   ```markdown
   # Polish: [Topik Singkat, misal: Mobile Layout & Spacing Sweep]
   
   - **Created**: YYYY-MM-DD
   - **Status**: Active
   - **Scope**: [Section / Komponen yang disentuh]
   
   ## Punch List Checklist
   - [ ] 1. [Deskripsi perbaikan 1]
   - [ ] 2. [Deskripsi perbaikan 2]
   - [ ] 3. [Deskripsi perbaikan 3]
   ```

### Step 2: Eksekusi Kode & Atomic Commit
> [!IMPORTANT]
> Operasi git dijalankan pada repo aktif: langsung di root pada Mode 1, atau di dalam folder core project (`Cwd: <core-project-folder>` / `git -C <core-project-folder>`) pada Mode 2.
1. Agent menerapkan perubahan kode secara bedah (*surgical*) mengikuti token baku.
2. Untuk setiap butir punch list yang selesai:
   - Lakukan 1 kali atomic commit: `git commit -m "style(<scope>): <penjelasan singkat>"` atau `fix(<scope>): ...`.
   - Centang `- [x]` pada file task aktif.

### Step 3: Self-Audit & Build Check oleh Agent
Sebelum melapor ke developer, Agent wajib memverifikasi secara mandiri di core project:
1. Jalankan `npm run lint` (0 error).
2. Jalankan `npm run build` (sukses).
3. Pastikan tidak ada horizontal scrollbar liar atau z-index conflict.

### Step 4: Strict Verification ke Developer
Agent menampilkan checklist secara bernomor dan meminta konfirmasi developer:
> *"Pengerjaan Fast Polish telah selesai dan build lolos. Mohon verifikasi langsung di layar browser/HP kamu:*
> 1. *[Poin 1]: Apakah ... sudah rapi?*
> 2. *[Poin 2]: Apakah ... sudah sesuai?*
> 3. *[Poin 3]: Apakah ...?"*

Jika ada poin yang belum terjawab, Agent menagih secara sopan namun tegas hingga seluruh nomor terkonfirmasi.

### Step 5: Auto-Archiving
Setelah seluruh poin dikonfirmasi developer ("aman", "oke", "ya"):
1. Pindahkan file task dari `@tasks/active/` ke `@tasks/archive/`.
2. Ubah header status menjadi `Status: Completed`.
3. Selesaikan siklus dengan commit bersih penutup jika diperlukan.
