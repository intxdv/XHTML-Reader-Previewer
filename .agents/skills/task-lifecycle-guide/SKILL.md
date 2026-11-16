---
name: task-lifecycle-guide
description: "Panduan terpadu siklus hidup task 5-tahap (Note -> Backlog -> Active -> Review -> Archive) dalam arsitektur AI-Native V2.0."
---

# Skill: Task Lifecycle Guide

Siklus pengerjaan task di workspace ini mengikuti 5 tahap standar:

1. **Note (`resource/notes/`)**: Ide awal, catatan diskusi, atau pembahasan fitur/bugfix baru (`note-YYYY-MM-DD.md`).
2. **Backlog (`tasks/backlog/`)**: Unit-unit task terstruktur hasil pecahan note via `/create-backlog`.
3. **Active (`tasks/active/`)**: Task yang sedang dikerjakan secara bertahap pada branch git terisolasi (`feature/*`, `fix/*`, `chore/*`) dengan strict atomic commit via `/run-task`.
4. **Review (`tasks/review/`)**: Task selesai dikerjakan & diverifikasi developer secara ketat melalui protokol `🧪 Alur Verifikasi & Testing (Developer Checklist)` (Strict Gatekeeper).
5. **Archive (`tasks/archive/`)**: Task yang telah disetujui developer, dibuatkan PR Note, di-squash-merge ke `main`, dan diarsipkan secara rapi.
