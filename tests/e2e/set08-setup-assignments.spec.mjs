import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const mailpitUrl = process.env.E2E_MAILPIT_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, mailpitUrl, ownerEmail, studioId })) {
  if (!value) throw new Error(`SET-08 e2e environment is missing ${name}.`);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
        const links = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
        const link = links.find((candidate) => candidate.includes('/auth/v1/verify'));
        if (link) return link.replace(/&amp;/g, '&').replace(/[)>.,]+$/, '');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Local Mailpit did not receive the SET-08 sign-in link.');
}

async function signIn(page) {
  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for the sign-in link.')).toBeVisible();
  await page.goto(await nextMagicLink(previousMail));
  await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
}

export function registerSet08SetupAssignmentsTest() {
  test('SET-08 lets a manager assign setup work and open the canonical self-service form', async ({ page }) => {
    test.setTimeout(120_000);
    await admin.from('setup_assignments').delete().eq('studio_id', studioId);
    try {
      await signIn(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${appUrl}/setup#setup-assignment`);
      await expect(page.getByRole('heading', { name: 'Assign setup, then let people enter it themselves' })).toBeVisible();
      await page.getByLabel('Area').selectOption('CLASSES');
      await page.getByLabel('Task title').fill('Enter independent class setup');
      await page.getByLabel('Instructions (optional)').fill('Enter the current class information in the existing form.');
      await page.getByRole('button', { name: 'Assign setup work' }).click();
      await expect(page.getByText('Setup work assigned. The assignee can enter the information from the linked form.')).toBeVisible();

      const assignment = page.locator('article').filter({ hasText: 'Enter independent class setup' });
      await expect(assignment).toHaveCount(1);
      await assignment.getByLabel('Status for Enter independent class setup').selectOption('IN_PROGRESS');
      await expect(page.getByText('Marked “Enter independent class setup” in progress.')).toBeVisible();
      await assignment.getByRole('link', { name: 'Open Classes form' }).click();
      await expect(page.locator('#setup-class-details')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally {
      const cleanup = await admin.from('setup_assignments').delete().eq('studio_id', studioId);
      if (cleanup.error) throw cleanup.error;
    }
  });
}
