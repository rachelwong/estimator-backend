// Screenshots every built screen of the running app at three sizes, for the Built Designs canvas.
// Run: node capture-screens.mjs <out-dir>   (needs both dev servers up, frontend on release/design)
/* global URL, localStorage, window -- Node script; the last two run inside the browser page */
const FE = new URL('../../../../estimator-frontend', import.meta.url).pathname;
const { chromium } = await import(`${FE}/node_modules/playwright/index.mjs`);
const { APP, cells, createSessionByApi, createSocketPool, joinInBrowser, selectSquare, landsOn } =
  await import(`${FE}/scripts/smoke/lib.mjs`);

const OUT = (process.argv[2] ?? '.').replace(/\/?$/, '/');
const SIZES = { desktop: [1440, 900], tablet: [834, 1194], mobile: [390, 844] };
const browser = await chromium.launch();

async function context([width, height], adminSession) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  if (adminSession) {
    await ctx.addInitScript(
      ([k, t]) => localStorage.setItem(k, t),
      [`estimator:adminToken:${adminSession.sessionId}`, adminSession.adminToken],
    );
  }
  return ctx;
}

async function shot(page, name, size) {
  await page.mouse.move(1, 1); // no hover tooltips in the shot
  await page.waitForTimeout(1200); // let entry animations land
  await page.screenshot({ path: `${OUT}${name}-${size}.png`, fullPage: true });
  console.log('shot', name, size);
}

for (const [size, viewport] of Object.entries(SIZES)) {
  // Welcome, Create, Not found
  const p = await (await context(viewport)).newPage();
  await p.goto(`${APP}/welcome`);
  await shot(p, 'welcome', size);
  if (size === 'mobile') {
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.getByRole('button', { name: 'Menu' }).click();
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${OUT}welcome-menu-${size}.png` });
    console.log('shot welcome-menu', size);
  }
  await p.goto(`${APP}/new`);
  await shot(p, 'create', size);
  await p.goto(`${APP}/not-a-session`);
  await p.waitForURL(/not-found/);
  await shot(p, 'not-found', size);

  // A session with three people voting
  const session = await createSessionByApi('fibonacci', 13, 'Checkout redesign: payment step');
  const join = await (await context(viewport)).newPage();
  await join.goto(`${APP}/${session.sessionId}/join`);
  await cells(join)
    .first()
    .waitFor()
    .catch(() => {});
  await shot(join, 'join', size);

  const admin = await (await context(viewport, session)).newPage();
  await admin.goto(`${APP}/${session.sessionId}/start`);
  await cells(admin).first().waitFor();
  await selectSquare(admin, 3, 2);
  const fay = await (await context(viewport)).newPage();
  await joinInBrowser(fay, session.sessionId, 'Fay');
  await selectSquare(fay, 2, 2);
  const sockets = createSocketPool(session.sessionId);
  const zed = await sockets.join('Zed');
  zed.emit('select-square', { time: 5, resource: 3 });
  await admin.waitForTimeout(300);

  await shot(admin, 'session-admin', size);
  await shot(fay, 'session-participant', size);
  await admin.getByRole('button', { name: 'End session & reveal' }).click();
  await admin.getByRole('alertdialog').waitFor();
  await admin.waitForTimeout(600);
  await admin.screenshot({ path: `${OUT}end-confirm-${size}.png` });
  console.log('shot end-confirm', size);
  await admin
    .getByRole('alertdialog')
    .getByRole('button', { name: 'End session & reveal' })
    .click();
  await landsOn(admin, /\/ended$/);
  await landsOn(fay, /\/ended$/);
  await admin.waitForTimeout(2200); // reveal wave
  await shot(admin, 'reveal-admin', size);
  await shot(fay, 'reveal-participant', size);
  sockets.close();
  for (const ctx of browser.contexts()) await ctx.close();
}

await browser.close();
