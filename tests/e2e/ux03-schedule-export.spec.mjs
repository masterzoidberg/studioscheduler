import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const mailpitUrl = process.env.E2E_MAILPIT_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, mailpitUrl, ownerEmail, studioId })) {
  if (!value) throw new Error(`UX-03 e2e environment is missing ${name}.`);
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${mailpitUrl}/view/latest.txt`);
    if (response.ok) {
      const text = await response.text();
      if (text && text !== previousText) {
        const link = (text.match(/https?:\/\/[^\s<>"']+/g) ?? []).find((candidate) => candidate.includes('/auth/v1/verify'));
        if (link) return link.replace(/&amp;/g, '&').replace(/[)>.,]+$/, '');
      }
    }
    await delay(250);
  }
  throw new Error('Local Mailpit did not receive a new UX-03 magic-link email.');
}

async function signIn(page) {
  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for the DWDE sign-in link.')).toBeVisible();
  await page.goto(await nextMagicLink(previousMail));
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible({ timeout: 30_000 });
}

export function registerUx03ScheduleExportTest() {
  test('UX-03 shows every room and horizon day on mobile and downloads redacted schedule CSV', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto(`${appUrl}/schedule`);
    await expect(page.getByRole('heading', { name: 'Weekly schedule' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Make a readable schedule artifact' })).toBeVisible();

    const rooms = await admin
      .from('rooms')
      .select('name')
      .eq('studio_id', studioId)
      .is('archived_at', null)
      .order('name');
    if (rooms.error) throw rooms.error;

    const artifact = page.locator('[data-schedule-print]');
    await expect(artifact).toHaveAttribute('data-schedule-print-status', /^(DRAFT|STALE|REVIEWED_FINAL)$/);
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      await expect(artifact).toContainText(day);
    }
    for (const room of rooms.data) {
      await expect(artifact).toContainText(room.name);
    }
    await expect(artifact).not.toContainText('Private Student Name');

    await page.getByRole('tab', { name: /By room/ }).click();
    await expect(artifact).toHaveAttribute('data-schedule-print-view', 'ROOM');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download schedule CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/schedule-v\d+-room-(draft|stale|reviewed_final)\.csv/);
    const stream = await download.createReadStream();
    let csvText = '';
    for await (const chunk of stream) csvText += chunk.toString('utf8');
    expect(csvText).toContain('REDACTED (omitted by default)');
    expect(csvText).toContain('EMPTY');

    const finalButton = page.getByRole('button', { name: 'Download reviewed final CSV' });
    await expect(finalButton).toBeDisabled();
  });
}
