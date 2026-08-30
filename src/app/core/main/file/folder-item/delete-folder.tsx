import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { ask } from '@tauri-apps/plugin-dialog';
import { Trash2 } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import {
  collectFolderMarkdownPaths,
  deleteLocalFolderIfExists,
  deleteVectorDocumentsByPaths,
  removeFolderFromTree,
} from "./delete-folder-utils";

interface DeleteFolderProps {
  item: DirTree;
  shortcut?: string;
}

export function DeleteFolder({ item, shortcut }: DeleteFolderProps) {
  const t = useTranslations('article.file');
  const {
    fileTree,
    setFileTree,
    cleanTabsByDeletedFolder
  } = useArticleStore();

  const path = computedParentPath(item);

  async function handleDeleteFolder(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    event.stopPropagation();
    
    try {
      // 确认删除操作
      const confirmed = await ask(t('context.confirmDelete', { name: item.name }), {
        title: item.name,
        kind: 'warning',
      });
      
      if (!confirmed) return;

      const markdownPaths = await collectFolderMarkdownPaths(path, item);
      await deleteLocalFolderIfExists(path);

      // 清理已被删除的文件夹对应的 tabs（包括自动选择其他 tab）
      await cleanTabsByDeletedFolder(path)

      // 从文件树中移除该文件夹
      const cacheTree = cloneDeep(fileTree);
      removeFolderFromTree(cacheTree, path);
      setFileTree(cacheTree);

      // 删除向量数据库中该文件夹下所有文件的记录
      try {
        await deleteVectorDocumentsByPaths(markdownPaths);
      } catch (error) {
        console.error('删除文件夹向量数据失败:', error)
      }

      toast({ title: t('context.deleteSuccess') });
    } catch (error) {
      console.error('Delete folder failed:', error);
      toast({ 
        title: t('context.deleteFailed'), 
        variant: 'destructive' 
      });
    }
  }

  return (
    <ContextMenuItem
      inset
      className="text-danger"
      onClick={handleDeleteFolder}
      menuType="file"
    >
      <Trash2 className="mr-2 h-4 w-4" />
      {t('context.delete')}
      {shortcut && (
        <ContextMenuShortcut menuType="file">
          <Kbd>{shortcut}</Kbd>
        </ContextMenuShortcut>
      )}
    </ContextMenuItem>
  );
}
