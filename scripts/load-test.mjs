import autocannon from 'autocannon';

const baseUrl = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:4000';
const username = process.env.LOAD_TEST_USERNAME ?? 'admin';
const password = process.env.LOAD_TEST_PASSWORD ?? 'ChangeMe123!';
const query = process.env.LOAD_TEST_QUERY ?? '551';

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
if (!login.ok) {
  throw new Error(`Login failed with ${login.status}; provide valid LOAD_TEST credentials.`);
}

const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
if (!cookie) throw new Error('Login response did not include a session cookie.');

console.log(`Load testing ${baseUrl}/api/employees/search?q=${encodeURIComponent(query)}`);
const result = await autocannon({
  url: `${baseUrl}/api/employees/search?q=${encodeURIComponent(query)}`,
  connections: Number(process.env.LOAD_TEST_CONNECTIONS ?? 10),
  duration: Number(process.env.LOAD_TEST_DURATION ?? 30),
  headers: { cookie },
});

console.log(autocannon.printResult(result));
