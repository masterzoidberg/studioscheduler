import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, ownerEmail, studioId })) {
  if (!value) throw new Error(`SET-04 e2e environment is missing ${name}.`);
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
  throw new Error('SET-04 local Mailpit did not receive a new sign-in link.');
}

export function registerSet04TeacherSetupTest() {
test('SET-04 saves explicit teacher setup and persists both review attestations', async ({ page }) => {
  test.setTimeout(120_000);
  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for the sign-in link.')).toBeVisible();
  await page.goto(await nextMagicLink(previousMail));
  await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/setup`);

  await expect(page.getByRole('heading', { name: 'Availability and qualifications' })).toBeVisible();
  const teacher = page.locator('#setup-teacher-policies article').filter({ hasText: 'Aimee' });
  await expect(teacher).toBeVisible();
  await teacher.getByText('No additional availability restriction (review explicitly)').click();
  await teacher.locator('label').filter({ hasText: 'Verify Class' }).locator('input').check();
  await page.getByRole('button', { name: 'Save teacher setup' }).click();
  await expect(page.getByRole('status')).toContainText(/Teacher setup saved in Rulebook v\d+/, { timeout: 30_000 });

  const availability = await admin.from('rules').select('id,parameters,affected_entity_ids').eq('studio_id', studioId).eq('id', 'SET04-TEACHER-AVAILABILITY-verify01-teacher').single();
  if (availability.error) throw availability.error;
  expect(availability.data.parameters.policy.kind).toBe('TEACHER_DAY_WINDOW');
  expect(availability.data.parameters.policy.teacherId).toBe('verify01-teacher');
  expect(availability.data.affected_entity_ids).toContain('verify01-teacher');

  const qualification = await admin.from('rules').select('id,parameters,affected_entity_ids').eq('studio_id', studioId).eq('id', 'SET04-TEACHER-QUALIFICATION-verify01-teacher').single();
  if (qualification.error) throw qualification.error;
  expect(qualification.data.parameters.policy).toMatchObject({ kind: 'TEACHER_QUALIFICATION', teacherId: 'verify01-teacher', classIds: ['verify01-class'] });
  expect(qualification.data.affected_entity_ids).toEqual(['verify01-teacher', 'verify01-class']);

  const reviewCard = page.locator('#setup-teacher-policies article').filter({ hasText: 'Aimee' });
  await reviewCard.getByRole('button', { name: 'Review availability' }).click();
  await expect(reviewCard).toContainText('Availability: Reviewed value', { timeout: 30_000 });
  await reviewCard.getByRole('button', { name: 'Review qualifications' }).click();
  await expect(reviewCard).toContainText('Qualifications: Reviewed value', { timeout: 30_000 });

  const persisted = await admin.from('setup_review_attestations').select('aspect,outcome,dependency_fingerprint,reviewer_label').eq('studio_id', studioId).eq('scope_kind', 'TEACHER').eq('entity_id', 'verify01-teacher').order('created_at');
  if (persisted.error) throw persisted.error;
  expect(persisted.data.filter((row) => row.aspect === 'availability')).toHaveLength(1);
  expect(persisted.data.filter((row) => row.aspect === 'qualification')).toHaveLength(1);
  expect(persisted.data.every((row) => row.outcome === 'REVIEWED_VALUE' && row.reviewer_label === 'Verify Owner' && /^[0-9a-f]{64}$/.test(row.dependency_fingerprint))).toBe(true);
});
}
