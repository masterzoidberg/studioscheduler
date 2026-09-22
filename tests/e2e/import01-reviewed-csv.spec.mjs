import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const appUrl = process.env.E2E_APP_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const mailpitUrl = process.env.E2E_MAILPIT_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const studioId = process.env.E2E_STUDIO_ID;

for (const [name, value] of Object.entries({ appUrl, supabaseUrl, serviceRoleKey, mailpitUrl, ownerEmail, studioId })) {
  if (!value) throw new Error(`IMPORT-01 e2e environment is missing ${name}.`);
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function latestMagicLink() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${mailpitUrl}/view/latest.txt`);
    if (response.ok) {
      const text = await response.text();
      const links = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
      const link = links.find((candidate) => candidate.includes('/auth/v1/verify'));
      if (link) return link.replace(/&amp;/g, '&').replace(/[)>.,]+$/, '');
    }
    await delay(250);
  }
  throw new Error('IMPORT-01 local Mailpit did not receive a sign-in link.');
}

export function registerImport01ReviewedCsvTest() {
  test('IMPORT-01 previews and atomically applies reviewed CSV inventory with persisted provenance', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(appUrl);
    await page.getByLabel('Email address').fill(ownerEmail);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByText('Check your email for the sign-in link.')).toBeVisible();
    await page.goto(await latestMagicLink());
    await expect(page.getByText(`${ownerEmail} · OWNER`)).toBeVisible({ timeout: 30_000 });
    await page.goto(`${appUrl}/settings`);
    await expect(page.getByRole('heading', { name: 'Reviewed CSV intake' })).toBeVisible();

    const before = await admin.from('planning_dataset_versions').select('version').eq('studio_id', studioId).eq('status', 'CURRENT').single();
    if (before.error) throw before.error;

    await page.getByLabel('Teachers CSV').setInputFiles({
      name: 'teachers.csv', mimeType: 'text/csv',
      buffer: Buffer.from('id,name,notes\nimport-e2e-teacher,CSV Teacher,\n'),
    });
    await page.getByLabel('Students CSV').setInputFiles({
      name: 'students.csv', mimeType: 'text/csv',
      buffer: Buffer.from('id,name,level\nimport-e2e-student,CSV Student,Level 1\n'),
    });
    await page.getByLabel('Classes CSV').setInputFiles({
      name: 'classes.csv', mimeType: 'text/csv',
      buffer: Buffer.from('id,name,subject,level,duration_minutes,weekly_frequency,company_only\nimport-e2e-class,CSV Class,Jazz,1,45,1,false\n'),
    });
    await page.getByLabel('Roster CSV').setInputFiles({
      name: 'roster.csv', mimeType: 'text/csv',
      buffer: Buffer.from('class_id,student_id\nimport-e2e-class,import-e2e-student\n'),
    });

    await expect(page.getByText(/1\s*roster links/)).toBeVisible();
    await expect(page.getByText('Fix before applying')).toHaveCount(0);
    await page.getByLabel(/I reviewed the stable IDs/).check();
    await page.getByRole('button', { name: 'Apply reviewed batch' }).click();
    await expect(page.getByRole('status')).toContainText(/Applied 3 reviewed planning rows\. Planning Dataset advanced to v\d+/, { timeout: 30_000 });

    const [teacher, student, klass, planning, audit] = await Promise.all([
      admin.from('teachers').select('id,name').eq('studio_id', studioId).eq('id', 'import-e2e-teacher').single(),
      admin.from('students').select('id,name,level').eq('studio_id', studioId).eq('id', 'import-e2e-student').single(),
      admin.from('class_definitions').select('id,name,roster_student_ids').eq('studio_id', studioId).eq('id', 'import-e2e-class').single(),
      admin.from('planning_dataset_versions').select('version').eq('studio_id', studioId).eq('status', 'CURRENT').single(),
      admin.from('audit_events').select('payload').eq('studio_id', studioId).eq('action', 'PLANNING_IMPORT_APPLIED').order('created_at', { ascending: false }).limit(20),
    ]);
    for (const result of [teacher, student, klass, planning, audit]) if (result.error) throw result.error;
    expect(teacher.data.name).toBe('CSV Teacher');
    expect(student.data.level).toBe('Level 1');
    expect(klass.data.roster_student_ids).toEqual(['import-e2e-student']);
    expect(planning.data.version).toBeGreaterThan(before.data.version);
    const importAudit = audit.data.find((row) => row.payload?.sourceMetadata?.source === 'BROWSER_CSV_REVIEW');
    expect(importAudit?.payload.importCounts.rows).toBe(3);
  });
}
