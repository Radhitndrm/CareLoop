import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    // Semua integration test berbagi satu TEST_DATABASE_URL dan melakukan
    // TRUNCATE di beforeEach. Dijalankan paralel, file yang satu bisa
    // menghapus data milik file yang sedang jalan sehingga hasilnya flaky —
    // dan karena urutan tidak dijamin, kadang lulus kadang gagal.
    // Unit test (src/**/*.test.ts) tidak menyentuh database, tapi ikut
    // dijalankan serial demi kesederhanaan konfigurasi.
    fileParallelism: false,
  },
})
