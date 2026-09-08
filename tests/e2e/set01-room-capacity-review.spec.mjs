import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { registerSet02SetupDashboardTest } from './set02-setup-dashboard.spec.mjs';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const mailpitUrl = process.env.E2E_MAILPIT_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;
const roomId = 'verify01-room';

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, mailpitUrl, ownerEmail, studioId })) {
  if (!value) throw new Error(`SET-01 e2e environment is missing ${name}.`);
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

export function registerSet01RoomCapacityReviewTest() {
  test('OWNER reviews room capacity and persisted attestation matches manager UI', async ({ page }) => {
    test.setTimeout(120_000);

    const previousMail = await latestMailText();
    await page.goto(appUrl);
    await page.getByLabel('Email address').fill(ownerEmail);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByText('Check your email for the DWDE sign-in link.')).toBeVisible();

    const magicLink = await nextMagicLink(previousMail);
    await page.goto(magicLink);
    await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });

    await page.goto(`${appUrl}/people`);
    await expect(page.getByRole('heading', { name: 'Room capacity' })).toBeVisible({ timeout: 30_000 });
    const reviewRegion = page.getByRole('region', { name: 'Room capacity' });
    const roomReview = reviewRegion.locator('article').filter({ hasText: 'Verify Room' });

    await expect(roomReview).toContainText('Capacity 20');
    await expect(roomReview).toContainText('Needs review');
    await roomReview.getByRole('button', { name: 'Confirm capacity reviewed' }).click();
    await expect(roomReview).toContainText('Reviewed', { timeout: 30_000 });
    await expect(roomReview.getByText(/Review history \(1\)/)).toBeVisible();

    const persisted = await admin
      .from('setup_review_attestations')
      .select('scope_kind,entity_id,aspect,review_schema_version,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,dependency_fingerprint')
      .eq('studio_id', studioId)
      .eq('scope_kind', 'ROOM')
      .eq('entity_id', roomId)
      .eq('aspect', 'capacity');
    if (persisted.error) throw persisted.error;
    expect(persisted.data).toHaveLength(1);
    expect(persisted.data[0].outcome).toBe('REVIEWED_VALUE');
    expect(persisted.data[0].review_schema_version).toBe(1);
    expect(persisted.data[0].source_planning_dataset_version).toBeGreaterThan(0);
    expect(persisted.data[0].reviewer_label).toBe('Verify Owner');
    expect(persisted.data[0].dependency_fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const owner = await admin.auth.admin.listUsers();
    if (owner.error) throw owner.error;
    const ownerUser = owner.data.users.find((user) => user.email === ownerEmail);
    expect(ownerUser).toBeTruthy();
    expect(persisted.data[0].reviewer_user_id).toBe(ownerUser.id);
  });

  registerSet02SetupDashboardTest();
}
