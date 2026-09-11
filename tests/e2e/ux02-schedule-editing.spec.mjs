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
  if (!value) throw new Error(`UX-02 e2e environment is missing ${name}.`);
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
  throw new Error(`Local Mailpit did not receive a new UX-02 magic-link email.${lastError ? ` Last connection error: ${lastError.message}` : ''}`);
}

async function signIn(page) {
  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for the DWDE sign-in link.')).toBeVisible();
  await page.goto(await nextMagicLink(previousMail));
  await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
}

async function currentSchedule() {
  const schedules = await admin
    .from('schedule_versions')
    .select('id,version,rulebook_version,enforcement_version,planning_dataset_version,constraint_model_version,is_current')
    .eq('studio_id', studioId)
    .order('version');
  if (schedules.error) throw schedules.error;
  const current = schedules.data.find((row) => row.is_current);
  if (!current) throw new Error('UX-02 fixture has no current ScheduleVersion.');

  const assignments = await admin
    .from('assignments')
    .select('id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status')
    .eq('schedule_version_id', current.id)
    .order('id');
  if (assignments.error) throw assignments.error;

  return { schedules: schedules.data, current, assignments: assignments.data };
}

async function confirmCurrentPlanningDataset() {
  const result = await admin
    .from('planning_dataset_versions')
    .update({
      confirmed_for_scheduling_at: new Date().toISOString(),
      confirmed_for_scheduling_by_label: 'Verify Owner',
      scheduling_confirmation_note: 'UX-02 disposable browser fixture confirmation',
    })
    .eq('studio_id', studioId)
    .eq('status', 'CURRENT')
    .select('version')
    .single();
  if (result.error) throw result.error;
}

async function setCurrentAssignmentLock(locked) {
  const snapshot = await currentSchedule();
  const result = await admin
    .from('assignments')
    .update({ locked })
    .eq('schedule_version_id', snapshot.current.id)
    .eq('session_id', sessionId)
    .select('id,locked')
    .single();
  if (result.error) throw result.error;
  return result.data;
}

export function registerUx02ScheduleEditingTest() {
  test('UX-02 covers browser editing, recovery preview, lock preservation, and persisted outcomes', async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page);

    await confirmCurrentPlanningDataset();
    const beforeRebase = await currentSchedule();
    expect(beforeRebase.assignments).toHaveLength(1);
    expect(beforeRebase.assignments[0].session_id).toBe(sessionId);

    await page.goto(`${appUrl}/schedule`);
    await expect(page.getByRole('heading', { name: 'Weekly schedule' })).toBeVisible();
    await page.getByRole('button', { name: 'Review revalidation' }).click();
    const rebasePreview = page.getByRole('dialog', { name: 'Review revalidation' });
    await expect(rebasePreview).toContainText('This is a preview. The current Schedule');
    const previewSchedule = await currentSchedule();
    expect(previewSchedule.current.version).toBe(beforeRebase.current.version);
    await rebasePreview.getByRole('button', { name: 'Revalidate as new schedule version' }).click();
    await expect(page.getByText(/Revalidated the unchanged placements as Schedule v\d+/)).toBeVisible({ timeout: 30_000 });

    const afterRebase = await currentSchedule();
    expect(afterRebase.current.version).toBeGreaterThan(beforeRebase.current.version);
    expect(afterRebase.assignments[0]).toMatchObject({ session_id: sessionId, day: 'Monday', locked: false });

    await setCurrentAssignmentLock(true);
    await page.reload();
    const lockedCard = page.getByRole('button', { name: /Verify Class, Aimee, .*locked/ });
    await expect(lockedCard).toBeVisible();
    await lockedCard.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('This placement is locked. The server will reject attempts to move it too.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).last().click();

    await page.getByRole('button', { name: 'Review undo' }).click();
    const lockedRecoveryPreview = page.getByRole('dialog', { name: 'Review undo' });
    await expect(lockedRecoveryPreview).toContainText('Locked placements are preserved');
    await lockedRecoveryPreview.getByRole('button', { name: 'Restore as new schedule version' }).click();
    await expect(page.getByText(/Restored the previous placements under current policy as Schedule v\d+/)).toBeVisible({ timeout: 30_000 });

    const afterLockedRecovery = await currentSchedule();
    expect(afterLockedRecovery.current.version).toBeGreaterThan(afterRebase.current.version);
    expect(afterLockedRecovery.assignments[0]).toMatchObject({ session_id: sessionId, day: 'Monday', locked: true });

    await setCurrentAssignmentLock(false);
    await page.reload();
    await page.getByRole('button', { name: 'Enable editing' }).click();
    await expect(page.getByRole('heading', { name: 'Editing mode' })).toBeVisible();

    const classCard = page.getByRole('button', { name: /Verify Class, Aimee, .*drag to move or tap to edit/ });
    await classCard.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Assignment inspector')).toBeVisible();
    await page.getByRole('combobox', { name: /^Day/ }).selectOption('Tuesday');
    await page.getByLabel('Reason').fill('UX-02 browser keyboard move');
    await page.getByRole('button', { name: 'Save new schedule version' }).click();
    await expect(page.getByText(/Saved as Schedule v\d+\./)).toBeVisible({ timeout: 30_000 });

    const afterMove = await currentSchedule();
    expect(afterMove.assignments[0]).toMatchObject({ session_id: sessionId, day: 'Tuesday', locked: false });

    await page.getByRole('button', { name: /Placed \(1\)/ }).click();
    await page.getByRole('button', { name: 'Unassign' }).click();
    await page.getByRole('button', { name: 'Send to Unscheduled' }).click();
    await expect(page.getByText(/Moved Verify Class to Unscheduled\. Saved as Schedule v\d+/)).toBeVisible({ timeout: 30_000 });
    expect((await currentSchedule()).assignments).toHaveLength(0);
    await expect(page.getByRole('heading', { name: '1 class session still need placement' })).toBeVisible();

    await page.getByRole('button', { name: 'Place class' }).click();
    await expect(page.getByRole('heading', { level: 2, name: /Verify Class/ })).toBeVisible();
    await page.getByRole('button', { name: 'Place class' }).last().click();
    await expect(page.getByText(/Placed Verify Class\. Saved as Schedule v\d+/)).toBeVisible({ timeout: 30_000 });
    const afterAssign = await currentSchedule();
    expect(afterAssign.assignments).toHaveLength(1);
    expect(afterAssign.assignments[0]).toMatchObject({ session_id: sessionId, day: 'Monday', locked: false });

    await page.getByRole('button', { name: /Verify Class, Aimee, .*drag to move or tap to edit/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('combobox', { name: /^Day/ }).selectOption('Tuesday');
    await page.getByLabel('Reason').fill('UX-02 browser move before undo');
    const beforeSecondMove = await currentSchedule();
    const secondMoveResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/schedule/move') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save new schedule version' }).click();
    const secondMoveResponse = await secondMoveResponsePromise;
    expect(secondMoveResponse.status()).toBe(200);
    await expect.poll(async () => (await currentSchedule()).current.version).toBeGreaterThan(beforeSecondMove.current.version);
    const beforeUndo = await currentSchedule();
    expect(beforeUndo.assignments[0].day).toBe('Tuesday');
    await page.getByRole('button', { name: 'Review undo' }).click();
    const undoPreview = page.getByRole('dialog', { name: 'Review undo' });
    await expect(undoPreview).toContainText('This is a preview. The current Schedule');
    expect((await currentSchedule()).current.version).toBe(beforeUndo.current.version);
    await undoPreview.getByRole('button', { name: 'Restore as new schedule version' }).click();
    await expect(page.getByText(/Restored the previous placements under current policy as Schedule v\d+/)).toBeVisible({ timeout: 30_000 });
    const afterUndo = await currentSchedule();
    expect(afterUndo.current.version).toBeGreaterThan(beforeUndo.current.version);
    expect(afterUndo.assignments[0].day).toBe('Monday');

    await page.getByText('Version history').click();
    await expect(page.getByText('Restored previous schedule').first()).toBeVisible();
  });
}
