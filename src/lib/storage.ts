import { del, put } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

function normalizeBlobPath(value: string) {
  return value.replace(/^\/+/, '');
}

function makeSafeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

function storageBackend() {
  return process.env.STORAGE_BACKEND === 'blob' ? 'blob' : 'local';
}

function ensureLocalDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function saveBlob(pathname: string, buffer: Buffer, contentType?: string) {
  const blob = await put(normalizeBlobPath(pathname), buffer, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
  });

  return blob.url;
}

export async function saveProposalUpload(filename: string, buffer: Buffer, contentType?: string) {
  if (storageBackend() === 'blob') {
    return saveBlob(`proposals/${makeSafeFilename(filename)}`, buffer, contentType);
  }

  const uploadDir = path.join(LOCAL_UPLOAD_ROOT, 'proposals');
  ensureLocalDir(uploadDir);

  const filePath = path.join(uploadDir, makeSafeFilename(filename));
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export async function removeStoredFile(filePath: string | null | undefined) {
  if (!filePath) return;

  if (storageBackend() === 'blob') {
    await del(filePath);
    return;
  }

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export async function saveMasterTemplate(buffer: Buffer) {
  if (storageBackend() === 'blob') {
    return saveBlob('templates/master-template.docx', buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  ensureLocalDir(LOCAL_UPLOAD_ROOT);
  const templatePath = path.join(LOCAL_UPLOAD_ROOT, 'master-template.docx');
  fs.writeFileSync(templatePath, buffer);
  return templatePath;
}

export function localTemplateExists(templatePath: string | null) {
  if (!templatePath || storageBackend() !== 'local') return false;
  return fs.existsSync(templatePath);
}
