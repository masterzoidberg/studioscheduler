import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const mailpitUrl = process.env.E2E_MAILPIT_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;
const sessionId = 'verify01-session';

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, mailpitUrl, ownerEmail, studioId })) {
  if (!value) throw new Error(`LOCK-01 e2e environment is missing ${name}.`);
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
  throw new Error('Local Mailpit did not receive a new LOCK-01 magic-link email.');
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

async function currentState() {
  const schedules = await admin
    .from('schedule_versions')
    .select('id,version,is_current')
    .eq('studio_id', studioId)
    .order('version');
  if (schedules.error) throw schedules.error;
  const current = schedules.data.find((row) => row.is_current);
  if (!current) throw new Error('LOCK-01 fixture has no current schedule.');

  const assignment = await admin
    .from('assignments')
    .select('id,session_id,locked')
    .eq('schedule_version_id', current.id)
    .eq('session_id', sessionId)
    .single();
  if (assignment.error) throw assignment.error;
  const session = await admin
    .from('class_sessions')
    .select('id,locked')
    .eq('studio_id', studioId)
    .eq('id', sessionId)
    .single();
  if (session.error) throw session.error;
  const planning = await admin
    .from('planning_dataset_versions')
    .select('version,confirmed_for_scheduling_at')
    .eq('studio_id', studioId)
    .eq('status', 'CURRENT')
    .single();
  if (planning.error) throw planning.error;
  return { schedules: schedules.data, current, assignment: assignment.data, session: session.data, planning: planning.data };
}

export function registerLock01SessionLockTest() {
  test('LOCK-01 toggles one exact session through the governed browser action', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const before = await currentState();
    expect(before.assignment.locked).toBe(false);
    expect(before.session.locked).toBe(false);

    await page.goto(`${appUrl}/schedule`);
    await expect(page.getByRole('heading', { name: 'Weekly schedule' })).toBeVisible();
    await page.getByRole('button', { name: 'Enable editing' }).click();
    await expect(page.getByRole('heading', { name: 'Editing mode' })).toBeVisible();

    const card = page.getByRole('button', { name: /Verify Class, Aimee, .*drag to move or tap to edit/ });
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Assignment inspector')).toBeVisible();
    await expect(page.getByText(/Session 1 · Monday/)).toBeVisible();
    await expect(page.getByText('Effective lock: Unlocked')).toBeVisible();
    await page.getByLabel('Reason').fill('LOCK-01 browser lock for the selected placement');

    const lockResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/schedule/lock') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Lock session' }).click();
    const lockResponse = await lockResponsePromise;
    const lockPayload = await lockResponse.json();
    expect(lockResponse.status()).toBe(200);
    expect(lockPayload.status).toBe('LOCKED');
    expect(lockPayload.certificationStale).toBe(true);
    expect(lockPayload.candidateStale).toBe(true);
    await expect(page.getByText(/Locked Session 1 as Schedule v\d+\. The current certification and solver candidates are stale/)).toBeVisible({ timeout: 30_000 });

    const locked = await currentState();
    expect(locked.current.version).toBeGreaterThan(before.current.version);
    expect(locked.assignment.locked).toBe(true);
    expect(locked.session.locked).toBe(true);
    expect(locked.planning.version).toBeGreaterThan(before.planning.version);
    expect(locked.planning.confirmed_for_scheduling_at).toBeNull();

    await page.reload();
    await page.getByRole('button', { name: 'Enable editing' }).click();
    await page.getByRole('button', { name: /Verify Class, Aimee, .*locked/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Effective lock: Locked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock session' })).toBeVisible();
    await page.getByLabel('Reason').fill('LOCK-01 browser unlock for the selected placement');

    const unlockResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/schedule/lock') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Unlock session' }).click();
    const unlockResponse = await unlockResponsePromise;
    const unlockPayload = await unlockResponse.json();
    expect(unlockResponse.status()).toBe(200);
    expect(unlockPayload.status).toBe('UNLOCKED');
    await expect(page.getByText(/Unlocked Session 1 as Schedule v\d+/)).toBeVisible({ timeout: 30_000 });

    const unlocked = await currentState();
    expect(unlocked.current.version).toBeGreaterThan(locked.current.version);
    expect(unlocked.assignment.locked).toBe(false);
    expect(unlocked.session.locked).toBe(false);
  });
}
