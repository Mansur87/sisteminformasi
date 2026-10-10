const today = new Date();
const todayISO = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const formatDate = (value) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
const formatMoney = (value) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const roleLabels = { admin: "Administrator", guru: "Guru", siswa: "Siswa" };
const records = { siswa: [], nilai: [], kehadiran: [], pelanggaran: [], jenisPelanggaran: [], pembiayaan: [], pengguna: [], pengampu: [], kelas: [], guru: [] };
let user = null;
let csrfToken = "";
let activeForm = "siswa";
let activeStudentEditId = null;
let activeClassEditName = null;
let activeTeacherEditId = null;
let activeUserEditId = null;
let activeUserStudentId = null;
let activeViolationTypeId = null;
let activeGradeSubject = "";
let removeLogoSelected = false;
let removeStudentPhoto = false;
let toastTimer;

const forms = {
  siswa: { title: "Tambah siswa", endpoint: "/api/students", fields: [["nama", "Nama lengkap"], ["nis", "NIS"], ["kelas", "Kelas", "class"], ["gender", "Jenis kelamin", ["Laki-laki", "Perempuan"]], ["wali", "Nama wali"], ["telepon", "Nomor telepon wali", "tel"], ["foto", "Foto siswa", "file", false]] },
  nilai: { title: "Input nilai", endpoint: "/api/grades", fields: [["siswa", "Nama siswa", "student"], ["mapel", "Mata pelajaran"], ["semester", "Semester", ["Ganjil", "Genap"]], ["tanggal", "Tanggal penilaian", "date"], ["rincian_nilai", "Rincian nilai", "grade-rows"]] },
  kehadiran: { title: "Catat kehadiran", endpoint: "/api/attendance", fields: [["kelas", "Kelas", "attendance-class"], ["tanggal", "Tanggal", "date"], ["rincian_kehadiran", "Daftar siswa", "attendance-list"]] },
  pelanggaran: { title: "Catat pelanggaran", endpoint: "/api/violations", fields: [["siswa", "Nama siswa", "student"], ["violation_type_id", "Jenis pelanggaran", "violation-type"], ["poin", "Poin", "violation-points"], ["tanggal", "Tanggal kejadian", "date"], ["tindakLanjut", "Tindak lanjut", ["Perlu tindak lanjut", "Ditindaklanjuti"]]] },
  "jenis-pelanggaran": { title: "Tambah jenis pelanggaran", endpoint: "/api/violation-types", fields: [["jenis", "Jenis pelanggaran"], ["poin", "Poin", "number"]] },
  pembiayaan: { title: "Catat pembayaran", endpoint: "/api/payments", fields: [["siswa", "Nama siswa", "student"], ["tagihan", "Jenis tagihan"], ["jumlah", "Jumlah (Rp)", "number"], ["tempo", "Jatuh tempo", "date"], ["status", "Status pembayaran", ["Lunas", "Menunggu", "Terlambat"]]] },
  pengguna: { title: "Buat akun pengguna", endpoint: "/api/users", fields: [["username", "Nama pengguna"], ["password", "Kata sandi (minimal 8 karakter)", "password"], ["role", "Peran", ["admin", "guru", "siswa"]], ["student_id", "Hubungkan ke siswa", "student", true]] },
  pengampu: { title: "Tambah penugasan guru", endpoint: "/api/assignments", fields: [["teacher_id", "Guru", "teacher"], ["kelas", "Kelas", "class"], ["mapel", "Mata pelajaran"]] },
  kelas: { title: "Tambah kelas", endpoint: "/api/classes", fields: [["nama", "Nama kelas"], ["tingkat", "Tingkat", "text", false], ["tahun_ajaran", "Tahun ajaran"]] },
  guru: { title: "Tambah data guru", endpoint: "/api/teachers", fields: [["user_id", "Akun guru", "teacher-profile"], ["nama", "Nama lengkap"], ["nip", "NIP", "text", false], ["telepon", "Nomor telepon", "tel", false]] },
};

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { Accept: "application/json" };
  const isFormData = options.body instanceof FormData;
  if (options.body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const body = options.body === undefined ? undefined : isFormData ? options.body : JSON.stringify(options.body);
  const response = await fetch(path, { method, headers, credentials: "same-origin", body });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Permintaan tidak dapat diproses.");
  return result;
}

function initials(value) { return String(value || "").split(" ").slice(0, 2).map((part) => part[0] || "").join("").toUpperCase(); }
function studentFor(id) { return records.siswa.find((item) => item.id === id); }
function studentName(id) { return studentFor(id)?.nama || "Siswa"; }
function studentClass(id) { return studentFor(id)?.kelas || "-"; }
function statusBadge(value) {
  const tone = ["Terlambat", "Alpa", "Perlu tindak lanjut"].includes(value) ? "danger" : ["Izin", "Sakit", "Menunggu"].includes(value) ? "warning" : "";
  return `<span class="status ${tone}">${escapeHTML(value)}</span>`;
}

function setRoleVisibility() {
  document.querySelectorAll("[data-roles]").forEach((element) => {
    const allowed = element.dataset.roles.split(",");
    element.classList.toggle("hidden", !allowed.includes(user.role));
  });
  document.querySelector("#user-name").textContent = user.username;
  document.querySelector("#user-role").textContent = roleLabels[user.role];
  document.querySelector("#user-avatar").textContent = initials(user.username);
  document.querySelector("#top-avatar").textContent = initials(user.username);
  document.querySelector("#welcome-heading").innerHTML = `Selamat datang, ${escapeHTML(user.username)} <span class="sun">✳</span>`;
  if (user.role === "siswa") {
    document.querySelector("#students-nav-label").textContent = "Profil saya";
    document.querySelector("#students-title").textContent = "Profil saya";
    document.querySelector("#students-subtitle").textContent = "Informasi identitas siswa yang terhubung ke akun Anda.";
    document.querySelector("#welcome-subtitle").textContent = "Pantau informasi belajar dan aktivitas sekolah Anda.";
  } else {
    document.querySelector("#students-nav-label").textContent = "Data siswa";
    document.querySelector("#students-title").textContent = "Data siswa";
    document.querySelector("#students-subtitle").textContent = "Kelola identitas dan informasi siswa dalam satu tempat.";
    document.querySelector("#welcome-subtitle").textContent = "Berikut gambaran aktivitas sekolah hari ini.";
  }
}

async function loadRecords() {
  const requests = [
    ["siswa", "/api/students"], ["nilai", "/api/grades"], ["kehadiran", "/api/attendance"], ["pelanggaran", "/api/violations"],
  ];
  if (["admin", "guru"].includes(user.role)) requests.push(["jenisPelanggaran", "/api/violation-types"]);
  if (user.role !== "guru") requests.push(["pembiayaan", "/api/payments"]);
  if (user.role === "admin") requests.push(["pengguna", "/api/users"], ["pengampu", "/api/assignments"]);
  else if (user.role === "guru") requests.push(["pengampu", "/api/assignments"]);
  if (["admin", "guru"].includes(user.role)) requests.push(["kelas", "/api/classes"]);
  if (user.role === "admin") requests.push(["guru", "/api/teachers"]);
  await Promise.all(requests.map(async ([key, path]) => { const result = await api(path); records[key] = result.items; }));
  renderClassFilter();
  render();
}

function applySchoolIdentity(settings) {
  const name = settings.nama || "SMA Nusantara";
  document.querySelector("#school-name").textContent = name;
  document.querySelector("#school-crumb").textContent = name;
  document.querySelector("#login-school-name").textContent = name;
  document.querySelector("#password-school-name").textContent = name;
  document.querySelector("#school-initial").textContent = initials(name).slice(0, 1) || "S";
  const sidebarLogo = document.querySelector("#school-logo");
  if (settings.logo_url) {
    sidebarLogo.src = `${settings.logo_url}?v=${Date.now()}`;
    sidebarLogo.classList.remove("hidden");
    document.querySelector("#school-initial").classList.add("hidden");
  } else {
    sidebarLogo.removeAttribute("src");
    sidebarLogo.classList.add("hidden");
    document.querySelector("#school-initial").classList.remove("hidden");
  }
}

async function loadSchoolSettings() {
  const settings = await api("/api/settings");
  for (const key of ["nama", "npsn", "alamat", "telepon", "email"]) {
    document.querySelector(`#setting-${key}`).value = settings[key] || "";
  }
  const preview = document.querySelector("#logo-preview-image");
  const removeButton = document.querySelector("#remove-logo");
  if (settings.logo_url) {
    preview.src = `${settings.logo_url}?v=${Date.now()}`;
    preview.classList.remove("hidden");
    document.querySelector("#logo-placeholder").classList.add("hidden");
    removeButton.classList.remove("hidden");
  } else {
    preview.removeAttribute("src");
    preview.classList.add("hidden");
    document.querySelector("#logo-placeholder").classList.remove("hidden");
    removeButton.classList.add("hidden");
  }
  removeLogoSelected = false;
  applySchoolIdentity(settings);
}

function renderClassFilter() {
  const select = document.querySelector('[data-filter="kelas"]');
  const selected = select.value;
  const classes = records.kelas.map((item) => item.nama).sort();
  select.innerHTML = `<option value="">Semua kelas</option>${classes.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}`;
  if (classes.includes(selected)) select.value = selected;
}

function renderStudentRow(item) {
  const portrait = item.foto_url
    ? `<img class="mini-photo" src="${escapeHTML(item.foto_url)}" alt="Foto ${escapeHTML(item.nama)}" />`
    : `<span class="mini-avatar">${escapeHTML(initials(item.nama))}</span>`;
  const cells = [
    `<span class="student-cell">${portrait}${escapeHTML(item.nama)}</span>`,
    escapeHTML(item.nis), escapeHTML(item.kelas), escapeHTML(item.gender), `${escapeHTML(item.wali)}<br>${escapeHTML(item.telepon)}`, statusBadge(item.status),
  ];
  if (user.role === "admin") cells.push(escapeHTML(item.akun || "Belum ada akun"), `<span class="row-actions"><button class="row-action" data-edit-student="${escapeHTML(item.id)}" aria-label="Edit ${escapeHTML(item.nama)}" title="Edit siswa">✎</button><button class="row-action delete" data-delete-student="${escapeHTML(item.id)}" aria-label="Hapus ${escapeHTML(item.nama)}" title="Hapus siswa">×</button></span>`);
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}

function gradeKind(item) {
  const normalized = { NH1: "NH-1", NH2: "NH-2" }[item.jenis] || item.jenis;
  return normalized === "NH" ? "NH (lama)" : normalized || "Nilai lama";
}

function gradeTypeOptions(selectedKind = "", includeLegacy = false) {
  const types = ["NH-1", "NH-2", "NH-3", "NH-4", "NH-5", "US"];
  const options = types.map((kind) => `<option value="${kind}" ${kind === selectedKind ? "selected" : ""}>${kind}</option>`).join("");
  const legacy = includeLegacy ? `<option value="NH" ${selectedKind === "NH" ? "selected" : ""}>NH (lama)</option>` : "";
  return `<option value="">Pilih jenis</option>${options}${legacy}`;
}

function availableGradeTypes() {
  const preferred = ["NH-1", "NH-2", "NH-3", "NH-4", "NH-5", "US", "NH (lama)", "Nilai lama"];
  return [...new Set(records.nilai.map(gradeKind))].sort((a, b) => {
    const first = preferred.indexOf(a);
    const second = preferred.indexOf(b);
    return (first < 0 ? preferred.length : first) - (second < 0 ? preferred.length : second) || a.localeCompare(b, "id");
  });
}

function moduleRows(type) {
  if (type === "siswa") return records.siswa;
  const rows = records[type].map((item) => ({ ...item, namaSiswa: studentName(item.siswa), kelasSiswa: studentClass(item.siswa) }));
  if (type !== "nilai") return rows;

  const groups = new Map();
  rows.forEach((item) => {
    const key = JSON.stringify([item.siswa, item.mapel, item.semester]);
    if (!groups.has(key)) groups.set(key, { ...item, nilaiPerJenis: {} });
    const group = groups.get(key);
    const kind = gradeKind(item);
    if (!group.nilaiPerJenis[kind]) group.nilaiPerJenis[kind] = [];
    group.nilaiPerJenis[kind].push(Number(item.nilai));
  });
  return [...groups.values()].map((item) => {
    const types = availableGradeTypes();
    const scores = types.flatMap((kind) => item.nilaiPerJenis[kind] || []);
    return { ...item, types, rataRata: scores.reduce((sum, score) => sum + score, 0) / scores.length };
  });
}

function gradePredicate(score) {
  return score >= 90 ? "A · Sangat baik" : score >= 80 ? "B · Baik" : score >= 70 ? "C · Cukup" : "D · Perlu bimbingan";
}

function cellsFor(type, item) {
  const name = `<span class="student-cell"><span class="mini-avatar">${escapeHTML(initials(item.namaSiswa))}</span>${escapeHTML(item.namaSiswa)}</span>`;
  if (type === "nilai") {
    const scoresByType = item.types.map((kind) => {
      const scores = item.nilaiPerJenis[kind] || [];
      return scores.length ? `<div class="grade-scores">${scores.map((score) => `<span class="grade-score">${score}</span>`).join("")}</div>` : '<span class="grade-empty">-</span>';
    });
    const average = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(item.rataRata);
    return [name, escapeHTML(item.kelasSiswa), escapeHTML(item.mapel), ...scoresByType, escapeHTML(item.semester), `<b class="grade-average">${average}</b>`, `<span class="grade-predicate">${escapeHTML(gradePredicate(item.rataRata))}</span>`];
  }
  if (type === "kehadiran") return [name, escapeHTML(item.kelasSiswa), formatDate(item.tanggal), statusBadge(item.status), escapeHTML(item.catatan || "-")];
  if (type === "pelanggaran") return [name, escapeHTML(item.kelasSiswa), escapeHTML(item.jenis), `<b>${escapeHTML(item.poin)} poin</b>`, formatDate(item.tanggal), statusBadge(item.tindakLanjut)];
  if (type === "pembiayaan") return [name, escapeHTML(item.kelasSiswa), escapeHTML(item.tagihan), `<b>${formatMoney(item.jumlah)}</b>`, formatDate(item.tempo), statusBadge(item.status)];
  return [];
}

function renderTable(type) {
  if (type === "jenis-pelanggaran") {
    const rows = records.jenisPelanggaran;
    document.querySelector("#table-jenis-pelanggaran").innerHTML = rows.map((item) => `<tr><td><b>${escapeHTML(item.jenis)}</b></td><td><b>${escapeHTML(item.poin)} poin</b></td><td><span class="row-actions"><button class="row-action" data-edit-violation-type="${item.id}" aria-label="Edit ${escapeHTML(item.jenis)}" title="Edit jenis pelanggaran">✎</button><button class="row-action delete" data-delete-violation-type="${item.id}" aria-label="Hapus ${escapeHTML(item.jenis)}" title="Hapus jenis pelanggaran">×</button></span></td></tr>`).join("");
    document.querySelector("#empty-jenis-pelanggaran").classList.toggle("hidden", rows.length > 0);
    return;
  }
  if (type === "pengampu") {
    const rows = records.pengampu;
    document.querySelector("#table-pengampu").innerHTML = rows.map((item) => `<tr><td>${escapeHTML(item.guru)}</td><td>${escapeHTML(item.kelas)}</td><td>${escapeHTML(item.mapel)}</td>${user.role === "admin" ? `<td><button class="row-action delete" data-delete-assignment="${item.id}" aria-label="Hapus penugasan">×</button></td>` : ""}</tr>`).join("");
    document.querySelector("#empty-pengampu").classList.toggle("hidden", rows.length > 0);
    return;
  }
  if (type === "kelas") {
    const rows = records.kelas;
    document.querySelector("#table-kelas").innerHTML = rows.map((item) => `<tr><td><b>${escapeHTML(item.nama)}</b></td><td>${escapeHTML(item.tingkat || "-")}</td><td>${escapeHTML(item.tahun_ajaran)}</td><td>${item.jumlah_siswa}</td><td>${item.jumlah_pengampu}</td>${user.role === "admin" ? `<td><span class="row-actions"><button class="row-action" data-edit-class="${escapeHTML(item.nama)}" aria-label="Edit ${escapeHTML(item.nama)}" title="Edit kelas">✎</button><button class="row-action delete" data-delete-class="${escapeHTML(item.nama)}" aria-label="Hapus ${escapeHTML(item.nama)}" title="Hapus kelas">×</button></span></td>` : ""}</tr>`).join("");
    document.querySelector("#empty-kelas").classList.toggle("hidden", rows.length > 0);
    return;
  }
  if (type === "guru") {
    const rows = records.guru;
    document.querySelector("#table-guru").innerHTML = rows.map((item) => `<tr><td><b>${escapeHTML(item.nama || "Profil belum dilengkapi")}</b></td><td>${escapeHTML(item.nip || "-")}</td><td>${escapeHTML(item.username)}</td><td>${escapeHTML(item.telepon || "-")}</td><td>${item.jumlah_pengampu}</td><td><span class="row-actions"><button class="row-action" data-edit-teacher="${item.user_id}" aria-label="Edit ${escapeHTML(item.username)}" title="Edit data guru">✎</button><button class="row-action delete" data-delete-teacher="${item.user_id}" aria-label="Hapus ${escapeHTML(item.username)}" title="Hapus akun guru">×</button></span></td></tr>`).join("");
    document.querySelector("#empty-guru").classList.toggle("hidden", rows.length > 0);
    return;
  }
  if (type === "pengguna") {
    const rows = records.pengguna;
    document.querySelector("#table-pengguna").innerHTML = rows.map((item) => `<tr><td><span class="student-cell"><span class="mini-avatar">${escapeHTML(initials(item.username))}</span>${escapeHTML(item.username)}</span></td><td>${escapeHTML(roleLabels[item.role])}</td><td>${escapeHTML(item.nama_siswa || "-")}</td><td>${statusBadge(item.active ? "Aktif" : "Nonaktif")}</td><td><span class="row-actions"><button class="row-action" data-edit-user="${item.id}" aria-label="Edit ${escapeHTML(item.username)}" title="Edit pengguna">✎</button>${item.role === "siswa" ? `<button class="row-action" data-reset-user="${item.id}" aria-label="Reset password ${escapeHTML(item.username)}" title="Reset password ke NIS">↻</button>` : ""}</span></td></tr>`).join("");
    return;
  }
  const input = document.querySelector(`[data-search="${type}"]`);
  const filterKey = { siswa: "kelas", nilai: "semester", kehadiran: "status-kehadiran", pelanggaran: "status-pelanggaran", pembiayaan: "status-pembayaran" }[type];
  const filter = document.querySelector(`[data-filter="${filterKey}"]`)?.value || "";
  const query = input?.value.toLocaleLowerCase("id") || "";
  const allRows = moduleRows(type);
  const rows = allRows.filter((item) => {
    const searchable = type === "siswa" ? `${item.nama} ${item.nis} ${item.kelas} ${item.wali}` : type === "nilai" ? `${item.namaSiswa} ${item.kelasSiswa} ${item.mapel} ${item.semester} ${item.types.join(" ")} ${Object.values(item.nilaiPerJenis).flat().join(" ")}` : `${item.namaSiswa} ${item.kelasSiswa} ${Object.values(item).join(" ")}`;
    const currentFilter = { siswa: item.kelas, nilai: item.semester, kehadiran: item.status, pelanggaran: item.tindakLanjut, pembiayaan: item.status }[type];
    return (!filter || currentFilter === filter) && searchable.toLocaleLowerCase("id").includes(query);
  });
  if (type === "nilai") {
    const types = availableGradeTypes();
    document.querySelector("#grade-table-head").innerHTML = `<tr><th>NAMA</th><th>KELAS</th><th>MATA PELAJARAN</th>${types.map((kind) => `<th>${escapeHTML(kind)}</th>`).join("")}<th>SEMESTER</th><th>RATA-RATA NILAI</th><th>PREDIKAT</th></tr>`;
  }
  const rendered = type === "siswa" ? rows.map(renderStudentRow) : rows.map((item) => `<tr>${cellsFor(type, item).map((cell) => `<td>${cell}</td>`).join("")}</tr>`);
  document.querySelector(`#table-${type}`).innerHTML = rendered.join("");
  const count = document.querySelector(`#count-${type}`);
  if (count) count.textContent = `${rows.length} dari ${allRows.length} data`;
  document.querySelector(`#empty-${type}`).classList.toggle("hidden", rows.length > 0);
}

function renderDashboard() {
  const total = records.siswa.length;
  const todayRecords = records.kehadiran.filter((item) => item.tanggal === todayISO);
  const present = todayRecords.filter((item) => item.status === "Hadir").length;
  const average = records.nilai.length ? Math.round(records.nilai.reduce((sum, item) => sum + Number(item.nilai), 0) / records.nilai.length) : 0;
  const monthPaid = records.pembiayaan.filter((item) => item.status === "Lunas" && (item.dibayar || item.tempo).startsWith(todayISO.slice(0, 7)));
  document.querySelector("#student-count").textContent = total;
  document.querySelector("#stat-students").textContent = total;
  document.querySelector("#stat-attendance").textContent = total ? Math.round(present / total * 100) : 0;
  document.querySelector("#stat-present").textContent = `${present} siswa hadir`;
  document.querySelector("#stat-average").textContent = average;
  document.querySelector("#stat-paid").textContent = formatMoney(monthPaid.reduce((sum, item) => sum + Number(item.jumlah), 0));
  document.querySelector("#stat-paid-count").textContent = `${monthPaid.length} pembayaran lunas`;
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(); day.setDate(day.getDate() - 6 + index);
    const key = new Date(day.getTime() - day.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const daily = records.kehadiran.filter((item) => item.tanggal === key);
    const here = daily.filter((item) => item.status === "Hadir").length;
    return { label: new Intl.DateTimeFormat("id-ID", { weekday: "short" }).format(day), present: total ? Math.round(here / total * 100) : 0, away: total ? Math.round((daily.length - here) / total * 100) : 0 };
  });
  document.querySelector("#week-rate").textContent = `${Math.round(week.reduce((sum, day) => sum + day.present, 0) / 7)}%`;
  document.querySelector("#attendance-chart").innerHTML = week.map((day) => `<div class="chart-day"><div class="chart-bars"><i class="chart-bar" style="height:${Math.max(day.present, 4)}%" title="Hadir ${day.present}%"></i><i class="chart-bar absent" style="height:${Math.max(day.away, 4)}%" title="Tidak hadir ${day.away}%"></i></div><small>${escapeHTML(day.label)}</small></div>`).join("");
  const paid = records.pembiayaan.filter((item) => item.status === "Lunas");
  const pending = records.pembiayaan.filter((item) => item.status === "Menunggu");
  const late = records.pembiayaan.filter((item) => item.status === "Terlambat");
  const paidTotal = paid.reduce((sum, item) => sum + Number(item.jumlah), 0);
  const dueTotal = records.pembiayaan.filter((item) => item.status !== "Lunas").reduce((sum, item) => sum + Number(item.jumlah), 0);
  const progress = records.pembiayaan.length ? Math.round(paid.length / records.pembiayaan.length * 100) : 0;
  document.querySelector("#finance-total").textContent = formatMoney(paidTotal);
  document.querySelector("#finance-progress").style.width = `${progress}%`;
  document.querySelector("#finance-percent").textContent = `${progress}% lunas`;
  document.querySelector("#finance-due").textContent = `${formatMoney(dueTotal)} belum dibayar`;
  document.querySelector("#count-paid").textContent = paid.length;
  document.querySelector("#count-pending").textContent = pending.length;
  document.querySelector("#count-late").textContent = late.length;
  const activity = [
    ...records.kehadiran.map((item) => ({ id: item.siswa, label: `Presensi ${item.status.toLowerCase()}`, date: item.tanggal, status: item.status })),
    ...records.nilai.map((item) => ({ id: item.siswa, label: `Nilai ${item.mapel} diperbarui`, date: item.tanggal, status: `${item.nilai} nilai` })),
    ...records.pelanggaran.map((item) => ({ id: item.siswa, label: item.jenis, date: item.tanggal, status: "Pelanggaran" })),
    ...records.pembiayaan.filter((item) => item.status === "Lunas").map((item) => ({ id: item.siswa, label: `Pembayaran ${item.tagihan}`, date: item.dibayar || item.tempo, status: "Lunas" })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  document.querySelector("#activity-table").innerHTML = activity.map((item) => `<tr><td><span class="student-cell"><span class="mini-avatar">${escapeHTML(initials(studentName(item.id)))}</span>${escapeHTML(studentName(item.id))}</span></td><td>${escapeHTML(item.label)}</td><td>${escapeHTML(studentClass(item.id))}</td><td>${formatDate(item.date)}</td><td>${statusBadge(item.status)}</td></tr>`).join("") || `<tr><td colspan="5">Belum ada aktivitas.</td></tr>`;
}

function render() {
  renderDashboard();
  ["siswa", "nilai", "kehadiran", "pelanggaran", "jenis-pelanggaran", "pembiayaan", "pengguna", "pengampu", "kelas", "guru"].forEach(renderTable);
}

function showPage(page) {
  const target = document.querySelector(`#page-${page}`);
  if (!target || target.classList.contains("hidden")) return;
  document.querySelectorAll(".page").forEach((item) => item.classList.toggle("active", item === target));
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  document.querySelector("#crumb-title").textContent = target.dataset.title || "Ringkasan";
  document.querySelector("#sidebar").classList.remove("open");
  history.replaceState(null, "", `#${page}`);
}

function studentChoices(fieldName) {
  if (fieldName === "student_id") {
    return records.siswa.filter((item) => !item.akun || item.id === activeUserStudentId);
  }
  if (user.role === "guru" && ["nilai", "kehadiran", "pelanggaran"].includes(activeForm)) {
    const selectedSubject = activeForm === "nilai" ? activeGradeSubject : "";
    const assignments = records.pengampu.filter((item) => !selectedSubject || item.mapel === selectedSubject);
    const assignedClasses = new Set(assignments.map((item) => item.kelas));
    return records.siswa.filter((item) => assignedClasses.has(item.kelas));
  }
  return records.siswa;
}

function makeField([name, label, kind, required = true]) {
  const id = `field-${name}`;
  let control;
  if (Array.isArray(kind)) {
    const options = name === "role" ? kind.map((value) => `<option value="${value}">${escapeHTML(roleLabels[value])}</option>`).join("") : kind.map((value) => `<option>${escapeHTML(value)}</option>`).join("");
    control = `<select id="${id}" name="${name}" ${required ? "required" : ""}>${options}</select>`;
  } else if (kind === "violation-type") {
    const choices = records.jenisPelanggaran.map((item) => `<option value="${item.id}">${escapeHTML(item.jenis)} · ${escapeHTML(item.poin)} poin</option>`).join("");
    control = `<select id="${id}" name="${name}" required><option value="">Pilih jenis pelanggaran</option>${choices}</select>`;
  } else if (kind === "violation-points") {
    control = `<input id="${id}" name="${name}" type="number" readonly required aria-readonly="true" />`;
  } else if (kind === "student") {
    const choices = studentChoices(name).map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.nama)} · ${escapeHTML(item.kelas)}</option>`).join("");
    control = `<select id="${id}" name="${name === "student_id" ? "student_id" : "siswa"}" ${required ? "required" : ""}><option value="">Pilih siswa</option>${choices}</select>`;
  } else if (kind === "teacher") {
    const teachers = records.pengguna.filter((item) => item.role === "guru");
    control = `<select id="${id}" name="teacher_id" required><option value="">Pilih guru</option>${teachers.map((item) => `<option value="${item.id}">${escapeHTML(item.username)}</option>`).join("")}</select>`;
  } else if (kind === "teacher-profile") {
    const available = records.guru.filter((item) => item.profil_belum_lengkap);
    const selected = activeTeacherEditId ? records.guru.filter((item) => item.user_id === activeTeacherEditId) : available;
    control = `<select id="${id}" name="user_id" required>${selected.map((item) => `<option value="${item.user_id}">${escapeHTML(item.username)}</option>`).join("")}</select>`;
  } else if (kind === "class") {
    const classes = records.kelas.map((item) => item.nama).sort();
    control = `<select id="${id}" name="kelas" required><option value="">Pilih kelas</option>${classes.map((value) => `<option>${escapeHTML(value)}</option>`).join("")}</select>`;
  } else if (kind === "attendance-class") {
    const classes = user.role === "guru"
      ? [...new Set(records.pengampu.map((item) => item.kelas))].sort()
      : records.kelas.map((item) => item.nama).sort();
    control = `<select id="${id}" name="kelas" required><option value="">Pilih kelas</option>${classes.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}</select>`;
  } else if (kind === "attendance-list") {
    control = `<div class="attendance-list" id="${id}"><p class="attendance-placeholder">Pilih kelas untuk menampilkan siswa.</p></div>`;
  } else if (kind === "textarea") {
    control = `<textarea id="${id}" name="${name}" ${required ? "required" : ""}></textarea>`;
  } else if (kind === "file") {
    control = `<div class="student-photo-control"><div class="student-photo-preview"><img class="hidden" id="student-photo-image" alt="Pratinjau foto siswa" /><span id="student-photo-placeholder">FOTO</span></div><div class="student-photo-actions"><input id="${id}" name="${name}" type="file" accept="image/png,image/jpeg,image/webp" /><small>PNG, JPEG, atau WebP · Maksimal 2 MB</small><button class="text-action hidden" id="remove-student-photo" type="button">Hapus foto</button></div></div>`;
  } else if (name === "mapel" && activeForm === "nilai" && user.role === "guru") {
    const subjects = [...new Set(records.pengampu.map((item) => item.mapel))].sort();
    control = `<select id="${id}" name="${name}" required><option value="">Pilih mata pelajaran</option>${subjects.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}</select>`;
  } else if (kind === "grade-rows") {
    const types = gradeTypeOptions();
    const row = `<div class="grade-row"><select name="jenis" aria-label="Jenis penilaian" required>${types}</select><input name="nilai" type="number" min="0" max="100" placeholder="Nilai 0–100" aria-label="Nilai 0 sampai 100" required /><button class="row-action delete" type="button" data-remove-grade-row aria-label="Hapus baris nilai" title="Hapus baris">×</button></div>`;
    control = `<div class="grade-entry-list" id="${id}">${row}</div><button class="text-action grade-add" type="button" data-add-grade-row>＋ Tambah nilai</button>`;
  } else {
    const limits = kind === "number" ? `min="${name === "nilai" ? 0 : 1}" ${name === "nilai" ? 'max="100"' : ""}` : "";
    const defaultValue = kind === "date" ? `value="${todayISO}"` : kind === "time" ? 'value="07:00"' : "";
    const suggestions = name === "mapel" ? `list="${id}-suggestions"` : "";
    const datalist = name === "mapel" ? `<datalist id="${id}-suggestions">${[...new Set(records.nilai.map((item) => item.mapel))].map((value) => `<option value="${escapeHTML(value)}"></option>`).join("")}</datalist>` : "";
    control = `<input id="${id}" name="${name}" type="${kind || "text"}" ${required ? "required" : ""} ${limits} ${defaultValue} ${suggestions} />${datalist}`;
  }
  return `<div class="form-field" data-field="${name}"><label for="${id}">${escapeHTML(label)}${required ? " *" : ""}</label>${control}</div>`;
}

function openForm(type, studentRecord = null) {
  if (!forms[type]) return;
  if (type === "pelanggaran" && !records.jenisPelanggaran.length) return notify("Admin perlu menambahkan jenis pelanggaran terlebih dahulu melalui menu Jenis pelanggaran.");
  if (["siswa", "nilai", "kehadiran", "pelanggaran", "pembiayaan", "pengampu"].includes(type) && !records.siswa.length) return notify("Tambahkan data siswa terlebih dahulu.");
  if (type === "nilai" && user.role === "guru" && !records.pengampu.length) return notify("Minta administrator menambahkan penugasan kelas dan mata pelajaran terlebih dahulu.");
  if (type === "pengguna" && !studentRecord && !records.siswa.some((item) => !item.akun)) return notify("Semua siswa sudah memiliki akun atau belum ada data siswa.");
  if (type === "guru" && !records.guru.some((item) => item.profil_belum_lengkap)) return notify("Buat akun guru terlebih dahulu melalui menu Pengguna.");
  activeForm = type;
  activeStudentEditId = type === "siswa" && studentRecord ? studentRecord.id : null;
  activeClassEditName = type === "kelas" && studentRecord ? studentRecord.nama : null;
  activeTeacherEditId = type === "guru" && studentRecord ? Number(studentRecord.user_id) : null;
  activeUserEditId = type === "pengguna" && studentRecord ? Number(studentRecord.id) : null;
  activeUserStudentId = activeUserEditId ? studentRecord.student_id : null;
  activeViolationTypeId = type === "jenis-pelanggaran" && studentRecord ? Number(studentRecord.id) : null;
  activeGradeSubject = "";
  removeStudentPhoto = false;
  const config = forms[type];
  document.querySelector("#modal-title").textContent = activeStudentEditId ? "Edit data siswa" : activeClassEditName ? "Edit kelas" : activeTeacherEditId ? "Edit data guru" : activeUserEditId ? "Edit pengguna" : activeViolationTypeId ? "Edit jenis pelanggaran" : config.title;
  const fields = activeUserEditId
    ? config.fields.map((field) => field[0] === "password" ? ["password", "Kata sandi baru (kosongkan jika tidak diubah)", "password", false] : field)
    : config.fields;
  const orderedFields = type === "nilai" && user.role === "guru" ? [fields[1], fields[0], ...fields.slice(2)] : fields;
  document.querySelector("#form-fields").innerHTML = orderedFields.map(makeField).join("");
  if (type === "jenis-pelanggaran" && studentRecord) {
    document.querySelector("#field-jenis").value = studentRecord.jenis;
    document.querySelector("#field-poin").value = studentRecord.poin;
  }
  if (type === "pelanggaran") {
    const typeSelect = document.querySelector("#field-violation_type_id");
    const pointInput = document.querySelector("#field-poin");
    const syncViolationPoints = () => {
      const selected = records.jenisPelanggaran.find((item) => String(item.id) === typeSelect.value);
      pointInput.value = selected ? selected.poin : "";
    };
    typeSelect.addEventListener("change", syncViolationPoints);
    syncViolationPoints();
  }
  if (type === "nilai") {
    const gradeRows = document.querySelector("#field-rincian_nilai");
    const addButton = document.querySelector("[data-add-grade-row]");
    const studentSelect = document.querySelector("#field-siswa");
    const subjectSelect = document.querySelector("#field-mapel");
    const semesterSelect = document.querySelector("#field-semester");
    const newGradeRow = () => {
      const row = document.createElement("div");
      row.className = "grade-row";
      row.innerHTML = `<select name="jenis" aria-label="Jenis penilaian" required>${gradeTypeOptions()}</select><input name="nilai" type="number" min="0" max="100" placeholder="Nilai 0–100" aria-label="Nilai 0 sampai 100" required /><button class="row-action delete" type="button" data-remove-grade-row aria-label="Hapus baris nilai" title="Hapus baris">×</button>`;
      return row;
    };
    const updateExistingGrades = () => {
      const student = studentSelect.value;
      const subject = subjectSelect.value;
      const semester = semesterSelect.value;
      const existing = records.nilai
        .filter((item) => item.siswa === student && (!subject || item.mapel === subject) && (!semester || item.semester === semester))
        .sort((first, second) => Number(first.id) - Number(second.id));
      gradeRows.innerHTML = existing.map((item) => {
        const label = subject && semester ? gradeKind(item) : `${item.mapel} · ${item.semester} · ${gradeKind(item)}`;
        return `<div class="grade-row grade-row-existing"><span>${escapeHTML(label)}</span><span>${escapeHTML(item.nilai)}</span><button class="row-action" type="button" data-edit-grade="${escapeHTML(item.id)}" aria-label="Edit ${escapeHTML(label)}" title="Edit nilai">✎</button></div>`;
      }).join("");
      gradeRows.append(newGradeRow());
      updateRemoveButtons();
    };
    const updateRemoveButtons = () => {
      const rows = gradeRows.querySelectorAll(".grade-row:not(.grade-row-existing)");
      rows.forEach((row) => { row.querySelector("[data-remove-grade-row]").disabled = rows.length === 1; });
    };
    addButton.addEventListener("click", () => {
      gradeRows.append(newGradeRow());
      updateRemoveButtons();
    });
    gradeRows.addEventListener("click", async (event) => {
      const editButton = event.target.closest("[data-edit-grade]");
      if (editButton) {
        const item = records.nilai.find((grade) => String(grade.id) === editButton.dataset.editGrade);
        const row = editButton.closest(".grade-row-existing");
        if (!item || !row) return;
        const kind = item.jenis === "NH1" ? "NH-1" : item.jenis === "NH2" ? "NH-2" : item.jenis || "";
        row.classList.add("grade-row-editing");
        row.innerHTML = `<select name="jenis" aria-label="Jenis penilaian" required>${gradeTypeOptions(kind, kind === "NH")}</select><input name="nilai" type="number" min="0" max="100" value="${escapeHTML(item.nilai)}" aria-label="Nilai 0 sampai 100" required /><button class="row-action" type="button" data-save-grade="${escapeHTML(item.id)}" aria-label="Simpan perubahan nilai" title="Simpan">✓</button><button class="row-action delete" type="button" data-cancel-grade aria-label="Batalkan edit nilai" title="Batal">×</button>`;
        return;
      }
      const saveButton = event.target.closest("[data-save-grade]");
      if (saveButton) {
        event.preventDefault();
        const row = saveButton.closest(".grade-row-existing");
        const kind = row.querySelector('[name="jenis"]');
        const score = row.querySelector('[name="nilai"]');
        if (!kind.reportValidity() || !score.reportValidity()) return;
        try {
          const result = await api(`/api/grades/${encodeURIComponent(saveButton.dataset.saveGrade)}`, {
            method: "PUT",
            body: { jenis: kind.value, nilai: score.value },
          });
          records.nilai = records.nilai.map((grade) => grade.id === result.item.id ? result.item : grade);
          render();
          updateExistingGrades();
          notify("Rincian nilai berhasil diperbarui.");
        } catch (error) { notify(error.message); }
        return;
      }
      if (event.target.closest("[data-cancel-grade]")) {
        updateExistingGrades();
        return;
      }
      if (event.target.closest("[data-remove-grade-row]") && gradeRows.querySelectorAll(".grade-row:not(.grade-row-existing)").length > 1) {
        event.target.closest(".grade-row").remove();
        updateRemoveButtons();
      }
    });
    [studentSelect, subjectSelect, semesterSelect].forEach((select) => select.addEventListener("change", updateExistingGrades));
    updateExistingGrades();
  }
  document.querySelector("#form-error").classList.add("hidden");
  document.querySelector("#backdrop").classList.remove("hidden");
  if (studentRecord) {
    for (const key of ["nama", "nis", "kelas", "gender", "wali", "telepon", "tingkat", "tahun_ajaran", "nip", "username", "role", "student_id"]) {
      const input = document.querySelector(`#field-${key}`);
      if (input) input.value = studentRecord[key] || "";
    }
    if (activeTeacherEditId) {
      document.querySelector("#field-user_id").value = String(activeTeacherEditId);
    }
    const photo = document.querySelector("#student-photo-image");
    if (studentRecord.foto_url) {
      photo.src = studentRecord.foto_url;
      photo.classList.remove("hidden");
      document.querySelector("#student-photo-placeholder").classList.add("hidden");
      document.querySelector("#remove-student-photo").classList.remove("hidden");
    }
  }
  document.querySelector("#field-foto")?.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    removeStudentPhoto = false;
    const photo = document.querySelector("#student-photo-image");
    photo.src = URL.createObjectURL(file);
    photo.classList.remove("hidden");
    document.querySelector("#student-photo-placeholder").classList.add("hidden");
    document.querySelector("#remove-student-photo").classList.remove("hidden");
  });
  document.querySelector("#remove-student-photo")?.addEventListener("click", () => {
    removeStudentPhoto = true;
    document.querySelector("#field-foto").value = "";
    document.querySelector("#student-photo-image").classList.add("hidden");
    document.querySelector("#student-photo-placeholder").classList.remove("hidden");
    document.querySelector("#remove-student-photo").classList.add("hidden");
  });
  if (type === "pengguna") {
    const usernameField = document.querySelector("#field-username");
    const roleSelect = document.querySelector("#field-role");
    const studentSelect = document.querySelector("#field-student_id");
    let defaultNisUsername = "";
    const applyStudentUsername = () => {
      const student = records.siswa.find((item) => item.id === studentSelect.value);
      if (!activeUserEditId && (!usernameField.value || usernameField.value === defaultNisUsername)) {
        usernameField.value = student?.nis || "";
      }
      defaultNisUsername = student?.nis || "";
    };
    document.querySelector("#field-role").addEventListener("change", (event) => {
      const studentField = document.querySelector('[data-field="student_id"]');
      studentField.classList.toggle("hidden", event.target.value !== "siswa");
      document.querySelector("#field-student_id").required = event.target.value === "siswa";
      if (event.target.value !== "siswa") {
        if (!activeUserEditId && usernameField.value === defaultNisUsername) usernameField.value = "";
        studentSelect.value = "";
        defaultNisUsername = "";
      } else {
        applyStudentUsername();
      }
    });
    studentSelect.addEventListener("change", applyStudentUsername);
    const studentField = document.querySelector('[data-field="student_id"]');
    const isStudent = roleSelect.value === "siswa";
    studentField.classList.toggle("hidden", !isStudent);
    studentSelect.required = isStudent;
  }
  if (type === "nilai" && user.role === "guru") {
    const mapelSelect = document.querySelector("#field-mapel");
    const studentSelect = document.querySelector("#field-siswa");
    mapelSelect.addEventListener("change", () => {
      activeGradeSubject = mapelSelect.value;
      const selectedStudent = studentSelect.value;
      const choices = studentChoices("siswa");
      studentSelect.innerHTML = `<option value="">Pilih siswa</option>${choices.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.nama)} · ${escapeHTML(item.kelas)}</option>`).join("")}`;
      if (choices.some((item) => item.id === selectedStudent)) studentSelect.value = selectedStudent;
      studentSelect.dispatchEvent(new Event("change"));
    });
  }
  if (type === "kehadiran") {
    const classSelect = document.querySelector("#field-kelas");
    const attendanceList = document.querySelector("#field-rincian_kehadiran");
    const renderAttendanceStudents = () => {
      const students = records.siswa
        .filter((item) => item.kelas === classSelect.value)
        .sort((first, second) => first.nama.localeCompare(second.nama, "id"));
      if (!students.length) {
        attendanceList.innerHTML = `<p class="attendance-placeholder">${classSelect.value ? "Belum ada siswa di kelas ini." : "Pilih kelas untuk menampilkan siswa."}</p>`;
        return;
      }
      attendanceList.innerHTML = `<div class="attendance-list-head"><span>${students.length} siswa</span><span>Status</span><span>Keterangan</span></div>${students.map((item) => `<div class="attendance-entry" data-attendance-student="${escapeHTML(item.id)}"><span class="attendance-name">${escapeHTML(item.nama)}</span><select name="status" aria-label="Status ${escapeHTML(item.nama)}"><option>Hadir</option><option>Izin</option><option>Sakit</option><option>Alpa</option></select><input name="catatan" maxlength="300" aria-label="Keterangan ${escapeHTML(item.nama)}" placeholder="Opsional" /></div>`).join("")}`;
    };
    classSelect.addEventListener("change", renderAttendanceStudents);
  }
  document.querySelector("#form-fields input, #form-fields select")?.focus();
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const config = forms[activeForm];
  const formData = new FormData(form);
  const values = Object.fromEntries(formData.entries());
  let successMessage = `${config.title} berhasil disimpan.`;
  if (activeForm === "pembiayaan" && values.status === "Lunas") values.dibayar = todayISO;
  try {
    if (activeForm === "siswa") {
      formData.set("hapus_foto", removeStudentPhoto ? "1" : "0");
      await api(activeStudentEditId ? `${config.endpoint}/${encodeURIComponent(activeStudentEditId)}` : config.endpoint, { method: activeStudentEditId ? "PUT" : "POST", body: formData });
    } else if (activeForm === "kelas" && activeClassEditName) {
      await api(`${config.endpoint}/${encodeURIComponent(activeClassEditName)}`, { method: "PUT", body: values });
    } else if (activeForm === "guru") {
      await api(`${config.endpoint}/${values.user_id}`, { method: "PUT", body: values });
    } else if (activeForm === "pengguna" && activeUserEditId) {
      await api(`${config.endpoint}/${activeUserEditId}`, { method: "PUT", body: values });
    } else if (activeForm === "jenis-pelanggaran") {
      await api(activeViolationTypeId ? `${config.endpoint}/${activeViolationTypeId}` : config.endpoint, { method: activeViolationTypeId ? "PUT" : "POST", body: values });
      successMessage = activeViolationTypeId ? "Jenis pelanggaran berhasil diperbarui." : "Jenis pelanggaran berhasil ditambahkan.";
    } else if (activeForm === "nilai") {
      if (form.querySelector(".grade-row-editing")) {
        notify("Simpan atau batalkan edit rincian nilai terlebih dahulu.");
        return;
      }
      const items = [...form.querySelectorAll(".grade-row:not(.grade-row-existing)")].map((row) => ({
        jenis: row.querySelector('[name="jenis"]').value,
        nilai: row.querySelector('[name="nilai"]').value,
      }));
      const result = await api("/api/grades/batch", {
        method: "POST",
        body: { siswa: values.siswa, mapel: values.mapel, semester: values.semester, tanggal: values.tanggal, items },
      });
      successMessage = `${result.saved} nilai berhasil disimpan.`;
    } else if (activeForm === "kehadiran") {
      const items = [...form.querySelectorAll("[data-attendance-student]")].map((row) => ({
        siswa: row.dataset.attendanceStudent,
        status: row.querySelector('[name="status"]').value,
        catatan: row.querySelector('[name="catatan"]').value,
      }));
      const result = await api("/api/attendance/batch", {
        method: "POST",
        body: { kelas: values.kelas, tanggal: values.tanggal, items },
      });
      successMessage = `${result.saved} kehadiran berhasil dicatat.`;
    } else {
      await api(config.endpoint, { method: "POST", body: values });
    }
    await loadRecords();
    document.querySelector("#backdrop").classList.add("hidden");
    form.reset();
    activeStudentEditId = null;
    activeClassEditName = null;
    activeTeacherEditId = null;
    activeViolationTypeId = null;
    const wasUserEdit = Boolean(activeUserEditId);
    activeUserEditId = null;
    activeUserStudentId = null;
    notify(wasUserEdit ? "Data pengguna berhasil diperbarui." : successMessage);
  } catch (error) {
    const message = document.querySelector("#form-error");
    message.textContent = error.message;
    message.classList.remove("hidden");
  }
}

async function saveSchoolSettings(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  formData.set("hapus_logo", removeLogoSelected ? "1" : "0");
  try {
    const settings = await api("/api/settings", { method: "PUT", body: formData });
    applySchoolIdentity(settings);
    await loadSchoolSettings();
    notify("Identitas sekolah berhasil disimpan.");
  } catch (error) {
    const message = document.querySelector("#settings-error");
    message.textContent = error.message;
    message.classList.remove("hidden");
  }
}

async function downloadBackup() {
  try {
    const response = await fetch("/api/backup", { credentials: "same-origin" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Backup tidak dapat diunduh.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ruangsiswa-backup-${todayISO}.sqlite3`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Backup database berhasil diunduh.");
  } catch (error) { notify(error.message); }
}

async function restoreDatabase() {
  const input = document.querySelector("#restore-file");
  const file = input.files[0];
  if (!file || !window.confirm("Restore akan mengganti seluruh data saat ini dan mengeluarkan semua pengguna. Lanjutkan?")) return;
  const formData = new FormData();
  formData.append("database", file);
  try {
    const result = await api("/api/restore", { method: "POST", body: formData });
    user = null;
    document.body.classList.remove("authenticated");
    document.querySelector("#login-screen").classList.remove("hidden");
    applySchoolIdentity(await api("/api/public-settings"));
    csrfToken = (await api("/api/csrf")).csrf;
    const message = document.querySelector("#login-error");
    message.textContent = result.message;
    message.classList.remove("hidden");
    input.value = "";
    document.querySelector("#restore-button").disabled = true;
  } catch (error) { notify(error.message); }
}

function notify(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

async function enterApp(userData) {
  user = userData;
  if (user.role === "siswa" && user.must_change_password) {
    document.querySelector("#login-screen").classList.add("hidden");
    document.querySelector("#password-change-screen").classList.remove("hidden");
    return;
  }
  document.querySelector("#password-change-screen").classList.add("hidden");
  setRoleVisibility();
  document.querySelector("#login-screen").classList.add("hidden");
  document.body.classList.add("authenticated");
  await loadRecords();
  if (user.role === "admin") await loadSchoolSettings();
  const requestedPage = location.hash.slice(1);
  const page = ["ringkasan", "siswa", "nilai", "kehadiran", "pelanggaran", "jenis-pelanggaran", "pembiayaan", "pengguna", "pengampu", "pengaturan", "kelas", "guru"].includes(requestedPage) ? requestedPage : "ringkasan";
  if (document.querySelector(`[data-page="${page}"]`)?.classList.contains("hidden")) showPage("ringkasan");
  else showPage(page);
}

async function login(event) {
  event.preventDefault();
  const error = document.querySelector("#login-error");
  error.classList.add("hidden");
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const result = await api("/api/login", { method: "POST", body: values });
    csrfToken = result.csrf;
    await enterApp(result.user);
    event.currentTarget.reset();
  } catch (exception) {
    error.textContent = exception.message;
    error.classList.remove("hidden");
  }
}

async function submitRequiredPasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#password-change-error");
  error.classList.add("hidden");
  const values = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await api("/api/account/password", { method: "PUT", body: values });
    csrfToken = result.csrf;
    form.reset();
    await enterApp(result.user);
  } catch (exception) {
    error.textContent = exception.message;
    error.classList.remove("hidden");
  }
}

async function logout() {
  try { await api("/api/logout", { method: "POST", body: {} }); } catch {}
  try { csrfToken = (await api("/api/csrf")).csrf; } catch { csrfToken = ""; }
  user = null;
  records.siswa = []; records.nilai = []; records.kehadiran = []; records.pelanggaran = []; records.pembiayaan = []; records.pengguna = [];
  document.body.classList.remove("authenticated");
  document.querySelector("#password-change-screen").classList.add("hidden");
  document.querySelector("#login-screen").classList.remove("hidden");
  history.replaceState(null, "", location.pathname);
}

document.querySelectorAll("[data-page]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showPage(link.dataset.page); }));
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.go)));
document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => openForm(button.dataset.add)));
document.querySelector("#import-students-button").addEventListener("click", () => document.querySelector("#import-students-file").click());
document.querySelector("#import-students-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const body = new FormData();
  body.append("file", file);
  try {
    const result = await api("/api/students/import", { method: "POST", body });
    await loadRecords();
    notify(`${result.imported} siswa berhasil diimpor.`);
  } catch (error) {
    notify(error.message);
  } finally {
    event.target.value = "";
  }
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.querySelector("#backdrop").classList.add("hidden")));
document.querySelector("#backdrop").addEventListener("click", (event) => { if (event.target.id === "backdrop") event.currentTarget.classList.add("hidden"); });
document.querySelector("#record-form").addEventListener("submit", submitForm);
document.querySelector("#school-settings-form").addEventListener("submit", saveSchoolSettings);
document.querySelector("#login-form").addEventListener("submit", login);
document.querySelector("#password-change-form").addEventListener("submit", submitRequiredPasswordChange);
document.querySelector("#password-change-logout").addEventListener("click", logout);
document.querySelector("#logout-button").addEventListener("click", logout);
document.querySelector("#menu-toggle").addEventListener("click", () => document.querySelector("#sidebar").classList.toggle("open"));
document.querySelector("#backup-button").addEventListener("click", downloadBackup);
document.querySelector("#restore-file").addEventListener("change", (event) => { document.querySelector("#restore-button").disabled = !event.target.files.length; });
document.querySelector("#restore-button").addEventListener("click", restoreDatabase);
document.querySelector("#logo-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  removeLogoSelected = false;
  const preview = document.querySelector("#logo-preview-image");
  preview.src = URL.createObjectURL(file);
  preview.classList.remove("hidden");
  document.querySelector("#logo-placeholder").classList.add("hidden");
  document.querySelector("#remove-logo").classList.remove("hidden");
});
document.querySelector("#remove-logo").addEventListener("click", () => {
  removeLogoSelected = true;
  document.querySelector("#logo-file").value = "";
  document.querySelector("#logo-preview-image").classList.add("hidden");
  document.querySelector("#logo-placeholder").classList.remove("hidden");
  document.querySelector("#remove-logo").classList.add("hidden");
});
document.querySelectorAll("[data-search]").forEach((input) => input.addEventListener("input", render));
document.querySelectorAll("[data-filter]").forEach((select) => select.addEventListener("change", render));
document.addEventListener("click", async (event) => {
  const editViolationType = event.target.closest("[data-edit-violation-type]");
  if (editViolationType && user.role === "admin") {
    const item = records.jenisPelanggaran.find((record) => record.id === Number(editViolationType.dataset.editViolationType));
    if (item) openForm("jenis-pelanggaran", item);
    return;
  }
  const deleteViolationType = event.target.closest("[data-delete-violation-type]");
  if (deleteViolationType && user.role === "admin") {
    const item = records.jenisPelanggaran.find((record) => record.id === Number(deleteViolationType.dataset.deleteViolationType));
    if (!item || !window.confirm(`Hapus jenis pelanggaran "${item.jenis}"? Catatan pelanggaran yang sudah tersimpan tidak akan berubah.`)) return;
    try {
      await api(`/api/violation-types/${item.id}`, { method: "DELETE" });
      await loadRecords();
      notify("Jenis pelanggaran berhasil dihapus.");
    } catch (error) { notify(error.message); }
    return;
  }
  const editClass = event.target.closest("[data-edit-class]");
  if (editClass && user.role === "admin") {
    const item = records.kelas.find((record) => record.nama === editClass.dataset.editClass);
    if (item) openForm("kelas", item);
    return;
  }
  const editTeacher = event.target.closest("[data-edit-teacher]");
  if (editTeacher && user.role === "admin") {
    const item = records.guru.find((record) => record.user_id === Number(editTeacher.dataset.editTeacher));
    if (item) openForm("guru", item);
    return;
  }
  const deleteTeacher = event.target.closest("[data-delete-teacher]");
  if (deleteTeacher && user.role === "admin") {
    const item = records.guru.find((record) => record.user_id === Number(deleteTeacher.dataset.deleteTeacher));
    if (!item || !window.confirm(`Hapus akun guru ${item.username}, profil, dan seluruh penugasan mengajarnya? Riwayat nilai tetap disimpan.`)) return;
    try {
      await api(`/api/teachers/${item.user_id}`, { method: "DELETE" });
      await loadRecords();
      notify("Akun guru, profil, dan penugasan berhasil dihapus.");
    } catch (error) { notify(error.message); }
    return;
  }
  const editUser = event.target.closest("[data-edit-user]");
  if (editUser && user.role === "admin") {
    const item = records.pengguna.find((record) => record.id === Number(editUser.dataset.editUser));
    if (item) openForm("pengguna", item);
    return;
  }
  const resetUser = event.target.closest("[data-reset-user]");
  if (resetUser && user.role === "admin") {
    const item = records.pengguna.find((record) => record.id === Number(resetUser.dataset.resetUser));
    if (!item || item.role !== "siswa" || !window.confirm(`Reset password ${item.username} ke NIS? Siswa wajib mengganti password saat login berikutnya.`)) return;
    try {
      await api(`/api/users/${item.id}/reset-password`, { method: "POST", body: {} });
      notify(`Password ${item.username} direset ke NIS.`);
    } catch (error) { notify(error.message); }
    return;
  }
  const deleteClass = event.target.closest("[data-delete-class]");
  if (deleteClass && user.role === "admin") {
    try {
      await api(`/api/classes/${encodeURIComponent(deleteClass.dataset.deleteClass)}`, { method: "DELETE" });
      await loadRecords();
      notify("Data kelas dihapus.");
    } catch (error) { notify(error.message); }
    return;
  }
  const editButton = event.target.closest("[data-edit-student]");
  if (editButton && user.role === "admin") {
    const item = studentFor(editButton.dataset.editStudent);
    if (item) openForm("siswa", item);
    return;
  }
  const assignmentButton = event.target.closest("[data-delete-assignment]");
  if (assignmentButton && user.role === "admin") {
    try {
      await api(`/api/assignments/${assignmentButton.dataset.deleteAssignment}`, { method: "DELETE" });
      await loadRecords();
      notify("Penugasan guru dihapus.");
    } catch (error) { notify(error.message); }
    return;
  }
  const button = event.target.closest("[data-delete-student]");
  if (!button || user.role !== "admin") return;
  const item = studentFor(button.dataset.deleteStudent);
  if (!item || !window.confirm(`Hapus ${item.nama} dan seluruh data terkait, termasuk akun siswanya?`)) return;
  try {
    await api(`/api/students/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    await loadRecords();
    notify("Data siswa dan data terkait berhasil dihapus.");
  } catch (error) { notify(error.message); }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelector("#backdrop").classList.add("hidden");
    document.querySelector("#sidebar").classList.remove("open");
  }
});
document.querySelector("#today").textContent = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(today);

async function boot() {
  try {
    applySchoolIdentity(await api("/api/public-settings"));
    csrfToken = (await api("/api/csrf")).csrf;
    const result = await api("/api/me");
    csrfToken = result.csrf;
    await enterApp(result.user);
  } catch {
    document.querySelector("#login-screen").classList.remove("hidden");
  }
}
boot();