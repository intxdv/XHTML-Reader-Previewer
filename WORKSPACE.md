# XHTML Reader Previewer

## Overview
Workspace untuk pengembangan **XHTML Reader Previewer** (Mode: **Mode 1: Native / Lead (Root Git Repo)**).

## Projects
| Project | Stack | Repo | Status |
|---------|-------|------|--------|
| Root (Direct) | TypeScript, VS Code Extension API, esbuild | TBD | Active |

## Team & Stakeholders
- **Developer**: Developer
- **Agent Assistant**: Antigravity

## Quick Links
- 📁 Resources: `./resource/`
- 📋 Notes: `./resource/notes/`
- 📥 Backlog Tasks: `./tasks/backlog/`
- ⚡ Active Tasks: `./tasks/active/`
- 🔍 Review Tasks: `./tasks/review/`
- 📦 Archived Tasks: `./tasks/archive/`
- 📝 PR Notes: `./resource/pr-notes/`
- 📑 Templates: `./resource/templates/`
- 📐 Specs: `./resource/specs/`
- 📖 Playbooks: `./resource/playbooks/`
- 📘 AI-Native Engineering Playbook: `./resource/playbooks/ai-native-engineering-playbook.md`

## Conventions
- **Git Scope & Worktrees**: Root workspace adalah repositori Git langsung. Seluruh perintah git dieksekusi langsung di root. Opsi 'New Worktree' di Antigravity didukung penuh untuk pengerjaan multi-agent terisolasi.
- **Git Tracking Boundary**: Folder '/tasks/', '/resource/notes/', dan '/resource/pr-notes/' otomatis diproteksi dalam .gitignore agar riwayat commit dan PR tetap 100% bersih dari catatan task harian.
- **Branch Naming**: `feature/{task-number}-{description}`, `fix/...`, atau `chore/...`
- **Branch Lifecycle (Post-Release)**: Pasca-rilis, setiap task aktif wajib berjalan di branch fitur terisolasi. Branch `main` diproteksi dan hanya menerima perubahan melalui merge terverifikasi atau PR.
- **Task File Format**: `NNN-YYYYMMDD-short-title.md` (misal: `001-20261114-init-project.md`)
- **Strict Atomic Commit**: `<type>(<scope>): <short description>` (1 poin checklist / 1 revisi = 1 atomic commit)
- **Notes**: `note-YYYY-MM-DD.md`
- **PR Notes**: `pr-note-YYYY-MM-DD.md`

## Agent Master Skills & Commands
| Slash Command | File | Fungsi |
|---------------|------|--------|
| `/create-backlog` | `.agents/skills/create-backlog/SKILL.md` | Memecah note menjadi file backlog di `tasks/backlog/` |
| `/run-task` | `.agents/skills/run-task/SKILL.md` | Mengaktifkan task, isolasi branch git baru, pengerjaan atomic commit bertahap, strict review gatekeeper, & auto PR squash-merge |
| `/fast-polish` | `.agents/skills/fast-polish/SKILL.md` | Batch perbaikan visual / punch list dengan verifikasi ketat & auto-archive |
| `/commit-now` | `.agents/skills/commit-now/SKILL.md` | Git commit atomic langsung untuk perubahan di luar task aktif |
| `/run-pr` | `.agents/skills/run-pr/SKILL.md` | Susun PR Note, push remote, buat PR di GitHub, auto-merge squash, & sinkronisasi |
| `/task-lifecycle-guide` | `.agents/skills/task-lifecycle-guide/SKILL.md` | Panduan terpadu siklus hidup task 5-tahap |

---
*Created with Antigravity Workspace Scaffolder (AI-Native V2.0)*
