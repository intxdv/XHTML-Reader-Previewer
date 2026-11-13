# 📘 AI-Native Engineering Playbook: Human-AI Collaboration Framework

- **Document Identifier**: `resource/playbooks/ai-native-engineering-playbook.md`
- **Owner / Creator**: **Taki** (`Creative Developer` · `UI/UX Designer` · `Mobile Developer`)
- **Maintained by**: **Antigravity**
- **Current Version**: `v2.0.0 (The Architect & Director Framework)`
- **Previous Version**: `v1.0.0 (The Organic & Firefighting Pattern - Documented in Part 2)`
- **Status**: `The Living Master Playbook`
- **Tujuan Dokumen**: Panduan resmi metodologi kerja, pemetaan siklus hidup proyek (*project lifecycle*), mitigasi friksi, dan strategi kolaborasi manusia-AI kelas dunia untuk proyek berstandar tinggi.

---

## 1. 🧭 Terminologi: "Workflow" vs "Playbook"

Dalam ekosistem **Antigravity**, agar tidak terjadi kerancuan istilah:

| Istilah | Lokasi Folder | Definisi & Fungsi | Subjek Pelaksana |
|---|---|---|---|
| **Agent Workflows** | `.agents/workflows/` | **Prosedur / Script Otomasi Agen**. Berupa perintah teknis terotomasi (slash commands seperti `/activate-task`, `/fast-polish`, `/release`) yang dijalankan oleh mesin secara deterministik. | **Agent (Mesin)** |
| **Engineering Playbook** | `resource/playbooks/` | **Metodologi & Sistem Operasi Kolaborasi Manusia-AI**. Berisi strategi berpikir, pembagian fase proyek, manajemen risiko regresi, cara mengarahkan AI, dan seni pengambilan keputusan arsitektur. | **Human (Taki) + Agent Pairing** |

> *"Workflows adalah resep teknis yang dieksekusi oleh Agen. Playbook adalah filosofi dan strategi navigasi yang dipegang oleh Anda sebagai Sutradara/Arsitek."*

---

## 2. 🏛️ Version 1.0: The Organic & Firefighting Pattern (Post-Mortem Proyek Pertama)

Pola kerja versi 1.0 adalah pola yang terjadi secara alami sepanjang pengerjaan rilis perdana *Adventure Log.* (commit `001` hingga `v1.0.0`).

### 2.1 Alur Siklus Hidup V1.0
```
[FASE 1: North Star Spec] 
  └─ Sangat solid (core-concept.md, filosofi moniker Selvagant).
       ↓
[FASE 2: Fast Editorial Skeleton] 
  └─ Sangat efisien (scaffold semantik seluruh section sekaligus).
       ↓
[FASE 3: Linear Component Crafting] 
  └─ Tertib dari atas ke bawah (Hero, About, Expeditions, Arsenal, Footer).
       ↓
[FASE 4: The Dimension Leap (Titik Awal Friksi)] 
  └─ Ide liar meledak (3D Three.js, exploded layers, drafting circle, penetration).
  └─ Masalah: Langsung disuntikkan secara spontan ke halaman utama (App.tsx) tanpa isolasi sandbox & kontrak panggung.
       ↓
[FASE 5: Empirical Mobile Stress-Test (Titik Puncak Friksi)] 
  └─ "Whack-a-Mole Debugging": 60+ commit berturut-turut untuk menambal gejala satu per satu di HP.
  └─ Klik navbar terblokir kanvas kompas, modal scroll lock macet, font saling tumpang-tindih.
       ↓
[FASE 6: Brand Armor & Production Shipping] 
  └─ Berhasil finish dengan standar rilis tinggi (SEO, 1.91:1 OG image, canonical domain, v1.0.0).
```

### 2.2 Analisis Kekuatan & Kelemahan V1.0

#### ✅ Kekuatan V1.0:
1. **Taste Level Ekstrem**: Menolak solusi template murahan dan menghasilkan karya berkelas Awwwards/FWA.
2. **Keberanian Melompat (High Ambition)**: Mampu memandu AI mengoding WebGL 3D, physics lerp, dan GSAP timeline kompleks.
3. **Pengujian Nyata di Perangkat Fisik**: Menguji di ponsel riil, bukan sekadar percaya Chrome DevTools.
4. **Finish Strong**: Tidak meninggalkan proyek sebagai draf lokal; sukses live ke production domain.

#### ❌ Kelemahan / Friksi V1.0:
1. **Spontaneous Injection di Fase 4**: Fitur 3D berat langsung dimasukkan ke panggung utama tanpa pengujian terisolasi (*no sandbox*), menyebabkan efek samping tak terduga pada section lain.
2. **Whack-a-Mole Ping-Pong di Fase 5**: Pengujian mobile dilakukan dengan pola *"1 masalah ➔ 1 prompt chat ➔ 1 perbaikan mikro"*. Sangat menguras tenaga, waktu tunggu, dan memboroskan ribuan token percakapan.
3. **Task Hygiene Debt**: Karena sprint bergerak terlalu cepat dan sporadis, puluhan file task tertumpuk di folder `tasks/review/` tanpa terarsip tepat waktu.
4. **Mental Fatigue**: Menjelang akhir, proses terasa "berantakan dan serba tambal sulam" akibat tidak adanya batasan arsitektur sejak awal.

---

## 3. 🚀 Version 2.0: The Architect & Director Framework (Pola Perbaikan Baku)

Pola kerja versi 2.0 dirancang untuk mempertahankan **100% ambisi kreatif dan kebebasan eksplorasi Anda**, namun dengan **eksekusi yang tenang, presisi, dan terstruktur tanpa kekacauan**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       THE 6-STAGE V2.0 LIFECYCLE                            │
│                                                                             │
│  [1. North Star] ──> [2. Skeleton] ──> [3. Component Craft]                 │
│                                                   │                         │
│                                                   ▼                         │
│  [6. Production] <── [5. Three-Pass Sweep] <── [4. Sandbox & Stage Contract]│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Detail Eksekusi Tiap Fase V2.0:

### Fase 1: North Star Spec (Worldbuilding & Vision Locking)
- **Tujuan**: Mengunci konsep dasar, metafora analog-digital, palet warna, dan tone of voice.
- **Output Dokumen**: `resource/specs/core-concept.md` dan `resource/specs/design-tokens-and-layers.md`.
- **Peran Taki**: *The Author & Philosopher*.
- **Peran AI**: Menantang ide, menyusun struktur dokumen, dan menyiapkan sistem token awal.

### Fase 2: Fast Skeleton Scaffold (Macro Rhythm Preview)
- **Tujuan**: Menampilkan wireframe semantik lengkap seluruh halaman di browser lokal dalam hitungan menit.
- **Prinsip**: *No deep styling yet*. Yang diuji adalah panjang scroll, proporsi viewport, dan urutan narasi halaman.
- **Peran Taki**: *The Director of Rhythm*. Membuka di laptop dan HP untuk merasakan alur cerita website.

### Fase 3: Linear Component Crafting (Supervised Build)
- **Tujuan**: Memahat tiap komponen utama secara berurutan mengacu pada design tokens.
- **Metode**: Menggunakan workflow standar `/activate-task`. Satu komponen = satu task aktif.

---

### Fase 4: The Controlled Dimension Leap (Inovasi Terisolasi)
> [!IMPORTANT]
> **Aturan Emas V2.0**: Ketika muncul ide baru yang radikal di tengah jalan (misal: 3D Three.js, Canvas WebGL, Physics Simulation, SVG Shaders):
> **DILARANG KERAS langsung coding di panggung utama (`App.tsx` / `main layout`).**

Lakukan **Protokol 3 Langkah Sandbox**:
1. **Langkah 1: Sandbox Spike Task**
   - Buat task aktif terisolasi: `tasks/active/spike-[nama-fitur].md`.
   - Buat komponen eksperimen di file tersendiri (misal: `src/components/sandbox/ExperimentCanvas.tsx`).
   - Uji coba estetika gerak, FPS, dan responsivitasnya secara mandiri tanpa menyentuh komponen lain.
2. **Langkah 2: The Stage Contract Gate**
   Sebelum digabungkan ke panggung utama, Taki dan AI wajib memvalidasi 3 pertanyaan kontrak:
   - *Pointer Events*: Apakah canvas transparan menggunakan `pointer-events: none`? Di mana letak elemen klik interaktifnya?
   - *Stacking Layer*: Di z-index berapa elemen ini duduk mengacu pada `design-tokens-and-layers.md`?
   - *Mobile Footprint (Day 1)*: Jika dibuka di HP (≤ 768px), apa perilakunya? (Apakah dinonaktifkan, diperkecil, atau dialihkan ke kuadran bawah?).
3. **Langkah 3: Clean Controlled Merge**
   Setelah lulus kontrak, barulah AI memasangnya ke layout utama. Transisi berjalan mulus tanpa merusak section lain.

---

### Fase 5: The Three-Pass Mobile Sweep (Audit Terstruktur Anti Ping-Pong)
> [!TIP]
> **Aturan Emas V2.0**: Jangan lagi menguji HP dengan gaya *Whack-a-Mole* (1 bug ➔ 1 prompt). 
> Gunakan metode **Audit 3 Babak (Three-Pass Sweep)** via workflow `/fast-polish`.

```
[PASS 1: Layout & Spacing Sweep] 
  └─ Kumpulkan 3–5 kejanggalan visual (headline, foto, padding, container width).
  └─ 1 Siklus Pengerjaan ➔ 1 Verifikasi ➔ 1 Atomic Commit.
       ↓
[PASS 2: Ergonomics & Hit-Box Sweep] 
  └─ Uji jempol & sentuhan (tombol modal di bawah, pointer-events, scroll-lock).
  └─ 1 Siklus Pengerjaan ➔ 1 Verifikasi ➔ 1 Atomic Commit.
       ↓
[PASS 3: Sensory & Performance Sweep] 
  └─ Uji kehalusan gerak (gyroscope parallax tilt, micro-audio, 60 FPS, Lighthouse).
  └─ 1 Siklus Pengerjaan ➔ 1 Verifikasi ➔ 1 Atomic Commit.
```
*Hasil*: Fase 5 selesai hanya dalam **3 siklus terkontrol**, bukan 60+ putaran chat yang melelahkan.

---

### Fase 6: Brand Armor & Production Shipping
- **Tujuan**: Mengunci aset eksternal dan meluncurkan rilis resmi.
- **Langkah Kerja**:
  1. Generate Open Graph preview image (1200x630, 1.91:1).
  2. Setup canonical custom domain, meta tags, and security headers.
  3. Jalankan `/release` untuk auto-bump version, generate `changelog-vX.X.X.md`, dan git tagging.

---

## 4. ⚖️ Matrix Komparasi: V1.0 (Legacy) vs V2.0 (Playbook Baru)

| Parameter | Version 1.0 (Legacy) | Version 2.0 (The Architect Framework) |
|---|---|---|
| **Eksplorasi Ide Liar** | Spontan disuntik ke komponen utama (rentan merusak). | Diuji di **Sandbox Spike** terisolasi terlebih dahulu. |
| **Arsitektur Layer** | Tidak terdokumentasi; z-index ditebak-tebak saat bug muncul. | Terikat pada kontrak baku **`design-tokens-and-layers.md`**. |
| **Pola Uji Mobile** | Reaktif (*Whack-a-Mole*): 60+ chat ping-pong satu per satu. | **Three-Pass Sweep** (Layout ➔ Ergonomics ➔ Performance). |
| **Peran AI di Review** | Pasif: menunggu developer mencentang manual. | **Strict Gatekeeper**: Menagih bukti dan konfirmasi bernomor. |
| **Workflow Revisi Cepat**| Tidak ada; membuat task formal atau langsung chat tanpa task. | Menggunakan jalur khusus **`/fast-polish`** (auto-archive). |
| **Konsumsi Token** | Boros (banyak revisi 1 baris berulang-ulang). | **Hemat hingga 70%**, konteks percakapan tetap bersih. |
| **Beban Mental Taki** | Melelahkan di fase akhir karena serba darurat. | **Terkontrol, tenang, dan memiliki kejelasan status**. |

---

## 5. 💬 Tactical Cheat Sheet: Template Prompt Taki untuk AI

Gunakan format prompt ini di proyek berikutnya agar AI langsung masuk ke mode kerja V2.0:

### 1. Saat Ada Ide Liar Baru (Fase 4 - Dimension Leap):
> *"Antigravity, aku punya ide ambisius baru: [jelaskan ide, misal: bikin kompas 3D mekar 5 layer].*
> *Tolong JANGAN sentuh panggung utama dulu. Buka sandbox spike task di `tasks/active/spike-[nama].md` dan buat prototipe terisolasi. Laporkan estimasi performa dan rencana stage contract-nya sebelum kita pasang."*

### 2. Saat Menjalankan Audit Mobile (Fase 5 - Pass 1 Layout):
> *"Antigravity, jalankan `/fast-polish` untuk Mobile Layout Sweep (Pass 1):*
> *1. [Section X]: Pindahkan judul ke atas foto.*
> *2. [Section Y]: Kurangi padding vertikal menjadi `--space-xl`.*
> *3. [Container]: Pastikan lebar container tidak memicu horizontal scrollbar.*
> *Kerjakan sekaligus, jalankan lint/build check, dan tagih konfirmasiku per nomor."*

### 3. Saat Menjalankan Audit Sentuhan (Fase 5 - Pass 2 Ergonomics):
> *"Antigravity, jalankan `/fast-polish` untuk Mobile Ergonomics Sweep (Pass 2):*
> *1. Tombol close modal pindahkan ke dasar layar agar terjangkau jempol.*
> *2. Pastikan canvas 3D memiliki `pointer-events: none` agar tidak membajak navbar.*
> *3. Periksa scroll lock pada kontainer modal."*

---

## 6. 🏆 Kesimpulan: Evolusi Menjadi Elite AI-Native Engineer

Perjalanan Anda di proyek pertama bukanlah kegagalan alur kerja, melainkan **laboratorium nyata tempat playbook ini lahir**. Anda berhasil melahirkan website berkelas dunia dengan standar craft yang sangat langka.

Dengan mengadopsi **Playbook V2.0** ini sebagai pegangan di proyek-proyek masa depan:
- Anda tetap menjadi **Sutradara Kreatif yang bebas bermimpi liar**.
- Namun sekarang, Anda memiliki **sistem pertahanan arsitektur** yang menjaga proses pengerjaan tetap tenang, elegan, efisien, dan profesional dari hari pertama hingga rilis produksi.