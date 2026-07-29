import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { Brain } from "lucide-react";
import { ModelSelect } from '../components/model-select';
import { ReportTemplateManager } from './report-template-manager';

export function Setting() {
  const t = useTranslations('settings.report');

  return (
    <ItemGroup className="gap-4">
      {/* 周报生成模型 */}
      <Item variant="outline">
        <ItemMedia variant="icon"><Brain className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('model.title')}</ItemTitle>
          <ItemDescription>{t('model.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ModelSelect modelKey="report" />
        </ItemActions>
      </Item>

      {/* 自定义周报模板管理 */}
      <ReportTemplateManager />
    </ItemGroup>
  )
}
