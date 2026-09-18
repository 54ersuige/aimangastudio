const BASE = 'http://127.0.0.1:3001';
async function trial(origin) {
  const r = await fetch(BASE + '/health', { headers: { Origin: origin } });
  return r.status;
}
const cases = [
  ['(none)', ''],
  ['vite 5173', 'http://localhost:5173'],
  ['vite 5174', 'http://localhost:5174'],
  ['loopback', 'http://127.0.0.1:5173'],
  ['evil', 'http://evil.example.com'],
  ['other port', 'http://localhost:6000'],
  ['https evil', 'https://evil.example.com'],
];
for (const [name, origin] of cases) {
  console.log(`${origin.padEnd(32)} → ${await trial(origin)} (${name})`);
}