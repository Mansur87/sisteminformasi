import os
import io
import sqlite3
import tempfile
import unittest
from datetime import date

import app as app_module
from openpyxl import Workbook
from app import app, init_db, seed_demo


class RoleAccessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = tempfile.TemporaryDirectory()
        app.config.update(
            TESTING=True,
            SECRET_KEY="test-only-secret",
        )

    def setUp(self):
        self.database = tempfile.TemporaryDirectory(dir=self.__class__.database.name)
        app.config["DATABASE"] = os.path.join(self.database.name, "test.sqlite3")
        app_module.SCHEMA_READY = False
        with app.app_context():
            init_db()
            seed_demo()

    def tearDown(self):
        self.database.cleanup()

    @classmethod
    def tearDownClass(cls):
        cls.database.cleanup()

    def login(self, username, password, complete_required_password_change=True):
        client = app.test_client()
        csrf = client.get("/api/csrf").get_json()["csrf"]
        response = client.post("/api/login", json={"username": username, "password": password}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        if result["user"].get("must_change_password") and complete_required_password_change:
            new_password = "SiswaBaru123!"
            changed = client.put("/api/account/password", json={"password": new_password, "confirmation": new_password}, headers={"X-CSRF-Token": result["csrf"]})
            self.assertEqual(changed.status_code, 200)
            return client, changed.get_json()["csrf"]
        return client, result["csrf"]

    def test_teacher_can_record_grade_but_cannot_read_payments(self):
        client, csrf = self.login("guru", "guru12345")
        response = client.post("/api/grades", json={"siswa": "S1", "mapel": "Kimia", "semester": "Ganjil", "nilai": 88, "tanggal": "2026-09-30"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(client.get("/api/payments").status_code, 403)

    def test_admin_manages_violation_types_and_teacher_uses_catalog_points(self):
        admin, admin_csrf = self.login("admin", "admin12345")
        created = admin.post("/api/violation-types", json={"jenis": "Tidak masuk tanpa keterangan", "poin": 8}, headers={"X-CSRF-Token": admin_csrf})
        self.assertEqual(created.status_code, 201)
        type_id = created.get_json()["item"]["id"]

        teacher, teacher_csrf = self.login("guru", "guru12345")
        listed = teacher.get("/api/violation-types")
        self.assertIn("Tidak masuk tanpa keterangan", [item["jenis"] for item in listed.get_json()["items"]])
        denied = teacher.post("/api/violation-types", json={"jenis": "Kategori guru", "poin": 1}, headers={"X-CSRF-Token": teacher_csrf})
        self.assertEqual(denied.status_code, 403)

        recorded = teacher.post("/api/violations", json={
            "siswa": "S1", "violation_type_id": type_id, "jenis": "Poin palsu", "poin": 999,
            "tanggal": "2099-01-01", "tindakLanjut": "Perlu tindak lanjut",
        }, headers={"X-CSRF-Token": teacher_csrf})
        self.assertEqual(recorded.status_code, 201)
        self.assertEqual(recorded.get_json()["item"]["jenis"], "Tidak masuk tanpa keterangan")
        self.assertEqual(recorded.get_json()["item"]["poin"], 8)

        updated = admin.put(f"/api/violation-types/{type_id}", json={"jenis": "Tidak masuk tanpa keterangan", "poin": 10}, headers={"X-CSRF-Token": admin_csrf})
        self.assertEqual(updated.status_code, 200)
        invalid = admin.put(f"/api/violation-types/{type_id}", json={"jenis": "Tidak masuk tanpa keterangan", "poin": 1001}, headers={"X-CSRF-Token": admin_csrf})
        self.assertEqual(invalid.status_code, 400)

        deleted = admin.delete(f"/api/violation-types/{type_id}", headers={"X-CSRF-Token": admin_csrf})
        self.assertEqual(deleted.status_code, 200)
        old_record = next(item for item in teacher.get("/api/violations").get_json()["items"] if item["siswa"] == "S1" and item["tanggal"] == "2099-01-01")
        self.assertEqual((old_record["jenis"], old_record["poin"]), ("Tidak masuk tanpa keterangan", 8))

    def test_admin_can_record_attendance_for_class_batch_atomically(self):
        client, csrf = self.login("admin", "admin12345")
        payload = {
            "kelas": "XI IPS 2", "tanggal": "2099-01-01",
            "items": [{"siswa": "S2", "status": "Hadir", "catatan": ""}],
        }
        saved = client.post("/api/attendance/batch", json=payload, headers={"X-CSRF-Token": csrf})
        self.assertEqual(saved.status_code, 201)
        self.assertEqual(saved.get_json()["saved"], 1)
        matching = [item for item in client.get("/api/attendance").get_json()["items"] if item["siswa"] == "S2" and item["tanggal"] == payload["tanggal"]]
        self.assertEqual(matching[0]["status"], "Hadir")
        self.assertEqual(matching[0]["waktu"], "")
        count_before_invalid = len(matching)

        duplicate_batch = client.post("/api/attendance/batch", json=payload, headers={"X-CSRF-Token": csrf})
        self.assertEqual(duplicate_batch.status_code, 409)
        duplicate_single = client.post("/api/attendance", json={
            "siswa": "S2", "tanggal": payload["tanggal"], "waktu": "07:00", "status": "Alpa",
        }, headers={"X-CSRF-Token": csrf})
        self.assertEqual(duplicate_single.status_code, 409)

        invalid = client.post("/api/attendance/batch", json={**payload, "tanggal": "2099-01-02", "items": [
            {"siswa": "S2", "status": "Hadir"}, {"siswa": "S1", "status": "Alpa"},
        ]}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(invalid.status_code, 400)
        current = [item for item in client.get("/api/attendance").get_json()["items"] if item["siswa"] == "S2" and item["tanggal"] == payload["tanggal"]]
        self.assertEqual(len(current), count_before_invalid)

    def test_student_only_sees_own_records_and_cannot_write(self):
        client, csrf = self.login("siswa", "siswa12345")
        students = client.get("/api/students").get_json()["items"]
        grades = client.get("/api/grades").get_json()["items"]
        payments = client.get("/api/payments").get_json()["items"]
        self.assertEqual([item["id"] for item in students], ["S1"])
        self.assertTrue(all(item["siswa"] == "S1" for item in grades))
        self.assertTrue(all(item["siswa"] == "S1" for item in payments))
        response = client.post("/api/attendance", json={"siswa": "S1", "tanggal": date.today().isoformat(), "waktu": "07:00", "status": "Hadir"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 403)

    def test_student_must_change_password_before_accessing_records(self):
        client, csrf = self.login("siswa", "siswa12345", complete_required_password_change=False)
        self.assertTrue(client.get("/api/me").get_json()["user"]["must_change_password"])
        self.assertEqual(client.get("/api/students").status_code, 428)
        too_short = client.put("/api/account/password", json={"password": "short", "confirmation": "short"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(too_short.status_code, 400)
        mismatch = client.put("/api/account/password", json={"password": "PasswordBaru123", "confirmation": "tidak-sama"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(mismatch.status_code, 400)
        unchanged = client.put("/api/account/password", json={"password": "siswa12345", "confirmation": "siswa12345"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(unchanged.status_code, 400)

        new_password = "PasswordBaru123!"
        changed = client.put("/api/account/password", json={"password": new_password, "confirmation": new_password}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(changed.status_code, 200)
        self.assertFalse(changed.get_json()["user"]["must_change_password"])
        self.assertEqual(client.get("/api/students").status_code, 200)

        old_login = app.test_client()
        old_csrf = old_login.get("/api/csrf").get_json()["csrf"]
        rejected = old_login.post("/api/login", json={"username": "siswa", "password": "siswa12345"}, headers={"X-CSRF-Token": old_csrf})
        self.assertEqual(rejected.status_code, 401)

    def test_admin_can_create_role_accounts(self):
        client, csrf = self.login("admin", "admin12345")
        response = client.post("/api/users", json={"username": "guru_baru", "password": "password-aman", "role": "guru"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 201)
        self.assertIn("guru_baru", [user["username"] for user in client.get("/api/users").get_json()["items"]])
        student = next(item for item in client.get("/api/students").get_json()["items"] if not item["akun"])
        created_student = client.post("/api/users", json={"password": "password-aman", "role": "siswa", "student_id": student["id"]}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(created_student.status_code, 201)
        self.assertIn(student["nis"], [item["username"] for item in client.get("/api/users").get_json()["items"]])

    def test_admin_can_edit_user_and_cannot_demote_last_admin(self):
        client, csrf = self.login("admin", "admin12345")
        teacher_id = next(item["id"] for item in client.get("/api/users").get_json()["items"] if item["username"] == "guru")
        renamed = client.put(f"/api/users/{teacher_id}", json={"username": "guru_diperbarui", "role": "guru"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(renamed.status_code, 200)
        self.assertIn("guru_diperbarui", [item["username"] for item in client.get("/api/users").get_json()["items"]])
        unchanged_password, _ = self.login("guru_diperbarui", "guru12345")
        self.assertEqual(unchanged_password.get("/api/me").status_code, 200)
        password_changed = client.put(f"/api/users/{teacher_id}", json={"username": "guru_diperbarui", "password": "password-baru", "role": "guru"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(password_changed.status_code, 200)
        changed_login, _ = self.login("guru_diperbarui", "password-baru")
        self.assertEqual(changed_login.get("/api/me").get_json()["user"]["role"], "guru")
        available_student = next(item for item in client.get("/api/students").get_json()["items"] if not item["akun"])
        changed_role = client.put(f"/api/users/{teacher_id}", json={"username": "guru_diperbarui", "password": "password-baru", "role": "siswa", "student_id": available_student["id"]}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(changed_role.status_code, 200)
        student_login, _ = self.login("guru_diperbarui", "password-baru")
        self.assertEqual(student_login.get("/api/me").get_json()["user"]["role"], "siswa")

        admin_id = next(item["id"] for item in client.get("/api/users").get_json()["items"] if item["username"] == "admin")
        demoted = client.put(f"/api/users/{admin_id}", json={"username": "admin", "role": "guru"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(demoted.status_code, 409)

    def test_admin_can_reset_student_password_to_nis(self):
        admin, csrf = self.login("admin", "admin12345")
        student = next(item for item in admin.get("/api/students").get_json()["items"] if item["id"] == "S1")
        student_user = next(item for item in admin.get("/api/users").get_json()["items"] if item["student_id"] == student["id"])
        reset = admin.post(f"/api/users/{student_user['id']}/reset-password", json={}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(reset.status_code, 200)

        student_client = app.test_client()
        student_csrf = student_client.get("/api/csrf").get_json()["csrf"]
        logged_in = student_client.post("/api/login", json={"username": student_user["username"], "password": student["nis"]}, headers={"X-CSRF-Token": student_csrf})
        self.assertEqual(logged_in.status_code, 200)
        self.assertTrue(logged_in.get_json()["user"]["must_change_password"])
        self.assertEqual(student_client.get("/api/students").status_code, 428)

        teacher_id = next(item["id"] for item in admin.get("/api/users").get_json()["items"] if item["role"] == "guru")
        denied = admin.post(f"/api/users/{teacher_id}/reset-password", json={}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(denied.status_code, 400)

    def test_write_requires_csrf_token(self):
        client, _csrf = self.login("admin", "admin12345")
        response = client.post("/api/students", json={"nama": "Contoh", "nis": "99999", "kelas": "X", "gender": "Laki-laki", "wali": "Wali", "telepon": "0812345678"})
        self.assertEqual(response.status_code, 400)

    def test_logout_and_login_again_uses_a_fresh_csrf_token(self):
        client, csrf = self.login("admin", "admin12345")
        self.assertEqual(client.post("/api/logout", headers={"X-CSRF-Token": csrf}).status_code, 200)
        fresh_csrf = client.get("/api/csrf").get_json()["csrf"]
        response = client.post("/api/login", json={"username": "admin", "password": "admin12345"}, headers={"X-CSRF-Token": fresh_csrf})
        self.assertEqual(response.status_code, 200)

    def test_initial_unauthenticated_check_preserves_login_csrf(self):
        client = app.test_client()
        csrf = client.get("/api/csrf").get_json()["csrf"]
        self.assertEqual(client.get("/api/me").status_code, 401)
        response = client.post("/api/login", json={"username": "admin", "password": "admin12345"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 200)

    def test_school_settings_backup_and_restore_are_admin_only(self):
        admin, csrf = self.login("admin", "admin12345")
        teacher, _ = self.login("guru", "guru12345")
        self.assertEqual(teacher.get("/api/settings").status_code, 403)
        self.assertEqual(teacher.get("/api/backup").status_code, 403)
        initial = admin.get("/api/settings").get_json()
        changed = {**initial, "nama": "Sekolah Sementara"}
        self.assertEqual(admin.put("/api/settings", json=changed, headers={"X-CSRF-Token": csrf}).status_code, 200)
        backup = admin.get("/api/backup")
        self.assertEqual(backup.status_code, 200)
        self.assertTrue(backup.data.startswith(b"SQLite format 3\x00"))
        self.assertEqual(admin.put("/api/settings", json={**initial, "nama": "Nama Pengganti"}, headers={"X-CSRF-Token": csrf}).status_code, 200)
        restored = admin.post("/api/restore", data={"database": (io.BytesIO(backup.data), "sekolah.sqlite3")}, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(admin.get("/api/settings").status_code, 401)
        self.assertEqual(teacher.get("/api/me").status_code, 401)
        fresh_csrf = admin.get("/api/csrf").get_json()["csrf"]
        admin.post("/api/login", json={"username": "admin", "password": "admin12345"}, headers={"X-CSRF-Token": fresh_csrf})
        self.assertEqual(admin.get("/api/settings").get_json()["nama"], "Sekolah Sementara")

    def test_restore_rejects_non_database_file(self):
        admin, csrf = self.login("admin", "admin12345")
        response = admin.post("/api/restore", data={"database": (io.BytesIO(b"not a database"), "backup.sqlite3")}, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)

    def test_school_logo_upload_remove_and_public_branding(self):
        admin, csrf = self.login("admin", "admin12345")
        logo = b"\x89PNG\r\n\x1a\n" + b"test-image-data"
        fields = {"nama": "SMA Uji Logo", "npsn": "12345678", "alamat": "", "telepon": "", "email": "", "hapus_logo": "0", "logo": (io.BytesIO(logo), "logo.png")}
        saved = admin.put("/api/settings", data=fields, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.get_json()["logo_url"], "/api/settings/logo")
        self.assertEqual(admin.get("/api/settings/logo").data, logo)
        public = admin.get("/api/public-settings").get_json()
        self.assertEqual(public["nama"], "SMA Uji Logo")
        invalid = admin.put("/api/settings", data={**fields, "logo": (io.BytesIO(b"<svg/>") , "logo.svg")}, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(invalid.status_code, 400)
        removed = admin.put("/api/settings", data={**fields, "hapus_logo": "1", "logo": (io.BytesIO(b""), "")}, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.get_json()["logo_url"], "")

    def test_teacher_assignment_limits_grade_writes_and_allows_multiple_classes(self):
        admin, csrf = self.login("admin", "admin12345")
        teacher_id = next(item["id"] for item in admin.get("/api/users").get_json()["items"] if item["username"] == "guru")
        assignment = admin.post("/api/assignments", json={"teacher_id": teacher_id, "kelas": "XI IPS 2", "mapel": "Sejarah"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(assignment.status_code, 201)
        protected = admin.post("/api/grades/batch", json={
            "siswa": "S1", "mapel": "Fisika", "semester": "Ganjil", "tanggal": date.today().isoformat(),
            "items": [{"jenis": "NH-1", "nilai": 80}],
        }, headers={"X-CSRF-Token": csrf})
        self.assertEqual(protected.status_code, 201)
        protected_grade = next(item for item in admin.get("/api/grades").get_json()["items"] if item["siswa"] == "S1" and item["mapel"] == "Fisika" and item["jenis"] == "NH-1")
        teacher, teacher_csrf = self.login("guru", "guru12345")
        denied = teacher.post("/api/grades", json={"siswa": "S1", "mapel": "Fisika", "semester": "Ganjil", "nilai": 80, "tanggal": date.today().isoformat()}, headers={"X-CSRF-Token": teacher_csrf})
        self.assertEqual(denied.status_code, 403)
        denied_edit = teacher.put(f"/api/grades/{protected_grade['id']}", json={"jenis": "NH-2", "nilai": 90}, headers={"X-CSRF-Token": teacher_csrf})
        self.assertEqual(denied_edit.status_code, 403)
        allowed = teacher.post("/api/grades", json={"siswa": "S2", "mapel": "Sejarah", "semester": "Ganjil", "nilai": 80, "tanggal": date.today().isoformat()}, headers={"X-CSRF-Token": teacher_csrf})
        self.assertEqual(allowed.status_code, 201)
        allowed_edit = teacher.put(f"/api/grades/{allowed.get_json()['item']['id']}", json={"jenis": "NH-3", "nilai": 84}, headers={"X-CSRF-Token": teacher_csrf})
        self.assertEqual(allowed_edit.status_code, 200)
        self.assertIn("Sejarah", [row["mapel"] for row in teacher.get("/api/grades").get_json()["items"]])
        self.assertEqual(teacher.get("/api/attendance").status_code, 200)
        self.assertEqual(teacher.get("/api/violations").status_code, 200)

    def test_admin_can_save_multiple_grade_types_atomically(self):
        admin, csrf = self.login("admin", "admin12345")
        payload = {
            "siswa": "S2", "mapel": "Matematika", "semester": "Ganjil", "tanggal": date.today().isoformat(),
            "items": [{"jenis": "NH1", "nilai": 88}, {"jenis": "NH2", "nilai": 90}, {"jenis": "US", "nilai": 92}],
        }
        saved = admin.post("/api/grades/batch", json=payload, headers={"X-CSRF-Token": csrf})
        self.assertEqual(saved.status_code, 201)
        self.assertEqual(saved.get_json()["saved"], 3)
        matching = [item for item in admin.get("/api/grades").get_json()["items"] if item["siswa"] == "S2" and item["mapel"] == "Matematika" and item.get("jenis")]
        self.assertEqual({item["jenis"] for item in matching}, {"NH1", "NH2", "US"})

        rejected = admin.post("/api/grades/batch", json={**payload, "items": [{"jenis": "NH1", "nilai": 70}, {"jenis": "US", "nilai": 101}]}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(rejected.status_code, 400)
        current_count = len([item for item in admin.get("/api/grades").get_json()["items"] if item["siswa"] == "S2" and item["mapel"] == "Matematika" and item.get("jenis")])
        self.assertEqual(current_count, 3)

    def test_admin_can_edit_grade_type_and_score(self):
        admin, csrf = self.login("admin", "admin12345")
        saved = admin.post("/api/grades/batch", json={
            "siswa": "S2", "mapel": "Matematika", "semester": "Ganjil", "tanggal": date.today().isoformat(),
            "items": [{"jenis": "NH-1", "nilai": 75}],
        }, headers={"X-CSRF-Token": csrf})
        self.assertEqual(saved.status_code, 201)
        grade = next(item for item in admin.get("/api/grades").get_json()["items"] if item["siswa"] == "S2" and item["mapel"] == "Matematika" and item["jenis"] == "NH-1")

        updated = admin.put(f"/api/grades/{grade['id']}", json={"jenis": "NH-5", "nilai": 96}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["item"]["jenis"], "NH-5")
        self.assertEqual(updated.get_json()["item"]["nilai"], 96)

        rejected = admin.put(f"/api/grades/{grade['id']}", json={"jenis": "NH-6", "nilai": 96}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(rejected.status_code, 400)

    def test_admin_can_edit_student_and_upload_photo_but_student_is_scoped(self):
        admin, csrf = self.login("admin", "admin12345")
        self.assertEqual(admin.post("/api/classes", json={"nama": "XI RPL 1", "tingkat": "XI", "tahun_ajaran": "2025/2026"}, headers={"X-CSRF-Token": csrf}).status_code, 201)
        photo = b"\x89PNG\r\n\x1a\nstudent-photo"
        values = {"nama": "Siswa Foto", "nis": "99991", "kelas": "XI RPL 1", "gender": "Perempuan", "wali": "Wali Foto", "telepon": "081234567890", "foto": (io.BytesIO(photo), "siswa.png")}
        created = admin.post("/api/students", data=values, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(created.status_code, 201)
        student_id = created.get_json()["item"]["id"]
        self.assertEqual(admin.get(f"/api/students/{student_id}/photo").data, photo)
        updated = admin.put(f"/api/students/{student_id}", data={"nama": "Siswa Diperbarui", "nis": "99991", "kelas": "XI RPL 1", "gender": "Perempuan", "wali": "Wali Baru", "telepon": "081298765432"}, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["item"]["nama"], "Siswa Diperbarui")
        self.assertTrue(updated.get_json()["item"]["foto_url"])
        self.assertEqual(admin.post("/api/users", json={"username": "siswa_foto", "password": "password-aman", "role": "siswa", "student_id": student_id}, headers={"X-CSRF-Token": csrf}).status_code, 201)
        student_client, _ = self.login("siswa_foto", "password-aman")
        self.assertEqual(student_client.get(f"/api/students/{student_id}/photo").data, photo)
        self.assertEqual(student_client.get("/api/students/S1/photo").status_code, 404)
        removed = admin.put(f"/api/students/{student_id}", data={"nama": "Siswa Diperbarui", "nis": "99991", "kelas": "XI RPL 1", "gender": "Perempuan", "wali": "Wali Baru", "telepon": "081298765432", "hapus_foto": "1"}, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(removed.get_json()["item"]["foto_url"], "")

    def test_restore_migrates_backup_without_teacher_assignments_or_photos(self):
        admin, csrf = self.login("admin", "admin12345")
        backup = sqlite3.connect(":memory:")
        backup.deserialize(admin.get("/api/backup").data)
        backup.execute("DROP TABLE teacher_assignments")
        backup.execute("DROP TABLE classes")
        backup.execute("DROP TABLE teacher_profiles")
        backup.execute("ALTER TABLE students DROP COLUMN foto_mime")
        backup.execute("ALTER TABLE students DROP COLUMN foto")
        backup.execute("ALTER TABLE school_settings DROP COLUMN auth_epoch")
        backup.execute("ALTER TABLE grades DROP COLUMN jenis")
        backup.execute("ALTER TABLE users DROP COLUMN must_change_password")
        backup.commit()
        legacy_contents = backup.serialize()
        backup.close()
        restored = admin.post("/api/restore", data={"database": (io.BytesIO(legacy_contents), "legacy.sqlite3")}, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(restored.status_code, 200)
        fresh_csrf = admin.get("/api/csrf").get_json()["csrf"]
        self.assertEqual(admin.post("/api/login", json={"username": "admin", "password": "admin12345"}, headers={"X-CSRF-Token": fresh_csrf}).status_code, 200)
        self.assertEqual(admin.get("/api/assignments").status_code, 200)
        self.assertEqual(admin.get("/api/classes").status_code, 200)
        self.assertTrue(all("foto_url" in row for row in admin.get("/api/students").get_json()["items"]))
        student_client = app.test_client()
        student_csrf = student_client.get("/api/csrf").get_json()["csrf"]
        student_login = student_client.post("/api/login", json={"username": "siswa", "password": "siswa12345"}, headers={"X-CSRF-Token": student_csrf})
        self.assertTrue(student_login.get_json()["user"]["must_change_password"])

    def test_class_and_teacher_master_data(self):
        admin, csrf = self.login("admin", "admin12345")
        users = admin.get("/api/users").get_json()["items"]
        teacher = next(item for item in users if item["username"] == "guru")
        saved_teacher = admin.put(f"/api/teachers/{teacher['id']}", json={"nama": "Ibu Guru Contoh", "nip": "1987654321", "telepon": "0812345678"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(saved_teacher.status_code, 200)
        self.assertEqual(admin.get("/api/teachers").get_json()["items"][0]["nama"], "Ibu Guru Contoh")
        created = admin.post("/api/classes", json={"nama": "X RPL 2", "tingkat": "X", "tahun_ajaran": "2025/2026"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(created.status_code, 201)
        assignment = admin.post("/api/assignments", json={"teacher_id": teacher["id"], "kelas": "X RPL 2", "mapel": "Informatika"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(assignment.status_code, 201)
        self.assertEqual(assignment.get_json()["item"]["guru"], "Ibu Guru Contoh")
        renamed = admin.put("/api/classes/X%20RPL%202", json={"nama": "X RPL A", "tingkat": "X", "tahun_ajaran": "2025/2026"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(renamed.status_code, 200)
        renamed_assignment = next(item for item in admin.get("/api/assignments").get_json()["items"] if item["mapel"] == "Informatika")
        self.assertEqual(renamed_assignment["kelas"], "X RPL A")
        self.assertEqual(admin.delete("/api/classes/X%20RPL%20A", headers={"X-CSRF-Token": csrf}).status_code, 409)

    def test_teacher_profiles_can_omit_nip(self):
        admin, csrf = self.login("admin", "admin12345")
        existing_teacher = next(item for item in admin.get("/api/users").get_json()["items"] if item["username"] == "guru")
        with app.app_context():
            db = app_module.get_db()
            db.execute("DROP TABLE teacher_profiles")
            db.execute(
                "CREATE TABLE teacher_profiles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, "
                "nama TEXT NOT NULL, nip TEXT NOT NULL UNIQUE, telepon TEXT NOT NULL DEFAULT '', "
                "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
            db.execute("INSERT INTO teacher_profiles (user_id, nama, nip) VALUES (?, ?, ?)", (existing_teacher["id"], "Guru Lama", "12345"))
            db.commit()
            app_module.SCHEMA_READY = False
            init_db()
            migrated = db.execute("SELECT nip FROM teacher_profiles WHERE user_id = ?", (existing_teacher["id"],)).fetchone()
            self.assertEqual(migrated["nip"], "12345")

        teacher_ids = []
        for username in ("guru_tanpa_nip_1", "guru_tanpa_nip_2"):
            created = admin.post("/api/users", json={"username": username, "password": "password-aman", "role": "guru"}, headers={"X-CSRF-Token": csrf})
            self.assertEqual(created.status_code, 201)
            teacher_ids.append(next(item["id"] for item in admin.get("/api/users").get_json()["items"] if item["username"] == username))
        for index, teacher_id in enumerate(teacher_ids, start=1):
            saved = admin.put(f"/api/teachers/{teacher_id}", json={"nama": f"Guru Tanpa NIP {index}", "nip": ""}, headers={"X-CSRF-Token": csrf})
            self.assertEqual(saved.status_code, 200)
        profiles = {item["user_id"]: item for item in admin.get("/api/teachers").get_json()["items"]}
        self.assertTrue(all(profiles[teacher_id]["nip"] == "" for teacher_id in teacher_ids))

    def test_admin_can_delete_teacher_account_and_assignments(self):
        admin, csrf = self.login("admin", "admin12345")
        teacher_id = next(item["id"] for item in admin.get("/api/users").get_json()["items"] if item["username"] == "guru")
        class_name = admin.get("/api/classes").get_json()["items"][0]["nama"]
        assigned = admin.post("/api/assignments", json={"teacher_id": teacher_id, "kelas": class_name, "mapel": "Uji Hapus Guru"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(assigned.status_code, 201)

        deleted = admin.delete(f"/api/teachers/{teacher_id}", headers={"X-CSRF-Token": csrf})
        self.assertEqual(deleted.status_code, 200)
        self.assertNotIn(teacher_id, [item["id"] for item in admin.get("/api/users").get_json()["items"]])
        self.assertNotIn(teacher_id, [item["teacher_id"] for item in admin.get("/api/assignments").get_json()["items"]])
        self.assertEqual(admin.delete(f"/api/teachers/{teacher_id}", headers={"X-CSRF-Token": csrf}).status_code, 404)

    def test_student_must_use_registered_class(self):
        admin, csrf = self.login("admin", "admin12345")
        response = admin.post("/api/students", json={"nama": "Contoh", "nis": "88888", "kelas": "Kelas Asing", "gender": "Laki-laki", "wali": "Wali", "telepon": "0812345678"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 400)

    def test_admin_can_import_students_from_excel_atomically(self):
        admin, csrf = self.login("admin", "admin12345")
        workbook = Workbook()
        worksheet = workbook.active
        worksheet.title = "Data Siswa"
        worksheet.append(app_module.STUDENT_IMPORT_HEADERS)
        worksheet.append(("Siswa Impor", "99001", "X IPA 1", "Perempuan", "Wali Impor", "0812345678"))
        output = io.BytesIO()
        workbook.save(output)
        output.seek(0)
        response = admin.post("/api/students/import", data={"file": (output, "siswa.xlsx")}, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["imported"], 1)
        imported = next(item for item in admin.get("/api/students").get_json()["items"] if item["nis"] == "99001")
        self.assertEqual(imported["kelas"], "X IPA 1")

        duplicate_book = Workbook()
        duplicate_sheet = duplicate_book.active
        duplicate_sheet.title = "Data Siswa"
        duplicate_sheet.append(app_module.STUDENT_IMPORT_HEADERS)
        duplicate_sheet.append(("Siswa Baru", "99002", "X IPA 1", "Laki-laki", "Wali Baru", "0812345679"))
        duplicate_sheet.append(("Siswa Duplikat", "99001", "X IPA 1", "Laki-laki", "Wali Duplikat", "0812345680"))
        duplicate_output = io.BytesIO()
        duplicate_book.save(duplicate_output)
        duplicate_output.seek(0)
        rejected = admin.post("/api/students/import", data={"file": (duplicate_output, "duplikat.xlsx")}, headers={"X-CSRF-Token": csrf}, content_type="multipart/form-data")
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.get_json()["error"], "Baris 3: NIS sudah digunakan.")
        self.assertNotIn("99002", [item["nis"] for item in admin.get("/api/students").get_json()["items"]])


if __name__ == "__main__":
    unittest.main()