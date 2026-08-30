import { exists, remove } from "@tauri-apps/plugin-fs";
import type { DirTree } from "@/stores/article";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace";

interface RemoteContentEntry {
  name?: string;
  path?: string;
  type?: string;
  sha?: string;
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.filter(Boolean)));
}

function isStringPath(path: string | undefined): path is string {
  return Boolean(path);
}

function isMarkdownPath(path: string) {
  return /\.(md|markdown)$/i.test(path);
}

export function collectFolderFilePaths(item: DirTree): string[] {
  return uniquePaths(collectFolderFileEntries(item).map(entry => entry.path).filter(isStringPath));
}

function collectFolderFileEntries(item: DirTree): RemoteContentEntry[] {
  const entries: RemoteContentEntry[] = [];

  function walk(node: DirTree) {
    if (node.isFile) {
      entries.push({
        path: computedParentPath(node),
        name: node.name,
        sha: node.sha,
        type: "file",
      });
      return;
    }

    node.children?.forEach(walk);
  }

  walk(item);
  return entries;
}

export async function collectFolderMarkdownPaths(folderPath: string, item: DirTree) {
  const folderPrefix = `${folderPath.replace(/^\/+|\/+$/g, "")}/`;
  const paths = new Set(collectFolderFilePaths(item).filter(isMarkdownPath));

  try {
    const { getAllMarkdownFiles } = await import("@/lib/files");
    const allFiles = await getAllMarkdownFiles();
    allFiles
      .filter(file => file.relativePath.startsWith(folderPrefix))
      .forEach(file => paths.add(file.relativePath));
  } catch {
    // 本地目录不存在时，仍然可以依赖当前树节点清理已知的向量记录。
  }

  return Array.from(paths);
}

export async function deleteVectorDocumentsByPaths(paths: string[]) {
  if (paths.length === 0) {
    return;
  }

  const { deleteVectorDocumentsByFilename } = await import("@/db/vector");
  for (const path of paths) {
    try {
      await deleteVectorDocumentsByFilename(path);
    } catch (error) {
      console.error(`删除文件 ${path} 的向量数据失败:`, error);
    }
  }
}

export async function deleteLocalFolderIfExists(folderPath: string) {
  const workspace = await getWorkspacePath();
  const pathOptions = await getFilePathOptions(folderPath);
  const localExists = workspace.isCustom
    ? await exists(pathOptions.path)
    : await exists(pathOptions.path, { baseDir: pathOptions.baseDir });

  if (!localExists) {
    return false;
  }

  if (workspace.isCustom) {
    await remove(pathOptions.path, { recursive: true });
  } else {
    await remove(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true });
  }

  return true;
}

export function removeFolderFromTree(tree: DirTree[], folderPath: string) {
  const currentFolder = getCurrentFolder(folderPath, tree);
  if (!currentFolder) {
    return;
  }

  const parentFolder = currentFolder?.parent;

  if (parentFolder?.children) {
    const index = parentFolder.children.findIndex(child => child.name === currentFolder.name);
    if (index !== -1) {
      parentFolder.children.splice(index, 1);
    }
    return;
  }

  const rootName = folderPath.split("/")[0];
  const index = tree.findIndex(child => child.name === rootName);
  if (index !== -1) {
    tree.splice(index, 1);
  }
}
