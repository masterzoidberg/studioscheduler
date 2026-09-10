import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, ownerEmail, studioId })) {
  if (!value) throw new Error(`SET-03 e2e environment is missing ${name}.`);
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function latestMailText() {
  try {
    const response = await fetch(`${process.env.E2E_MAILPIT_URL}/view/latest.txt`);
    return response.ok ? await response.text() : '';
  } catch { return ''; }
}

async function nextMagicLink(previousText) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const text = await latestMailText();
    if (text && text !== previousText) {
      const links = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
      const link = links.find((candidate) => candidate.includes('/auth/v1/verify'));
      if (link) return link.replace(/&amp;/g, '&').replace(/[)>.,]+$/, '');
    }
    await delay(250);
  }
  throw new Error('SET-03 local Mailpit did not receive a new sign-in link.');
}

export function registerSet03SetupPolicyTest() {
test('SET-03 saves typed setup policy and reviews an explicit no-restriction room state', async ({ page }) => {
  test.setTimeout(120_000);
  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for the DWDE sign-in link.')).toBeVisible();
  await page.goto(await nextMagicLink(previousMail));
  await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/setup`);

  await expect(page.getByRole('heading', { name: 'Must happen before you build a schedule' })).toBeVisible();
  const mondayOpen = page.getByLabel('Monday opens');
  await mondayOpen.fill('16:50');
  await page.getByRole('button', { name: 'Save Setup' }).click();
  await expect(page.getByText(/15-minute grid/)).toBeVisible();
  await expect(mondayOpen).toHaveValue('16:50');

  const rejectedRulebook = await admin.from('rulebook_versions').select('version').eq('studio_id', studioId).eq('status', 'CURRENT').single();
  if (rejectedRulebook.error) throw rejectedRulebook.error;
  expect(rejectedRulebook.data.version).toBe(4);

  await mondayOpen.fill('17:00');
  await page.getByRole('button', { name: 'Save Setup' }).click();
  await expect(page.getByRole('status')).toContainText('Setup saved in Rulebook v5', { timeout: 30_000 });

  const persistedRule = await admin.from('rules').select('parameters,affected_entity_ids').eq('studio_id', studioId).eq('id', 'OPS-001').single();
  if (persistedRule.error) throw persistedRule.error;
  expect(persistedRule.data.parameters.policy.kind).toBe('STUDIO_OPERATING_WINDOWS');
  expect(persistedRule.data.parameters.policy.windows).toContainEqual({ day: 'Monday', start: '17:00', end: '21:30' });
  expect(persistedRule.data.affected_entity_ids).toEqual([]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Must happen before you build a schedule' })).toBeVisible();
  await expect(mondayOpen).toHaveValue('17:00');

  const review = page.getByRole('region', { name: 'Room restrictions' });
  await expect(review).toBeVisible({ timeout: 30_000 });
  const room = review.locator('article').filter({ hasText: 'Verify Room' });
  await expect(room).toContainText('No typed room restriction is present.');
  await room.getByRole('button', { name: 'Review no additional restriction' }).click();
  await expect(room).toContainText('Reviewed', { timeout: 30_000 });

  const persistedReview = await admin.from('setup_review_attestations').select('outcome,aspect,review_schema_version,reviewer_label,source_planning_dataset_version,dependency_fingerprint').eq('studio_id', studioId).eq('entity_id', 'verify01-room').eq('aspect', 'restrictions');
  if (persistedReview.error) throw persistedReview.error;
  expect(persistedReview.data).toHaveLength(1);
  expect(persistedReview.data[0]).toMatchObject({ outcome: 'REVIEWED_NO_ADDITIONAL_RESTRICTION', aspect: 'restrictions', review_schema_version: 1, reviewer_label: 'Verify Owner' });
  expect(persistedReview.data[0].source_planning_dataset_version).toBeGreaterThan(0);
  expect(persistedReview.data[0].dependency_fingerprint).toMatch(/^[0-9a-f]{64}$/);
});
}
