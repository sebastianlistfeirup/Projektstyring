import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Rename only after every byte has reached the temporary file. A failed write
// leaves the previous document intact, including on a full disk.
export function writeAtomicJson(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(data));
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, { force: true });
  }
}
