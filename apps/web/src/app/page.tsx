import { LivingSituation, RiskLevel } from "@careloop/shared";

const demoStats = [
  { label: "Total pasien", value: "2" },
  { label: "Kepatuhan mingguan", value: "89%" },
  { label: "Alert darurat aktif", value: "1" },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans">
      <main className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900">CareLoop</h1>
          <p className="text-lg text-zinc-600">
            Dashboard monitoring kepatuhan &amp; darurat — MVP hackathon (SDG 3)
          </p>
        </header>

        <section className="mb-8 grid grid-cols-3 gap-4">
          {demoStats.map((s) => (
            <div key={s.label} className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-sm text-zinc-500">{s.label}</p>
              <p className="text-2xl font-semibold text-zinc-900">{s.value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold text-zinc-900">Proof of monorepo wiring</h2>
          <p className="text-zinc-600">
            Nilai ini diimpor dari <code className="rounded bg-zinc-100 px-1 py-0.5">@careloop/shared</code>:
          </p>
          <ul className="mt-2 list-disc pl-5 text-zinc-700">
            <li>
              LivingSituation.ALONE = <code>{LivingSituation.ALONE}</code>
            </li>
            <li>
              RiskLevel.HIGH = <code>{RiskLevel.HIGH}</code>
            </li>
          </ul>
        </section>

        <footer className="mt-8 text-sm text-zinc-400">
          CareLoop — data demo sintetis, bukan data pasien riil.
        </footer>
      </main>
    </div>
  );
}
