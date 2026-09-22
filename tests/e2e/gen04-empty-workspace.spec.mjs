import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const mailpitUrl = process.env.E2E_MAILPIT_URL;

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, mailpitUrl })) {
  if (!value) throw new Error(`GEN-04 e2e environment is missing ${name}.`);
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
        const links = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
        const link = links.find((candidate) => candidate.includes('/auth/v1/verify'));
        if (link) return link.replace(/&amp;/g, '&').replace(/[)>.,]+$/, '');
      }
    }
    await delay(250);
  }
  throw new Error('Local Mailpit did not receive the GEN-04 magic-link email.');
}

test('GEN-04 creates an empty workspace through the browser onboarding path', async ({ page }) => {
  test.setTimeout(120_000);

  const ownerEmail = `gen04-owner-${process.pid}@example.test`;
  const workspaceName = 'GEN-04 Empty Workspace';
  const workspaceSlug = `gen04-empty-${process.pid}`;
  const createdUser = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
    user_metadata: { full_name: 'GEN-04 Owner' },
  });
  if (createdUser.error || !createdUser.data.user) throw createdUser.error || new Error('GEN-04 user was not created.');

  const previousMail = await latestMailText();
  await page.goto(appUrl);
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for the sign-in link.')).toBeVisible();
  await page.goto(await nextMagicLink(previousMail));

  await expect(page.getByRole('heading', { name: 'Set up your workspace', level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('You are signed in. Create a workspace or accept an invitation to continue.')).toBeVisible();
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel(/Workspace link/).fill(workspaceSlug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.goto(`${appUrl}/rulebook`);
  await expect(page.getByText(`${workspaceName} Rulebook`)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('DWDE');
  await expect(page.locator('body')).not.toContainText('Cami');

  const studio = await admin.from('studios').select('id,name,slug').eq('slug', workspaceSlug).single();
  if (studio.error) throw studio.error;

  const [members, requests, rulebook, enforcement, planning, rules, entityCounts, models] = await Promise.all([
    admin.from('studio_members').select('user_id,role').eq('studio_id', studio.data.id),
    admin.from('studio_creation_requests').select('request_id').eq('studio_id', studio.data.id),
    admin.from('rulebook_versions').select('version,snapshot,source_metadata,rule_count,format_version,document_type').eq('studio_id', studio.data.id).eq('status', 'CURRENT').single(),
    admin.from('rule_enforcement_versions').select('version,snapshot').eq('studio_id', studio.data.id).eq('status', 'CURRENT').single(),
    admin.from('planning_dataset_versions').select('version,snapshot').eq('studio_id', studio.data.id).eq('status', 'CURRENT').single(),
    admin.from('rules').select('id', { count: 'exact', head: true }).eq('studio_id', studio.data.id),
    Promise.all(['teachers', 'rooms', 'students', 'class_definitions', 'class_sessions', 'assignments'].map(async (table) => {
      const result = await admin.from(table).select('id', { count: 'exact', head: true }).eq('studio_id', studio.data.id);
      if (result.error) throw result.error;
      return [table, result.count ?? 0];
    })),
    admin.from('constraint_model_versions').select('id', { count: 'exact', head: true }).eq('studio_id', studio.data.id),
  ]);
  for (const result of [members, requests, rulebook, enforcement, planning, rules, models]) {
    if (result.error) throw result.error;
  }

  expect(studio.data).toMatchObject({ name: workspaceName, slug: workspaceSlug });
  expect(members.data).toEqual([{ user_id: createdUser.data.user.id, role: 'OWNER' }]);
  expect(requests.data).toHaveLength(1);
  expect(rulebook.data).toMatchObject({
    version: 1,
    snapshot: [],
    rule_count: 0,
    format_version: '1.0',
    document_type: 'STUDIO_RULEBOOK',
    source_metadata: { provisioning: 'EMPTY_WORKSPACE', seeded: false },
  });
  expect(enforcement.data).toMatchObject({ version: 1, snapshot: [] });
  expect(planning.data.version).toBe(1);
  expect(rules.count).toBe(0);
  expect(Object.fromEntries(entityCounts)).toEqual({
    teachers: 0,
    rooms: 0,
    students: 0,
    class_definitions: 0,
    class_sessions: 0,
    assignments: 0,
  });
  expect(models.count).toBe(0);
});
