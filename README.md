# RuangSiswa

Aplikasi informasi sekolah berbasis Flask dan SQLite untuk mengelola identitas siswa, nilai, kehadiran, pelanggaran, pembiayaan, serta akun pengguna.

## Menjalankan mode demo

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py --seed-demo
```

Buka `http://127.0.0.1:5000`. Akun demo:

| Peran | Nama pengguna | Kata sandi |
| --- | --- | --- |
| Admin | `admin` | `admin12345` |
| Guru | `guru` | `guru12345` |
| Siswa | `siswa` | `siswa12345` |

Data demo hanya ditambahkan jika belum ada. Untuk membuat admin pada instalasi tanpa akun demo, jalankan `python app.py --create-admin` dan ikuti prompt terminal.

## Hak akses

- **Admin**: mengelola data siswa, semua data sekolah, pembiayaan, serta membuat akun admin/guru/siswa. Akun siswa dihubungkan ke satu profil siswa.
- **Guru**: melihat siswa dan daftar tugasnya, mencatat nilai hanya untuk mapel yang diampu serta kehadiran/pelanggaran untuk kelas yang diampu. Guru tidak dapat mengakses data pembiayaan atau pengelolaan akun.
- **Siswa**: hanya membaca profil, nilai, kehadiran, pelanggaran, dan tagihan miliknya sendiri.

Izin diperiksa pada backend. Kata sandi disimpan dalam bentuk hash dan perubahan data menggunakan token CSRF.

Admin mengelola master **Data kelas** dan membuat akun guru melalui menu **Pengguna**. Setelah itu, gunakan tombol **Tambah data guru** di menu **Data Guru** untuk mengisi profil nama, NIP (opsional), dan kontak. Profil siswa dan penugasan pengampu memakai kelas dari master tersebut. Dari menu **Pengampu**, seorang guru dapat menerima banyak kombinasi kelas dan mata pelajaran. Profil siswa dapat diedit dan dilengkapi foto PNG/JPEG/WebP hingga 2 MB. Foto dilayani melalui endpoint yang memeriksa sesi serta identitas siswa.

Untuk menambahkan siswa ke kelas, admin buat kelas lebih dahulu dari menu **Data Kelas**, lalu pilih kelas tersebut saat menambah siswa di menu **Data Siswa**. Untuk banyak siswa, unduh **template Excel** dari halaman Data Siswa, isi satu siswa per baris, lalu pilih **Impor Excel**. Nama kelas harus sama persis dengan kelas yang sudah terdaftar, jenis kelamin diisi `Laki-laki` atau `Perempuan`, dan NIS harus unik. Impor menerima `.xlsx` hingga 5.000 siswa; jika ada baris tidak valid atau NIS duplikat, seluruh impor dibatalkan.

Admin dapat membuka menu **Pengaturan** untuk mengubah nama sekolah, NPSN, alamat, email, telepon, dan logo (PNG/JPEG/WebP hingga 2 MB). Dari menu yang sama admin dapat mengunduh backup SQLite dan memulihkan database dari file backup RuangSiswa. Restore memvalidasi struktur/integritas file, memerlukan akun admin aktif, dan membatalkan seluruh sesi login.

## Konfigurasi

`DATABASE_PATH` dapat digunakan untuk mengganti lokasi database SQLite. Tetapkan `SECRET_KEY` yang kuat dan stabil untuk sesi sebelum deployment. Gunakan server WSGI produksi, HTTPS, cookie secure, backup database, serta kebijakan privasi dan retensi data sebelum menyimpan data siswa nyata.

`--seed-demo` membuat akun demo dengan kata sandi yang diketahui; jangan gunakan akun tersebut di lingkungan yang dapat diakses publik. Data dari prototipe `localStorage` lama tidak diimpor otomatis.

## Tes

```sh
python -m unittest -v
```