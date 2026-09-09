import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const mailpitUrl = process.env.E2E_MAILPIT_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, mailpitUrl, ownerEmail, studioId })) {
  if (!value) throw new Error(`SET-02 e2e environment is missing ${name}.`);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function latestMailText() {
  try {
    const response = await fetch(`${mailpitUrl}/view/latest.txt`);
    return response.ok ? await response.text() : '';
  } catch {
    return '';
  }
}

async function nextMagicLink(previousText) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${mailpitUrl}/view/latest.txt`);
      if (response.ok) {
        const text = await response.text();
        if (text && text !== previousText) {
          const links = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
          const link = links.find((candidate) => candidate.includes('/auth/v1/verify'));
          if (link) return link.replace(/&amp;/g, '&').replace(/[)>.,]+$/, '');
        }
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Local Mailpit did not receive a new Supabase magic-link email.${lastError ? ` Last connection error: ${lastError.message}` : ''}`);
}

async function updateArchive(table, archive, id = null) {
  const archivedAt = archive ? new Date().toISOString() : null;
  let query = admin.from(table).update({ archived_at: archivedAt }).eq('studio_id', studioId);
  if (id) query = query.eq('id', id);
  const result = await query.select('id');
  if (result.error) throw result.error;
  return result.data;
}

async function archiveActiveSetupInventory() {
  for (const table of ['class_sessions', 'class_definitions', 'students', 'teachers', 'rooms']) {
    await updateArchive(table, true);
  }
}

async function restoreReturningBasics() {
  await updateArchive('teachers', false, 'verify01-teacher');
  await updateArchive('rooms', false, 'verify01-room');
}

async function countRows(table) {
  const result = await admin.from(table).select('id', { count: 'exact', head: true }).eq('studio_id', studioId);
  if (result.error) throw result.error;
  return result.count ?? 0;
}

async function setupFootprint() {
  const [teachers, rooms, students, classes, sessions, audits] = await Promise.all([
    countRows('teachers'),
    countRows('rooms'),
    countRows('students'),
    countRows('class_definitions'),
    countRows('class_sessions'),
    countRows('audit_events'),
  ]);
  return { teachers, rooms, students, classes, sessions, audits };
}

async function signIn(page) {
  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for the DWDE sign-in link.')).toBeVisible();
  const magicLink = await nextMagicLink(previousMail);
  await page.goto(magicLink);
  await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
}

export function registerSet02SetupDashboardTest() {
  test('SET-02 gives empty and returning managers one Setup journey without duplicate writes', async ({ page }) => {
    test.setTimeout(120_000);

    await archiveActiveSetupInventory();
    const emptyFootprint = await setupFootprint();
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`${appUrl}/setup`);
    await expect(page.getByRole('heading', { name: 'Setup', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start with the studio basics' })).toBeVisible();
    const startSetup = page.getByRole('link', { name: 'Start setup' });
    await expect(startSetup).toHaveCount(1);
    await expect(startSetup).toBeVisible();
    await startSetup.focus();
    expect(await startSetup.evaluate((element) => document.activeElement === element)).toBe(true);
    const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noHorizontalOverflow).toBe(true);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/people$/);
    await expect(page.getByRole('heading', { name: 'People & rooms', level: 1 })).toBeVisible();

    await page.goto(`${appUrl}/classes`);
    await expect(page.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible();
    await page.goto(`${appUrl}/planning-repairs`);
    await expect(page.getByRole('heading', { name: 'Requirements', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Planning repairs' })).toBeVisible();

    expect(await setupFootprint()).toEqual(emptyFootprint);

    await restoreReturningBasics();
    await page.goto(`${appUrl}/setup`);
    await expect(page.getByRole('heading', { name: 'Continue with Classes' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Coming later').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add classes' }).first()).toBeVisible();

    await page.goto(`${appUrl}/settings#advanced-diagnostics`);
    await expect(page.getByRole('heading', { name: 'Technical scheduling diagnostics' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Rulebook\b/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Readiness diagnostics\b/ })).toBeVisible();
  });
}
