-- Perbaikan: kolom User.nakesRole sempat diberi DEFAULT 'PERAWAT' di migrasi
-- sebelumnya, sehingga nilai itu menempel juga ke akun PATIENT, FAMILY, dan ADMIN
-- yang tidak punya hubungan sama sekali dengan kewenangan klinis.
--
-- Peran klinis hanya bermakna untuk role NAKES. Akun lain dikosongkan, dan default
-- di schema dihapus supaya peran hanya terisi bila admin memilihnya secara eksplisit
-- (docs/API.md §3.2).
UPDATE "User" SET "nakesRole" = NULL WHERE "role" <> 'NAKES';

ALTER TABLE "User" ALTER COLUMN "nakesRole" DROP DEFAULT;