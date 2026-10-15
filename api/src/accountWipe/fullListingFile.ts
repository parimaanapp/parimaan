import { closeSync, constants, openSync, unlinkSync, writeFileSync } from 'node:fs';

export interface FullListingFile {
  write(content: string): void;
  /** Removes the (still empty or partial) file this run created, e.g. after a failed run. */
  discard(): void;
}

const OWNER_ONLY = 0o600;
const FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

/**
 * Opens the `--full-listing` destination BEFORE any work: exclusive create
 * (`O_EXCL`, so an existing file or any symlink, dangling or not, is refused),
 * `O_NOFOLLOW`, mode 0600. The listing holds emails and ids, so it must never
 * be written through a link or over somebody else's file, and a bad path must
 * fail before anything is read or deleted rather than after.
 */
export const openFullListingFile = (path: string): FullListingFile => {
  let fd: number;
  try {
    fd = openSync(path, FLAGS, OWNER_ONLY);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ELOOP') {
      throw new Error(
        `--full-listing ${path} already exists (or is a symlink); refusing to overwrite. Choose a new path.`,
      );
    }
    throw new Error(
      `--full-listing ${path} cannot be created (${code ?? 'unknown error'}). Check the directory exists and is writable.`,
    );
  }
  let open = true;
  const close = (): void => {
    if (open) {
      open = false;
      closeSync(fd);
    }
  };
  return {
    write: (content) => {
      try {
        writeFileSync(fd, content);
      } finally {
        close();
      }
    },
    discard: () => {
      close();
      try {
        unlinkSync(path);
      } catch {
        // Already gone; nothing to clean up.
      }
    },
  };
};
