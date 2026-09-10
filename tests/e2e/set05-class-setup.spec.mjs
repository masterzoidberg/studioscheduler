import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;
for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, ownerEmail, studioId })) if (!value) throw new Error(`SET-05 e2e environment is missing ${name}.`);
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function latestMailText() { try { const response = await fetch(`${process.env.E2E_MAILPIT_URL}/view/latest.txt`); return response.ok ? await response.text() : ''; } catch { return ''; } }
async function nextMagicLink(previousText) { for (let attempt = 0; attempt < 40; attempt += 1) { const text = await latestMailText(); if (text && text !== previousText) { const link = (text.match(/https?:\/\/[^\s<>"']+/g) ?? []).find((candidate) => candidate.includes('/auth/v1/verify')); if (link) return link.replace(/&amp;/g, '&').replace(/[)>.,]+$/, ''); } await delay(250); } throw new Error('SET-05 local Mailpit did not receive a sign-in link.'); }

export function registerSet05ClassSetupTest() {
test('SET-05 manages class details, typed assignment policy, and persisted reviews at 390px', async ({ page }) => {
  test.setTimeout(120_000);
  const student = await admin.from('students').upsert({ id: 'set05-student', studio_id: studioId, name: 'SET-05 Dancer', level: 'Test Level', cohort_ids: [] });
  if (student.error) throw student.error;

  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.goto(await nextMagicLink(previousMail));
  await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/setup`);
  await expect(page.locator('#setup-class-details')).toBeVisible();

  await page.getByRole('button', { name: 'Edit Verify Class' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Verify Class' })).toBeVisible();
  await page.getByPlaceholder('Search students').fill('SET-05 Dancer');
  await page.getByRole('button', { name: 'Select all matching' }).click();
  await page.getByRole('button', { name: 'Save class' }).click();
  await expect(page.getByText(/Class updated\. Planning Dataset advanced to v\d+/)).toBeVisible({ timeout: 30_000 });
  const rostered = await admin.from('class_definitions').select('roster_student_ids,eligible_teacher_ids,company_only').eq('studio_id', studioId).eq('id', 'verify01-class').single();
  if (rostered.error) throw rostered.error;
  expect(rostered.data.roster_student_ids).toContain('set05-student');
  expect(rostered.data.eligible_teacher_ids).toEqual([]);

  await page.getByRole('button', { name: 'Edit Verify Class' }).click();
  await page.getByLabel('Must happen · teacher').selectOption('verify01-teacher');
  await page.getByLabel('Prefer · teacher').selectOption('verify01-teacher');
  await page.getByLabel('Must happen · room').selectOption('verify01-room');
  await page.getByLabel('Prefer · room').selectOption('verify01-room');
  await page.getByRole('button', { name: 'Save Must happen and Prefer' }).click();
  await expect(page.getByText(/Must happen and Prefer choices saved in Rulebook v\d+/)).toBeVisible({ timeout: 30_000 });
  const policies = await admin.from('rules').select('id,parameters,affected_entity_ids').eq('studio_id', studioId).like('id', 'SET05-CLASS-%-verify01-class');
  if (policies.error) throw policies.error;
  expect(policies.data).toHaveLength(4);
  expect(policies.data.every((row) => row.parameters.policy.classIds[0] === 'verify01-class' && row.affected_entity_ids.includes('verify01-class'))).toBe(true);

  await page.getByRole('button', { name: 'Review structure' }).click();
  await expect(page.getByText('Verify Class structure is reviewed for the current setup.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Review roster' }).click();
  await expect(page.getByText('Verify Class roster is reviewed for the current setup.')).toBeVisible({ timeout: 30_000 });
  const persisted = await admin.from('setup_review_attestations').select('aspect,dependency_fingerprint').eq('studio_id', studioId).eq('scope_kind', 'CLASS').eq('entity_id', 'verify01-class');
  if (persisted.error) throw persisted.error;
  expect(persisted.data.map((row) => row.aspect).sort()).toEqual(['roster', 'structure']);
  expect(persisted.data.every((row) => /^[0-9a-f]{64}$/.test(row.dependency_fingerprint))).toBe(true);
});
}
