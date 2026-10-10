import { neon } from "@neondatabase/serverless";
import type { FaceDescriptorEngine, FaceDeviceClass, FaceTemplateRole } from "@/lib/face-types";
import type { AdminStats, AdminUserRecord, Candidate, ExportVoterRecord, UserRole, VoterRecord } from "@/lib/types";

export type StoredFaceTemplateInput = {
  templateRole: FaceTemplateRole;
  descriptorEngine: FaceDescriptorEngine;
  modelVersion: string;
  sourceDeviceClass: FaceDeviceClass;
  templateEncrypted: string;
  qualityScore: number | null;
  enrolledAt?: string | null;
  lastVerifiedAt?: string | null;
};

function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL belum dikonfigurasi.");
  }
  return neon(databaseUrl);
}

export async function findUserByLogin(userId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      id::int AS id,
      user_id AS "userId",
      password_hash AS "passwordHash",
      display_name AS "displayName",
      role,
      has_voted AS "hasVoted",
      EXISTS (
        SELECT 1 FROM user_face_templates ft
        WHERE ft.user_id = users.id AND ft.revoked_at IS NULL
      ) AS "faceEnrolled",
      EXISTS (
        SELECT 1 FROM user_face_templates ft
        WHERE ft.user_id = users.id AND ft.template_role = 'desktop-primary' AND ft.revoked_at IS NULL
      ) AS "desktopPrimaryEnrolled",
      EXISTS (
        SELECT 1 FROM user_face_templates ft
        WHERE ft.user_id = users.id AND ft.template_role = 'mobile-primary' AND ft.revoked_at IS NULL
      ) AS "mobilePrimaryEnrolled",
      EXISTS (
        SELECT 1 FROM user_face_templates ft
        WHERE ft.user_id = users.id AND ft.template_role = 'canonical-cross-device' AND ft.revoked_at IS NULL
      ) AS "canonicalEnrolled",
      face_verified_at IS NOT NULL AS "faceVerified"
    FROM users
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return (rows[0] ?? null) as
    | {
        id: number;
        userId: string;
        passwordHash: string;
        displayName: string;
        role: "Alumni" | "Admin";
        hasVoted: boolean;
        faceEnrolled: boolean;
        faceVerified: boolean;
        desktopPrimaryEnrolled: boolean;
        mobilePrimaryEnrolled: boolean;
        canonicalEnrolled: boolean;
      }
    | null;
}

export async function findSessionUser(id: number) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      id::int AS id,
      user_id AS "userId",
      display_name AS "displayName",
      role,
      has_voted AS "hasVoted",
      EXISTS (
        SELECT 1 FROM user_face_templates ft
        WHERE ft.user_id = users.id AND ft.revoked_at IS NULL
      ) AS "faceEnrolled",
      EXISTS (
        SELECT 1 FROM user_face_templates ft
        WHERE ft.user_id = users.id AND ft.template_role = 'desktop-primary' AND ft.revoked_at IS NULL
      ) AS "desktopPrimaryEnrolled",
      EXISTS (
        SELECT 1 FROM user_face_templates ft
        WHERE ft.user_id = users.id AND ft.template_role = 'mobile-primary' AND ft.revoked_at IS NULL
      ) AS "mobilePrimaryEnrolled",
      EXISTS (
        SELECT 1 FROM user_face_templates ft
        WHERE ft.user_id = users.id AND ft.template_role = 'canonical-cross-device' AND ft.revoked_at IS NULL
      ) AS "canonicalEnrolled",
      face_verified_at IS NOT NULL AS "faceVerified"
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;
  return (rows[0] ?? null) as
    | {
        id: number;
        userId: string;
        displayName: string;
        role: "Alumni" | "Admin";
        hasVoted: boolean;
        faceEnrolled: boolean;
        faceVerified: boolean;
        desktopPrimaryEnrolled: boolean;
        mobilePrimaryEnrolled: boolean;
        canonicalEnrolled: boolean;
      }
    | null;
}

export async function upgradeLegacyPassword(id: number, passwordHash: string) {
  const sql = getSql();
  await sql`
    UPDATE users
    SET password_hash = ${passwordHash}, updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function getCandidates(): Promise<Candidate[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      id,
      name,
      vision,
      mission,
      featured_program AS "featuredProgram",
      image,
      occupation,
      cohort,
      votes
    FROM candidates
    ORDER BY id ASC
  `;
  return rows as Candidate[];
}

export async function castVote(userId: number, candidateId: number, faceVerified: boolean) {
  const sql = getSql();
  const rows = await sql`
    WITH candidate_exists AS (
      SELECT id FROM candidates WHERE id = ${candidateId}
    ), updated_user AS (
      UPDATE users
      SET has_voted = TRUE, updated_at = NOW()
      WHERE id = ${userId}
        AND has_voted = FALSE
        AND ${faceVerified} = TRUE
        AND EXISTS (SELECT 1 FROM candidate_exists)
      RETURNING id
    ), new_voter AS (
      INSERT INTO voters (user_id, candidate_id)
      SELECT id, ${candidateId}
      FROM updated_user
      RETURNING id
    )
    UPDATE candidates
    SET votes = votes + 1, updated_at = NOW()
    WHERE id = ${candidateId} AND EXISTS (SELECT 1 FROM new_voter)
    RETURNING id
  `;
  return rows as Candidate[];
}

export async function getVoters(search = ""): Promise<VoterRecord[]> {
  const sql = getSql();
  const query = `%${search.trim()}%`;
  const rows = await sql`
    SELECT
      u.id,
      u.id::int AS "userRecordId",
      u.user_id AS "userId",
      u.display_name AS "displayName",
      u.role,
      u.has_voted AS "hasVoted",
      c.name AS "candidateName",
      u.email,
      u.whatsapp,
      u.study_program AS "studyProgram",
      u.cohort,
      u.graduation_year AS "graduationYear",
      u.domicile,
      COALESCE(face_data.template_count, 0) > 0 AS "faceEnrolled",
      COALESCE(face_data.desktop_primary, FALSE) AS "desktopPrimaryEnrolled",
      COALESCE(face_data.mobile_primary, FALSE) AS "mobilePrimaryEnrolled",
      COALESCE(face_data.canonical, FALSE) AS "canonicalEnrolled",
      COALESCE(face_data.template_count, 0)::int AS "faceTemplateCount",
      u.face_verified_at IS NOT NULL AS "faceVerified",
      face_data.first_enrolled_at::text AS "faceEnrolledAt",
      u.face_verified_at::text AS "faceVerifiedAt",
      u.registration_source AS "registrationSource",
      u.created_at::text AS "createdAt",
      u.updated_at::text AS "updatedAt"
    FROM users u
    LEFT JOIN voters v ON v.user_id = u.id
    LEFT JOIN candidates c ON c.id = v.candidate_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS template_count,
        BOOL_OR(ft.template_role = 'desktop-primary') AS desktop_primary,
        BOOL_OR(ft.template_role = 'mobile-primary') AS mobile_primary,
        BOOL_OR(ft.template_role = 'canonical-cross-device') AS canonical,
        MIN(ft.enrolled_at) AS first_enrolled_at
      FROM user_face_templates ft
      WHERE ft.user_id = u.id AND ft.revoked_at IS NULL
    ) face_data ON TRUE
    WHERE u.role = 'Alumni'
      AND (${search.trim() === ""}
       OR u.user_id ILIKE ${query}
       OR c.name ILIKE ${query}
       OR u.display_name ILIKE ${query})
    ORDER BY u.created_at ASC
  `;
  return rows as VoterRecord[];
}

export async function getVoter(id: number) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      u.id,
      u.id::int AS "userRecordId",
      u.user_id AS "userId",
      u.display_name AS "displayName",
      u.role,
      u.has_voted AS "hasVoted",
      c.name AS "candidateName",
      u.email,
      u.whatsapp,
      u.study_program AS "studyProgram",
      u.cohort,
      u.graduation_year AS "graduationYear",
      u.domicile,
      COALESCE(face_data.template_count, 0) > 0 AS "faceEnrolled",
      COALESCE(face_data.desktop_primary, FALSE) AS "desktopPrimaryEnrolled",
      COALESCE(face_data.mobile_primary, FALSE) AS "mobilePrimaryEnrolled",
      COALESCE(face_data.canonical, FALSE) AS "canonicalEnrolled",
      COALESCE(face_data.template_count, 0)::int AS "faceTemplateCount",
      u.face_verified_at IS NOT NULL AS "faceVerified",
      face_data.first_enrolled_at::text AS "faceEnrolledAt",
      u.face_verified_at::text AS "faceVerifiedAt",
      u.registration_source AS "registrationSource",
      u.created_at::text AS "createdAt",
      u.updated_at::text AS "updatedAt"
    FROM users u
    LEFT JOIN voters v ON v.user_id = u.id
    LEFT JOIN candidates c ON c.id = v.candidate_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS template_count,
        BOOL_OR(ft.template_role = 'desktop-primary') AS desktop_primary,
        BOOL_OR(ft.template_role = 'mobile-primary') AS mobile_primary,
        BOOL_OR(ft.template_role = 'canonical-cross-device') AS canonical,
        MIN(ft.enrolled_at) AS first_enrolled_at
      FROM user_face_templates ft
      WHERE ft.user_id = u.id AND ft.revoked_at IS NULL
    ) face_data ON TRUE
    WHERE u.id = ${id}
    LIMIT 1
  `;
  return (rows[0] ?? null) as VoterRecord | null;
}

export async function getVotersForExport(): Promise<ExportVoterRecord[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      u.id,
      u.id::int AS "userRecordId",
      u.user_id AS "userId",
      u.display_name AS "displayName",
      u.role,
      u.has_voted AS "hasVoted",
      c.name AS "candidateName",
      u.email,
      u.whatsapp,
      u.study_program AS "studyProgram",
      u.cohort,
      u.graduation_year AS "graduationYear",
      u.domicile,
      COALESCE(face_data.template_count, 0) > 0 AS "faceEnrolled",
      COALESCE(face_data.desktop_primary, FALSE) AS "desktopPrimaryEnrolled",
      COALESCE(face_data.mobile_primary, FALSE) AS "mobilePrimaryEnrolled",
      COALESCE(face_data.canonical, FALSE) AS "canonicalEnrolled",
      COALESCE(face_data.template_count, 0)::int AS "faceTemplateCount",
      u.face_verified_at IS NOT NULL AS "faceVerified",
      face_data.first_enrolled_at::text AS "faceEnrolledAt",
      u.face_verified_at::text AS "faceVerifiedAt",
      u.registration_source AS "registrationSource",
      u.created_at::text AS "createdAt",
      u.updated_at::text AS "updatedAt",
      face_data.templates_json::text AS "faceTemplatesJson"
    FROM users u
    LEFT JOIN voters v ON v.user_id = u.id
    LEFT JOIN candidates c ON c.id = v.candidate_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS template_count,
        BOOL_OR(ft.template_role = 'desktop-primary') AS desktop_primary,
        BOOL_OR(ft.template_role = 'mobile-primary') AS mobile_primary,
        BOOL_OR(ft.template_role = 'canonical-cross-device') AS canonical,
        MIN(ft.enrolled_at) AS first_enrolled_at,
        JSONB_AGG(JSONB_BUILD_OBJECT(
          'templateRole', ft.template_role,
          'descriptorEngine', ft.engine,
          'modelVersion', ft.model_version,
          'sourceDeviceClass', ft.source_device_class,
          'templateEncrypted', ft.template_encrypted,
          'qualityScore', ft.quality_score,
          'enrolledAt', ft.enrolled_at,
          'lastVerifiedAt', ft.last_verified_at
        ) ORDER BY ft.template_role) AS templates_json
      FROM user_face_templates ft
      WHERE ft.user_id = u.id AND ft.revoked_at IS NULL
    ) face_data ON TRUE
    WHERE u.role = 'Alumni'
    ORDER BY u.created_at ASC
  `;
  return rows as ExportVoterRecord[];
}

export async function importUsers(
  users: Array<{
    userId: string;
    displayName: string;
    passwordHash: string;
    updatePassword: boolean;
    email: string | null;
    whatsapp: string | null;
    studyProgram: string | null;
    cohort: string | null;
    graduationYear: string | null;
    domicile: string | null;
    faceTemplates: StoredFaceTemplateInput[];
    faceVerifiedAt: string | null;
  }>
) {
  const sql = getSql();
  const payload = JSON.stringify(
    users.map((user) => ({
      user_id: user.userId,
      display_name: user.displayName,
      password_hash: user.passwordHash,
      update_password: user.updatePassword,
      email: user.email,
      whatsapp: user.whatsapp,
      study_program: user.studyProgram,
      cohort: user.cohort,
      graduation_year: user.graduationYear,
      domicile: user.domicile,
      face_templates: user.faceTemplates,
      face_verified_at: user.faceVerifiedAt
    }))
  );
  const rows = await sql`
    WITH imported AS (
      SELECT *
      FROM jsonb_to_recordset(${payload}::jsonb) AS source(
        user_id TEXT,
        display_name TEXT,
        password_hash TEXT,
        update_password BOOLEAN,
        email TEXT,
        whatsapp TEXT,
        study_program TEXT,
        cohort TEXT,
        graduation_year TEXT,
        domicile TEXT,
        face_templates JSONB,
        face_verified_at TIMESTAMPTZ
      )
    ), saved AS (
      INSERT INTO users (
        user_id, display_name, password_hash, role, has_voted,
        email, whatsapp, study_program, cohort, graduation_year, domicile,
        face_verified_at, registration_source
      )
      SELECT
        user_id, display_name, password_hash, 'Alumni', FALSE,
        email, whatsapp, study_program, cohort, graduation_year, domicile,
        face_verified_at,
        CASE WHEN update_password THEN 'ExcelLegacy' ELSE 'ExcelBackup' END
      FROM imported
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        password_hash = CASE
          WHEN EXCLUDED.registration_source = 'ExcelLegacy'
            THEN EXCLUDED.password_hash
          ELSE users.password_hash
        END,
        email = COALESCE(EXCLUDED.email, users.email),
        whatsapp = COALESCE(EXCLUDED.whatsapp, users.whatsapp),
        study_program = COALESCE(EXCLUDED.study_program, users.study_program),
        cohort = COALESCE(EXCLUDED.cohort, users.cohort),
        graduation_year = COALESCE(EXCLUDED.graduation_year, users.graduation_year),
        domicile = COALESCE(EXCLUDED.domicile, users.domicile),
        face_verified_at = COALESCE(EXCLUDED.face_verified_at, users.face_verified_at),
        updated_at = NOW()
      RETURNING id, user_id
    ), template_rows AS (
      SELECT
        saved.id AS user_id,
        template."templateRole" AS template_role,
        template."descriptorEngine" AS engine,
        template."modelVersion" AS model_version,
        template."sourceDeviceClass" AS source_device_class,
        template."templateEncrypted" AS template_encrypted,
        template."qualityScore" AS quality_score,
        template."enrolledAt" AS enrolled_at,
        template."lastVerifiedAt" AS last_verified_at
      FROM saved
      JOIN imported ON imported.user_id = saved.user_id
      CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(imported.face_templates, '[]'::jsonb)) AS template(
        "templateRole" TEXT,
        "descriptorEngine" TEXT,
        "modelVersion" TEXT,
        "sourceDeviceClass" TEXT,
        "templateEncrypted" TEXT,
        "qualityScore" NUMERIC,
        "enrolledAt" TIMESTAMPTZ,
        "lastVerifiedAt" TIMESTAMPTZ
      )
    ), saved_templates AS (
      INSERT INTO user_face_templates (
        user_id, template_role, engine, model_version, descriptor_length,
        template_encrypted, source_device_class, quality_score, enrolled_at, last_verified_at
      )
      SELECT
        user_id, template_role, engine, model_version, 1024,
        template_encrypted, source_device_class, quality_score,
        COALESCE(enrolled_at, NOW()), last_verified_at
      FROM template_rows
      ON CONFLICT (user_id, template_role) WHERE revoked_at IS NULL
      DO UPDATE SET
        engine = EXCLUDED.engine,
        model_version = EXCLUDED.model_version,
        descriptor_length = EXCLUDED.descriptor_length,
        template_encrypted = EXCLUDED.template_encrypted,
        source_device_class = EXCLUDED.source_device_class,
        quality_score = EXCLUDED.quality_score,
        enrolled_at = EXCLUDED.enrolled_at,
        last_verified_at = EXCLUDED.last_verified_at
      RETURNING id
    )
    SELECT COUNT(*)::int AS count FROM saved
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function createPublicVoter(data: {
  userId: string;
  displayName: string;
  passwordHash: string;
  email: string;
  whatsapp: string;
  studyProgram: string;
  cohort: string;
  graduationYear: string | null;
  domicile: string | null;
  faceTemplates: StoredFaceTemplateInput[];
}) {
  const sql = getSql();
  const templates = JSON.stringify(data.faceTemplates);
  const rows = await sql`
    WITH saved_user AS (
      INSERT INTO users (
        user_id, password_hash, display_name, role, has_voted,
        email, whatsapp, study_program, cohort, graduation_year, domicile,
        face_verified_at, registration_source
      ) VALUES (
        ${data.userId}, ${data.passwordHash}, ${data.displayName}, 'Alumni', FALSE,
        ${data.email}, ${data.whatsapp}, ${data.studyProgram}, ${data.cohort},
        ${data.graduationYear}, ${data.domicile}, NULL, 'PublicRegistration'
      )
      RETURNING id
    ), saved_templates AS (
      INSERT INTO user_face_templates (
        user_id, template_role, engine, model_version, descriptor_length,
        template_encrypted, source_device_class, quality_score
      )
      SELECT
        saved_user.id, template."templateRole", template."descriptorEngine",
        template."modelVersion", 1024, template."templateEncrypted",
        template."sourceDeviceClass", template."qualityScore"
      FROM saved_user
      CROSS JOIN LATERAL jsonb_to_recordset(${templates}::jsonb) AS template(
        "templateRole" TEXT,
        "descriptorEngine" TEXT,
        "modelVersion" TEXT,
        "sourceDeviceClass" TEXT,
        "templateEncrypted" TEXT,
        "qualityScore" NUMERIC
      )
      RETURNING id
    )
    SELECT id::int AS id FROM saved_user
  `;
  return rows[0] as { id: number };
}

export async function getFaceTemplateAvailability(userId: number) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM user_face_templates
        WHERE user_id = ${userId} AND template_role = 'desktop-primary' AND revoked_at IS NULL
      ) AS "desktopPrimaryEnrolled",
      EXISTS (
        SELECT 1 FROM user_face_templates
        WHERE user_id = ${userId} AND template_role = 'mobile-primary' AND revoked_at IS NULL
      ) AS "mobilePrimaryEnrolled",
      EXISTS (
        SELECT 1 FROM user_face_templates
        WHERE user_id = ${userId} AND template_role = 'canonical-cross-device' AND revoked_at IS NULL
      ) AS "canonicalEnrolled"
  `;
  return rows[0] as {
    desktopPrimaryEnrolled: boolean;
    mobilePrimaryEnrolled: boolean;
    canonicalEnrolled: boolean;
  };
}

export async function getFaceVerificationRecord(
  userId: number,
  templateRole: FaceTemplateRole,
  descriptorEngine: FaceDescriptorEngine
) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      template_encrypted AS "templateEncrypted",
      model_version AS "modelVersion",
      source_device_class AS "sourceDeviceClass",
      enrolled_at::text AS "enrolledAt",
      last_verified_at::text AS "lastVerifiedAt"
    FROM user_face_templates
    WHERE user_id = ${userId}
      AND template_role = ${templateRole}
      AND engine = ${descriptorEngine}
      AND revoked_at IS NULL
    LIMIT 1
  `;
  return (rows[0] ?? null) as
    | {
        templateEncrypted: string;
        modelVersion: string;
        sourceDeviceClass: FaceDeviceClass;
        enrolledAt: string;
        lastVerifiedAt: string | null;
      }
    | null;
}

export async function saveFaceTemplate(userId: number, data: StoredFaceTemplateInput) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO user_face_templates (
      user_id, template_role, engine, model_version, descriptor_length,
      template_encrypted, source_device_class, quality_score
    )
    SELECT
      id, ${data.templateRole}, ${data.descriptorEngine}, ${data.modelVersion}, 1024,
      ${data.templateEncrypted}, ${data.sourceDeviceClass}, ${data.qualityScore}
    FROM users
    WHERE id = ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM user_face_templates ft
        WHERE ft.user_id = users.id
          AND ft.template_role = ${data.templateRole}
          AND ft.revoked_at IS NULL
      )
    RETURNING id
  `;
  return rows.length === 1;
}

export async function markFaceVerified(userId: number, templateRole: FaceTemplateRole) {
  const sql = getSql();
  const rows = await sql`
    WITH verified_template AS (
      UPDATE user_face_templates
      SET last_verified_at = NOW(), updated_at = NOW()
      WHERE user_id = ${userId}
        AND template_role = ${templateRole}
        AND revoked_at IS NULL
      RETURNING user_id
    )
    UPDATE users
    SET face_verified_at = NOW(), updated_at = NOW()
    WHERE id = ${userId}
      AND EXISTS (SELECT 1 FROM verified_template)
    RETURNING id
  `;
  return rows.length === 1;
}

export async function resetUserFaceTemplates(userId: number) {
  const sql = getSql();
  const rows = await sql`
    WITH reset_templates AS (
      UPDATE user_face_templates
      SET revoked_at = NOW(), updated_at = NOW()
      WHERE user_id = ${userId} AND revoked_at IS NULL
      RETURNING user_id
    )
    UPDATE users
    SET face_verified_at = NULL, updated_at = NOW()
    WHERE id = ${userId}
      AND EXISTS (SELECT 1 FROM reset_templates)
    RETURNING id
  `;
  return rows.length === 1;
}

export async function createCandidate(data: Omit<Candidate, "id" | "votes">) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO candidates (
      name, vision, mission, featured_program, image, occupation, cohort, votes
    ) VALUES (
      ${data.name}, ${data.vision}, ${data.mission}, ${data.featuredProgram},
      ${data.image}, ${data.occupation}, ${data.cohort}, 0
    )
    RETURNING id
  `;
  return rows[0] as { id: number };
}

export async function getAdminStats(): Promise<AdminStats> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM users WHERE role = 'Alumni') AS voters,
      (SELECT COUNT(*)::int FROM users WHERE has_voted = TRUE) AS voted,
      (SELECT COUNT(*)::int FROM candidates) AS candidates,
      (SELECT COALESCE(SUM(votes), 0)::int FROM candidates) AS "totalVotes"
  `;
  return rows[0] as AdminStats;
}

export async function getAdminUsers(): Promise<AdminUserRecord[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      u.id::int AS id,
      u.user_id AS "userId",
      u.display_name AS "displayName",
      u.role,
      u.has_voted AS "hasVoted"
    FROM users u
    ORDER BY u.created_at ASC
  `;
  return rows as AdminUserRecord[];
}

export async function createAdminUser(data: {
  userId: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
}) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO users (user_id, display_name, role, password_hash, has_voted)
    VALUES (${data.userId}, ${data.displayName}, ${data.role}, ${data.passwordHash}, FALSE)
    RETURNING id::int AS id
  `;
  return rows[0] as { id: number };
}

export async function updateAdminUser(
  id: number,
  data: { userId: string; displayName: string; role: UserRole; passwordHash: string | null }
) {
  const sql = getSql();
  const rows = await sql`
    UPDATE users
    SET
      user_id = ${data.userId},
      display_name = ${data.displayName},
      role = ${data.role},
      password_hash = COALESCE(${data.passwordHash}, password_hash),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length === 1;
}

export async function updateVoterAccount(
  id: number,
  data: { displayName: string; passwordHash: string | null }
) {
  const sql = getSql();
  const rows = await sql`
    UPDATE users
    SET
      display_name = ${data.displayName},
      password_hash = COALESCE(${data.passwordHash}, password_hash),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length === 1;
}

export async function deleteAdminUser(id: number) {
  const sql = getSql();
  const rows = await sql`
    WITH previous AS (
      SELECT u.id, u.has_voted, v.candidate_id
      FROM users u
      LEFT JOIN voters v ON v.user_id = u.id
      WHERE u.id = ${id}
    ), removed_user AS (
      DELETE FROM users WHERE id = (SELECT id FROM previous)
      RETURNING id
    ), reduced AS (
      UPDATE candidates
      SET votes = GREATEST(votes - 1, 0), updated_at = NOW()
      WHERE id = (SELECT candidate_id FROM previous)
        AND (SELECT has_voted FROM previous) = TRUE
      RETURNING id
    )
    SELECT COUNT(*)::int AS count FROM removed_user
  `;
  return Number(rows[0]?.count ?? 0) === 1;
}

export async function resetUserVote(id: number) {
  const sql = getSql();
  const rows = await sql`
    WITH previous AS (
      SELECT u.id, v.candidate_id
      FROM users u
      JOIN voters v ON v.user_id = u.id
      WHERE u.id = ${id} AND u.has_voted = TRUE
      FOR UPDATE OF u, v
    ), reset_user AS (
      UPDATE users
      SET has_voted = FALSE, updated_at = NOW()
      WHERE id = (SELECT id FROM previous)
      RETURNING id
    ), reset_voter AS (
      DELETE FROM voters
      WHERE user_id = (SELECT id FROM previous)
      RETURNING id
    ), reduced AS (
      UPDATE candidates
      SET votes = GREATEST(votes - 1, 0), updated_at = NOW()
      WHERE id = (SELECT candidate_id FROM previous)
      RETURNING id
    )
    SELECT COUNT(*)::int AS count FROM reset_user
  `;
  return Number(rows[0]?.count ?? 0) === 1;
}

export async function updateCandidate(
  id: number,
  data: Omit<Candidate, "id" | "votes" | "image"> & { image: string | null }
) {
  const sql = getSql();
  const rows = await sql`
    UPDATE candidates
    SET
      name = ${data.name},
      vision = ${data.vision},
      mission = ${data.mission},
      featured_program = ${data.featuredProgram},
      image = COALESCE(${data.image}, image),
      occupation = ${data.occupation},
      cohort = ${data.cohort},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length === 1;
}

export async function deleteCandidate(id: number) {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM candidates c
    WHERE c.id = ${id}
      AND c.votes = 0
      AND NOT EXISTS (SELECT 1 FROM voters v WHERE v.candidate_id = c.id)
    RETURNING id
  `;
  return rows.length === 1;
}
