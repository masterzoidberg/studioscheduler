import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { registerSet01RoomCapacityReviewTest } from './set01-room-capacity-review.spec.mjs';
import { registerSet02SetupDashboardTest } from './set02-setup-dashboard.spec.mjs';
import { registerSet03SetupPolicyTest } from './set03-setup-policies.spec.mjs';
import { registerSet04TeacherSetupTest } from './set04-teacher-setup.spec.mjs';
import { registerSet05ClassSetupTest } from './set05-class-setup.spec.mjs';
import { registerSet06StudentSetupTest } from './set06-student-setup.spec.mjs';
import { registerUx02ScheduleEditingTest } from './ux02-schedule-editing.spec.mjs';
import { registerLock01SessionLockTest } from './lock01-session-lock.spec.mjs';
import { registerUx03ScheduleExportTest } from './ux03-schedule-export.spec.mjs';
import { registerImport01ReviewedCsvTest } from './import01-reviewed-csv.spec.mjs';
import { registerSet08SetupAssignmentsTest } from './set08-setup-assignments.spec.mjs';
import './gen04-empty-workspace.spec.mjs';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const mailpitUrl = process.env.E2E_MAILPIT_URL;
const dbContainer = process.env.E2E_DB_CONTAINER;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;
const assignmentId = 'verify01-assignment';

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, mailpitUrl, dbContainer, ownerEmail, studioId })) {
  if (!value) throw new Error(`VERIFY-01 e2e environment is missing ${name}.`);
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

async function latestMagicLink(previousText = null) {
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
  throw new Error(`Local Mailpit did not receive a Supabase magic-link email.${lastError ? ` Last connection error: ${lastError.message}` : ''}`);
}

async function signInWithMagicLink(page, email) {
  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for the sign-in link.')).toBeVisible();
  await page.goto(await latestMagicLink(previousMail));
}

async function probeSchedule() {
  const schedules = await admin
    .from('schedule_versions')
    .select('id,version,is_current')
    .eq('studio_id', studioId)
    .order('version');
  if (schedules.error) throw schedules.error;
  const current = schedules.data.find((row) => row.is_current);
  if (!current) throw new Error('VERIFY-01 fixture has no current schedule.');

  const assignment = await admin
    .from('assignments')
    .select('id,day,start_time,end_time,teacher_id,room_id,locked,status')
    .eq('schedule_version_id', current.id)
    .eq('id', assignmentId)
    .single();
  if (assignment.error) throw assignment.error;

  const audit = await admin
    .from('audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('studio_id', studioId)
    .eq('action', 'SCHEDULE_COMMAND')
    .eq('entity_id', assignmentId);
  if (audit.error) throw audit.error;

  const planning = await admin
    .from('planning_dataset_versions')
    .select('version')
    .eq('studio_id', studioId)
    .eq('status', 'CURRENT')
    .single();
  if (planning.error) throw planning.error;

  return {
    scheduleCount: schedules.data.length,
    currentScheduleId: current.id,
    currentScheduleVersion: current.version,
    assignment: assignment.data,
    scheduleCommandAuditCount: audit.count ?? 0,
    planningDatasetVersion: planning.data.version,
  };
}

async function probeOutageSchedule() {
  const schedules = await admin
    .from('schedule_versions')
    .select('id,version,is_current')
    .eq('studio_id', studioId)
    .order('version');
  if (schedules.error) throw schedules.error;
  const current = schedules.data.find((row) => row.is_current);
  if (!current) throw new Error('VERIFY-01 outage fixture has no current schedule.');

  const [assignments, audit, planning] = await Promise.all([
    admin.from('assignments').select('id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status').eq('schedule_version_id', current.id).order('id'),
    admin.from('audit_events').select('id', { count: 'exact', head: true }).eq('studio_id', studioId).eq('action', 'SCHEDULE_COMMAND'),
    admin.from('planning_dataset_versions').select('version').eq('studio_id', studioId).eq('status', 'CURRENT').single(),
  ]);
  for (const result of [assignments, audit, planning]) if (result.error) throw result.error;
  return {
    scheduleCount: schedules.data.length,
    currentScheduleVersion: current.version,
    assignments: assignments.data,
    scheduleCommandAuditCount: audit.count ?? 0,
    planningDatasetVersion: planning.data.version,
  };
}

function holdStudioCommitLock(seconds = 6) {
  const sql = [
    'begin;',
    `select pg_advisory_xact_lock(hashtextextended('${studioId}'::text,0));`,
    `do $verify01$ begin update public.assignments set locked=true where studio_id='${studioId}' and id='${assignmentId}' and schedule_version_id=(select id from public.schedule_versions where studio_id='${studioId}' and is_current order by version desc limit 1); if not found then raise exception 'VERIFY01 assignment missing while staging stale context'; end if; end $verify01$;`,
    "select 'VERIFY01_LOCK_ACQUIRED';",
    `select pg_sleep(${seconds});`,
    'commit;',
  ].join(' ');

  const child = spawn('docker', [
    'exec', '-i', dbContainer,
    'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', sql,
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let stdout = '';
  let stderr = '';
  let acquiredResolve;
  let acquiredReject;
  const acquired = new Promise((resolve, reject) => {
    acquiredResolve = resolve;
    acquiredReject = reject;
  });
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes('VERIFY01_LOCK_ACQUIRED')) acquiredResolve();
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      acquiredReject(error);
      reject(error);
    });
    child.on('exit', (code) => {
      if (!stdout.includes('VERIFY01_LOCK_ACQUIRED')) acquiredReject(new Error(`Advisory-lock helper exited before acquiring the lock. ${stderr}`));
      if (code === 0) resolve();
      else reject(new Error(`Advisory-lock helper exited ${code}. ${stderr}`));
    });
  });

  return { acquired, done };
}

test('OWNER login, governed inventory write, and conflicting authoritative MOVE reject without schedule write', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for the sign-in link.')).toBeVisible();

  const magicLink = await latestMagicLink();
  await page.goto(magicLink);
  await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });

  const before = await probeSchedule();
  expect(before.assignment.locked).toBe(false);
  expect(before.assignment.day).toBe('Monday');

  await page.goto(`${appUrl}/schedule`);
  await expect(page.getByRole('heading', { name: 'Weekly schedule' })).toBeVisible();
  await page.getByRole('button', { name: 'Enable editing' }).click();
  await expect(page.getByRole('heading', { name: 'Editing mode' })).toBeVisible();
  await page.getByRole('button', { name: /Verify Class, Aimee, .*drag to move or tap to edit/ }).click();
  await expect(page.getByText('Assignment inspector')).toBeVisible();
  await page.getByRole('combobox', { name: /^Day/ }).selectOption('Tuesday');
  await page.getByLabel('Reason').fill('VERIFY-01 concurrent authoritative conflict rejection');

  const saveButton = page.getByRole('button', { name: 'Save new schedule version' });
  await expect(saveButton).toBeEnabled();
  const saveEnabledBeforeClick = await saveButton.isEnabled();
  const observedScheduleRequests = [];
  const recordScheduleRequest = (request) => {
    if (request.url().includes('/api/schedule/')) {
      observedScheduleRequests.push(`${request.method()} ${request.url()}`);
    }
  };
  page.on('request', recordScheduleRequest);

  const blocker = holdStudioCommitLock();
  await blocker.acquired;
  const moveRequestPromise = page.waitForRequest((request) =>
    request.url().includes('/api/schedule/move') && request.method() === 'POST', { timeout: 5_000 }).catch(() => null);
  await saveButton.click();
  const moveRequest = await moveRequestPromise;
  if (!moveRequest) {
    await delay(300);
    const saveEnabledAfterClick = await saveButton.isEnabled().catch(() => false);
    const visibleSections = (await page.locator('section').allTextContents())
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20);
    page.off('request', recordScheduleRequest);
    await blocker.done;
    throw new Error(
      `VERIFY-01 Save emitted no POST /api/schedule/move. ` +
      `saveEnabledBeforeClick=${saveEnabledBeforeClick}; ` +
      `saveEnabledAfterClick=${saveEnabledAfterClick}; ` +
      `observedScheduleRequests=${JSON.stringify(observedScheduleRequests)}; ` +
      `visibleSections=${JSON.stringify(visibleSections)}`,
    );
  }
  page.off('request', recordScheduleRequest);

  await blocker.done;
  const moveResponse = await moveRequest.response();
  expect(moveResponse).not.toBeNull();
  const movePayload = await moveResponse.json();
  if (moveResponse.status() !== 409) {
    throw new Error(`VERIFY-01 expected authoritative conflict HTTP 409, received ${moveResponse.status()}: ${JSON.stringify(movePayload)}`);
  }
  expect(movePayload.status).toBe('BLOCKED');
  expect([
    'MANUAL_MOVE_CONTEXT_CHANGED_RETRY',
    'MANUAL_MOVE_TRANSACTION_REJECTED',
  ]).toContain(movePayload.code);
  expect(typeof movePayload.error).toBe('string');
  expect(movePayload.error.length).toBeGreaterThan(0);

  const rejected = await probeSchedule();
  expect(rejected.scheduleCount).toBe(before.scheduleCount);
  expect(rejected.currentScheduleId).toBe(before.currentScheduleId);
  expect(rejected.currentScheduleVersion).toBe(before.currentScheduleVersion);
  expect(rejected.scheduleCommandAuditCount).toBe(before.scheduleCommandAuditCount);
  expect(rejected.assignment.day).toBe(before.assignment.day);
  expect(rejected.assignment.start_time).toBe(before.assignment.start_time);
  expect(rejected.assignment.end_time).toBe(before.assignment.end_time);
  expect(rejected.assignment.teacher_id).toBe(before.assignment.teacher_id);
  expect(rejected.assignment.room_id).toBe(before.assignment.room_id);
  expect(rejected.assignment.locked).toBe(true);

  const unlock = await admin
    .from('assignments')
    .update({ locked: false })
    .eq('schedule_version_id', before.currentScheduleId)
    .eq('id', assignmentId)
    .select('id,locked')
    .single();
  if (unlock.error) throw unlock.error;

  await page.goto(`${appUrl}/people`);
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await page.getByRole('button', { name: 'Rooms' }).click();
  await page.getByRole('button', { name: 'Add room' }).click();
  await expect(page.getByRole('heading', { name: 'Add room' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Verify Overflow Room');
  await page.getByLabel('Capacity', { exact: true }).fill('12');
  await page.getByLabel('Features', { exact: true }).fill('sprung floor');
  await page.getByRole('button', { name: 'Add room' }).last().click();
  await expect(page.getByText(/Room added\. Planning Dataset advanced to v\d+/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Verify Overflow Room', level: 2 })).toBeVisible();

  const persistedRoom = await admin
    .from('rooms')
    .select('id,name,capacity,features')
    .eq('studio_id', studioId)
    .eq('name', 'Verify Overflow Room')
    .single();
  if (persistedRoom.error) throw persistedRoom.error;
  expect(persistedRoom.data.capacity).toBe(12);
  expect(persistedRoom.data.features).toContain('sprung floor');

  const afterInventory = await probeSchedule();
  expect(afterInventory.planningDatasetVersion).toBeGreaterThan(before.planningDatasetVersion);
  expect(afterInventory.currentScheduleVersion).toBe(before.currentScheduleVersion);
});

test('M01 invitation stays pending through signup and is explicitly accepted in the invited tenant', async ({ browser }) => {
  test.setTimeout(120_000);

  const inviteEmail = 'm01-invitee@example.test';
  const ownerPage = await browser.newPage();
  const inviteePage = await browser.newPage();
  let inviteeUserId = null;

  try {
    await signInWithMagicLink(ownerPage, ownerEmail);
    await expect(ownerPage.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
    await ownerPage.goto(`${appUrl}/settings`);
    await expect(ownerPage.getByRole('heading', { name: 'Studio access' })).toBeVisible();
    await ownerPage.getByPlaceholder('person@example.com').fill(inviteEmail);
    await ownerPage.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(ownerPage.getByText(new RegExp(`Invitation created for ${inviteEmail}`))).toBeVisible();

    const invitation = await admin
      .from('studio_invites')
      .select('id,studio_id,email,role,created_at,expires_at,accepted_at,revoked_at')
      .eq('studio_id', studioId)
      .eq('email', inviteEmail)
      .single();
    if (invitation.error) throw invitation.error;
    expect(invitation.data.role).toBe('EDITOR');
    expect(invitation.data.accepted_at).toBeNull();
    expect(invitation.data.revoked_at).toBeNull();
    expect(Date.parse(invitation.data.expires_at)).toBeGreaterThan(Date.parse(invitation.data.created_at));

    const created = await admin.auth.admin.createUser({ email: inviteEmail, email_confirm: true });
    if (created.error) throw created.error;
    inviteeUserId = created.data.user.id;
    const preAcceptanceMembership = await admin
      .from('studio_members')
      .select('studio_id,role')
      .eq('user_id', inviteeUserId)
      .eq('studio_id', studioId);
    if (preAcceptanceMembership.error) throw preAcceptanceMembership.error;
    expect(preAcceptanceMembership.data).toEqual([]);

    await signInWithMagicLink(inviteePage, inviteEmail);
    const studio = await admin.from('studios').select('name').eq('id', studioId).single();
    if (studio.error) throw studio.error;
    const acceptButton = inviteePage.getByRole('button', { name: `Accept invitation to ${studio.data.name}` });
    await expect(acceptButton).toBeVisible({ timeout: 30_000 });
    await acceptButton.click();
    await expect(inviteePage.getByText(`${inviteEmail} · EDITOR`)).toBeVisible({ timeout: 30_000 });

    const membership = await admin
      .from('studio_members')
      .select('studio_id,role')
      .eq('user_id', inviteeUserId)
      .eq('studio_id', studioId)
      .single();
    if (membership.error) throw membership.error;
    expect(membership.data.role).toBe('EDITOR');
    const acceptedInvitation = await admin.from('studio_invites').select('accepted_at,revoked_at').eq('id', invitation.data.id).single();
    if (acceptedInvitation.error) throw acceptedInvitation.error;
    expect(acceptedInvitation.data.accepted_at).not.toBeNull();
    expect(acceptedInvitation.data.revoked_at).toBeNull();
  } finally {
    await inviteePage.close();
    await ownerPage.close();
  }
});

test('OPS-02 reports a synthetic solver failure with safe diagnostics and leaves the current schedule unchanged', async ({ browser }) => {
  const timeout = process.env.E2E_SIMULATE_SOLVER_TIMEOUT === '1';
  test.skip(process.env.E2E_SIMULATE_SOLVER_OUTAGE !== '1' && !timeout, 'Run through a disposable solver outage or timeout mode.');
  test.setTimeout(120_000);

  const page = await browser.newPage();
  try {
    await signInWithMagicLink(page, ownerEmail);
    await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
    await page.goto(`${appUrl}/readiness`);
    await expect(page.getByRole('heading', { name: 'Build a schedule' })).toBeVisible();

    const before = await probeOutageSchedule();
    const buildButton = page.getByRole('button', { name: 'Build schedule', exact: true });
    await expect(buildButton).toBeEnabled({ timeout: 30_000 });
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/solver/feasibility') && response.request().method() === 'POST',
    );
    await buildButton.click();
    const response = await responsePromise;
    const httpStatus = timeout ? 504 : 503;
    const code = timeout ? 'SOLVER_SERVICE_TIMEOUT' : 'SOLVER_SERVICE_UNAVAILABLE';
    expect(response.status()).toBe(httpStatus);
    const requestId = response.headers()['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const failure = await response.json();
    expect(failure.code).toBe(code);
    await expect(page.getByText(timeout
      ? 'We could not determine whether a schedule exists'
      : 'Schedule builder is temporarily unavailable')).toBeVisible();
    await expect(page.getByText(requestId, { exact: true })).toBeVisible();

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy safe support details' }).click();
    await expect(page.getByRole('button', { name: 'Support details copied' })).toBeVisible();
    const supportBundle = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(supportBundle).toEqual({
      schemaVersion: 'studio-scheduler/solver-support-v1',
      requestId,
      code,
      httpStatus,
    });
    expect(JSON.stringify({ requestId: supportBundle.requestId, code: supportBundle.code, httpStatus: supportBundle.httpStatus }))
      .not.toMatch(/student|teacher|roster|assignment|room|schedule/i);

    await page.getByText('Help with setup, generation, editing, and recovery').click();
    await expect(page.getByRole('link', { name: 'Must happen requirements' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit schedule' })).toBeVisible();
    const after = await probeOutageSchedule();
    expect(after.scheduleCount).toBe(before.scheduleCount);
    expect(after.currentScheduleVersion).toBe(before.currentScheduleVersion);
    expect(after.assignments).toEqual(before.assignments);
    expect(after.scheduleCommandAuditCount).toBe(before.scheduleCommandAuditCount);
    expect(after.planningDatasetVersion).toBe(before.planningDatasetVersion);
  } finally {
    await page.close();
  }
});

registerUx02ScheduleEditingTest();
registerLock01SessionLockTest();
registerSet01RoomCapacityReviewTest();
registerSet03SetupPolicyTest();
registerSet04TeacherSetupTest();
registerSet05ClassSetupTest();
registerSet06StudentSetupTest();
registerSet02SetupDashboardTest();
registerSet08SetupAssignmentsTest();
registerUx03ScheduleExportTest();
registerImport01ReviewedCsvTest();
