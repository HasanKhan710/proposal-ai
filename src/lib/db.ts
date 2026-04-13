import { createClient, type Client } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  is_active: number;
  created_at: string;
}

export interface ProposalRecord {
  id: string;
  user_id: string;
  mode: string;
  prompt: string;
  output: string;
  title: string | null;
  created_at: string;
}

export interface DocumentRecord {
  id: string;
  name: string;
  file_path: string;
  file_type: string;
  chunk_count: number;
  uploaded_by: string;
  created_at: string;
}

export interface ChunkSearchRecord {
  id: string;
  content: string;
  embedding: string | null;
  name: string;
}

let client: Client | null = null;
let initPromise: Promise<void> | null = null;

function getDatabaseUrl() {
  return process.env.DATABASE_URL || 'file:proposal-ai.sqlite';
}

function getDbClient() {
  if (!client) {
    const databaseUrl = getDatabaseUrl();
    const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;

    client = createClient({
      url: databaseUrl,
      authToken,
    });
  }

  return client;
}

function row<T>(value: unknown): T | undefined {
  return value as T | undefined;
}

async function initializeDb() {
  const db = getDbClient();

  await db.batch([
    `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS invite_tokens (
        id TEXT PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        created_by TEXT NOT NULL,
        used_by TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        chunk_count INTEGER DEFAULT 0,
        uploaded_by TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        embedding TEXT,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        prompt TEXT NOT NULL,
        output TEXT NOT NULL,
        title TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `,
  ], 'write');

  await seedAdmin();
}

async function seedAdmin() {
  const db = getDbClient();
  const result = await db.execute('SELECT count(*) as count FROM users');
  const usersCount = Number(result.rows[0]?.count ?? 0);

  if (usersCount === 0) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@company.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
    const passwordHash = bcrypt.hashSync(adminPassword, 10);

    await db.execute({
      sql: `
        INSERT INTO users (id, email, password_hash, name, role, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [uuidv4(), adminEmail, passwordHash, 'Admin', 'admin', 1],
    });

    console.log(`Admin user seeded: ${adminEmail}`);
  }
}

async function ensureDb() {
  if (!initPromise) {
    initPromise = initializeDb();
  }

  await initPromise;
  return getDbClient();
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await ensureDb();
  const result = await db.execute({
    sql: 'SELECT value FROM settings WHERE key = ?',
    args: [key],
  });

  return (result.rows[0]?.value as string | undefined) ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await ensureDb();
  await db.execute({
    sql: `
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
    args: [key, value],
  });
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const db = await ensureDb();
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE email = ?',
    args: [email],
  });

  return row<UserRecord>(result.rows[0]) ?? null;
}

export async function listUsers(): Promise<UserRecord[]> {
  const db = await ensureDb();
  const result = await db.execute('SELECT id, name, email, role, is_active, created_at FROM users');
  return result.rows.map((item) => item as unknown as UserRecord);
}

export async function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  role: string;
}) {
  const db = await ensureDb();
  const id = uuidv4();

  await db.execute({
    sql: `
      INSERT INTO users (id, email, name, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `,
    args: [id, input.email, input.name, input.passwordHash, input.role],
  });

  return { id, ...input };
}

export async function updateUserStatus(id: string, isActive: boolean): Promise<void> {
  const db = await ensureDb();
  await db.execute({
    sql: 'UPDATE users SET is_active = ? WHERE id = ?',
    args: [isActive ? 1 : 0, id],
  });
}

export async function updateUserRole(id: string, role: string): Promise<void> {
  const db = await ensureDb();
  await db.execute({
    sql: 'UPDATE users SET role = ? WHERE id = ?',
    args: [role, id],
  });
}

export async function countDocuments() {
  const db = await ensureDb();
  const result = await db.execute('SELECT COUNT(*) as count FROM documents');
  return Number(result.rows[0]?.count ?? 0);
}

export async function countActiveUsers() {
  const db = await ensureDb();
  const result = await db.execute('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
  return Number(result.rows[0]?.count ?? 0);
}

export async function countUserProposals(userId: string) {
  const db = await ensureDb();
  const result = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM proposals WHERE user_id = ?',
    args: [userId],
  });
  return Number(result.rows[0]?.count ?? 0);
}

export async function listRecentUserProposals(userId: string, limit = 5): Promise<ProposalRecord[]> {
  const db = await ensureDb();
  const result = await db.execute({
    sql: `
      SELECT id, title, mode, created_at
      FROM proposals
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    args: [userId, limit],
  });

  return result.rows.map((item) => item as unknown as ProposalRecord);
}

export async function listUserProposals(userId: string): Promise<ProposalRecord[]> {
  const db = await ensureDb();
  const result = await db.execute({
    sql: 'SELECT * FROM proposals WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  });

  return result.rows.map((item) => item as unknown as ProposalRecord);
}

export async function getUserProposalById(id: string, userId: string): Promise<ProposalRecord | null> {
  const db = await ensureDb();
  const result = await db.execute({
    sql: 'SELECT * FROM proposals WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });

  return row<ProposalRecord>(result.rows[0]) ?? null;
}

export async function createProposal(input: {
  userId: string;
  mode: string;
  prompt: string;
  output: string;
  title: string;
}) {
  const db = await ensureDb();
  const id = uuidv4();

  await db.execute({
    sql: `
      INSERT INTO proposals (id, user_id, mode, prompt, output, title)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [id, input.userId, input.mode, input.prompt, input.output, input.title],
  });

  return id;
}

export async function deleteUserProposal(id: string, userId: string): Promise<void> {
  const db = await ensureDb();
  await db.execute({
    sql: 'DELETE FROM proposals WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const db = await ensureDb();
  const result = await db.execute(`
    SELECT id, name, file_type, file_path, chunk_count, uploaded_by, created_at
    FROM documents
    ORDER BY created_at DESC
  `);

  return result.rows.map((item) => item as unknown as DocumentRecord);
}

export async function getDocumentById(id: string): Promise<DocumentRecord | null> {
  const db = await ensureDb();
  const result = await db.execute({
    sql: 'SELECT * FROM documents WHERE id = ?',
    args: [id],
  });

  return row<DocumentRecord>(result.rows[0]) ?? null;
}

export async function createDocument(input: {
  id: string;
  name: string;
  filePath: string;
  fileType: string;
  uploadedBy: string;
}) {
  const db = await ensureDb();
  await db.execute({
    sql: `
      INSERT INTO documents (id, name, file_path, file_type, uploaded_by)
      VALUES (?, ?, ?, ?, ?)
    `,
    args: [input.id, input.name, input.filePath, input.fileType, input.uploadedBy],
  });
}

export async function createChunk(input: {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  embedding: string | null;
}) {
  const db = await ensureDb();
  await db.execute({
    sql: `
      INSERT INTO chunks (id, document_id, content, chunk_index, embedding)
      VALUES (?, ?, ?, ?, ?)
    `,
    args: [input.id, input.documentId, input.content, input.chunkIndex, input.embedding],
  });
}

export async function updateDocumentChunkCount(documentId: string, chunkCount: number) {
  const db = await ensureDb();
  await db.execute({
    sql: 'UPDATE documents SET chunk_count = ? WHERE id = ?',
    args: [chunkCount, documentId],
  });
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await ensureDb();
  await db.batch([
    {
      sql: 'DELETE FROM chunks WHERE document_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM documents WHERE id = ?',
      args: [id],
    },
  ], 'write');
}

export async function listChunkSearchRecords(): Promise<ChunkSearchRecord[]> {
  const db = await ensureDb();
  const result = await db.execute(`
    SELECT chunks.id, chunks.content, chunks.embedding, documents.name
    FROM chunks
    JOIN documents ON chunks.document_id = documents.id
    WHERE chunks.embedding IS NOT NULL
  `);

  return result.rows.map((item) => item as unknown as ChunkSearchRecord);
}

export async function hasUserWithEmail(email: string) {
  const db = await ensureDb();
  const result = await db.execute({
    sql: 'SELECT id FROM users WHERE email = ?',
    args: [email],
  });

  return result.rows.length > 0;
}
