// Memuat apps/api/.env agar TEST_DATABASE_URL terbaca di worker vitest.
import 'dotenv/config'

// Sediakan nilai fallback untuk lingkungan CI (GitHub Actions) yang tidak memiliki file .env
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'
