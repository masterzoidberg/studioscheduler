import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;
for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, ownerEmail, studioId })) if (!value) throw new Error(`SET-06 e2e environment is missing ${name}.`);
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function latestMailText() { try { const response = await fetch(`${process.env.E2E_MAILPIT_URL}/view/latest.txt`); return response.ok ? await response.text() : ''; } catch { return ''; } }
async function nextMagicLink(previousText) { for (let attempt = 0; attempt < 40; attempt += 1) { const text = await latestMailText(); if (text && text !== previousText) { const link = (text.match(/https?:\/\/[^\s<>"']+/g) ?? []).find((candidate) => candidate.includes('/auth/v1/verify')); if (link) return link.replace(/&amp;/g, '&').replace(/[)>.,]+$/, ''); } await delay(250); } throw new Error('SET-06 local Mailpit did not receive a sign-in link.'); }

export function registerSet06StudentSetupTest() {
test('SET-06 saves and reviews stable-ID student restrictions at 390px with keyboard submit', async ({ page }) => {
  test.setTimeout(120_000);
  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.goto(await nextMagicLink(previousMail));
  await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/setup#setup-student-policies`);
  await expect(page.getByRole('heading', { name: 'Restrictions and scheduling relationships' })).toBeVisible();

  await page.getByLabel('SET-05 Dancer latest finish').fill('20:15');
  await page.getByLabel('SET-05 Dancer maximum attendance days').selectOption('3');
  await page.getByRole('button', { name: 'Save student requirements' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Student requirements saved in Rulebook v\d+/)).toBeVisible({ timeout: 30_000 });

  const policies = await admin.from('rules').select('id,parameters,affected_entity_ids').eq('studio_id', studioId).in('id', ['SET06-STUDENT-LATEST-FINISH-set05-student', 'SET06-STUDENT-MAX-DAYS-set05-student']);
  if (policies.error) throw policies.error;
  expect(policies.data).toHaveLength(2);
  expect(policies.data.find((row) => row.id.includes('LATEST-FINISH')).parameters.policy).toMatchObject({ kind: 'PARTICIPANT_LATEST_FINISH', participantIds: ['set05-student'], latestFinish: '20:15' });
  expect(policies.data.find((row) => row.id.includes('MAX-DAYS')).parameters.policy).toMatchObject({ kind: 'MAX_ATTENDANCE_DAYS', participantIds: ['set05-student'], maxDays: 3 });

  const reviewRegion = page.getByLabel('Student and relationship reviews');
  const studentCard = reviewRegion.locator('article').filter({ hasText: 'SET-05 Dancer' });
  await studentCard.getByRole('button', { name: 'Review restrictions' }).click();
  await expect(studentCard).toContainText('Reviewed value', { timeout: 30_000 });
  const persisted = await admin.from('setup_review_attestations').select('aspect,outcome,dependency_fingerprint').eq('studio_id', studioId).eq('scope_kind', 'STUDENT').eq('entity_id', 'set05-student').eq('aspect', 'restrictions');
  if (persisted.error) throw persisted.error;
  expect(persisted.data).toHaveLength(1);
  expect(persisted.data[0].outcome).toBe('REVIEWED_VALUE');
  expect(persisted.data[0].dependency_fingerprint).toMatch(/^[0-9a-f]{64}$/);
});
}
