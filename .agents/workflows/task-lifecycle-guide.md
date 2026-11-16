# Task Lifecycle Guide

Siklus pengerjaan task di workspace ini mengikuti 5 tahap:
1. **Note (`resource/notes/`)**: Ide awal, catatan meeting, atau pembahasan fitur baru.
2. **Backlog (`tasks/backlog/`)**: Unit-unit task terstruktur hasil pecahan note via `/create-backlog`.
3. **Active (`tasks/active/`)**: Task yang sedang dikerjakan secara bertahap pada branch git terisolasi dengan strict atomic commit via `/run-task`.
4. **Review (`tasks/review/`)**: Task selesai dikerjakan & siap diverifikasi developer via `🧪 Alur Verifikasi & Testing (Developer Checklist)`.
5. **Archive (`tasks/archive/`)**: Task yang telah disetujui developer dan diarsipkan.
